import warnings
import os
import json
import sqlite3
import logging
import time
from typing import Optional
warnings.filterwarnings('ignore', message='pkg_resources is deprecated as an API.*', category=UserWarning)

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))

import pandas as pd
from datetime import datetime
from backend.db_path import resolve_vci_screening_db_path
from backend.vci_data_access import VCIDataAccess
from backend.services.source_priority import apply_peer_source_priority, get_screening_metrics_map, get_stats_financial_metrics_map, get_ratio_daily_metrics_map

logger = logging.getLogger(__name__)

class StockDataProvider:
    def __init__(self):
        self._stock_data_cache = {} # In-memory cache for stock details (TTL 15s)
        self._price_cache = {} # Short-term cache for realtime prices (TTL 30s)
        self._company_profiles_cache = None  # Memoized company_profile_export.json
        self.db_path = resolve_vci_screening_db_path()
        self.vci = VCIDataAccess()
        
        # Load ticker metadata from public/ticker_data.json
        self.ticker_metadata = {}
        try:
            ticker_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'frontend-next', 'public', 'ticker_data.json')
            if os.path.exists(ticker_path):
                with open(ticker_path, 'r', encoding='utf-8') as f:
                    content = json.load(f)
                    tickers = content.get('tickers', [])
                    for t in tickers:
                        self.ticker_metadata[t['symbol'].upper()] = t
                logger.info(f"Loaded {len(self.ticker_metadata)} tickers from ticker_data.json")
        except Exception as e:
            logger.error(f"Error loading ticker_data.json: {e}")

        logger.info("StockDataProvider initialized")



    # --- Removed JSON and CSV legacy methods ---

    def _get_industry_for_symbol(self, symbol: str) -> str:
        """Get industry from metadata or DB"""
        symbol_upper = symbol.upper()
        if symbol_upper in self.ticker_metadata:
            sector = self.ticker_metadata[symbol_upper].get('sector', 'Unknown')
            if sector and sector != "Unknown":
                return sector
        
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT industry FROM overview WHERE symbol = ?", (symbol_upper,))
            row = cursor.fetchone()

            if row and row[0] and str(row[0]).strip() and str(row[0]).strip().lower() != 'unknown':
                conn.close()
                return str(row[0]).strip()

            # Fallback to company.industry when overview is missing/blank
            try:
                cursor.execute("SELECT industry FROM company WHERE symbol = ?", (symbol_upper,))
                company_row = cursor.fetchone()
                if company_row and company_row[0] and str(company_row[0]).strip() and str(company_row[0]).strip().lower() != 'unknown':
                    conn.close()
                    return str(company_row[0]).strip()
            except Exception:
                pass

            conn.close()

            # Final fallback: vci_screening.viSector
            try:
                screening_db = resolve_vci_screening_db_path()
                if screening_db and os.path.exists(screening_db):
                    sconn = sqlite3.connect(screening_db)
                    scur = sconn.cursor()
                    scur.execute(
                        """
                        SELECT viSector, enSector
                        FROM screening_data
                        WHERE UPPER(ticker) = ?
                        LIMIT 1
                        """,
                        (symbol_upper,),
                    )
                    srow = scur.fetchone()
                    sconn.close()
                    if srow:
                        vi_sector = srow[0]
                        en_sector = srow[1]
                        if vi_sector and str(vi_sector).strip():
                            return str(vi_sector).strip()
                        if en_sector and str(en_sector).strip():
                            return str(en_sector).strip()
            except Exception:
                pass

            return "Unknown"
        except Exception:
            return "Unknown"

    def _get_all_symbols(self, symbols_override=None):
        """Get all symbols from DB or override list"""
        if symbols_override is not None:
            return [s.upper() for s in symbols_override]
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT symbol FROM overview")
            symbols = [row[0].upper() for row in cursor.fetchall()]
            conn.close()
            return symbols
        except Exception as e:
            logger.warning(f"Error getting symbols from DB: {e}")
            return []

    def validate_symbol(self, symbol: str, symbols_override=None) -> bool:
        symbols = self._get_all_symbols(symbols_override)
        if symbols is None or len(symbols) == 0:
            logger.warning(f"Cannot validate symbol {symbol} - symbols list unavailable")
            return True
        return symbol.upper() in symbols

    def _get_company_metadata_from_listing(self, symbol: str) -> dict:
        """Fetch metadata from SQLite database (company/overview tables)."""
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            # Try company table first
            cursor.execute(
                "SELECT name, industry, exchange FROM company WHERE symbol = ?",
                (symbol.upper(),)
            )
            row = cursor.fetchone()
            conn.close()
            if row:
                return {
                    'organ_name': row["name"] or symbol.upper(),
                    'industry': row["industry"] or "Unknown",
                    'exchange': row["exchange"] or "Unknown",
                }
        except Exception as e:
            logger.warning(f"Failed to fetch metadata from DB for {symbol}: {e}")
        return None

    def _get_data_from_db(self, symbol, period):
        """Fetch stock data from VCI SQLite databases (replaces stocks_optimized.db).
        
        Data sources:
        - vci_company.sqlite         → name, sector, exchange, logo (primary identity)
        - vci_stats_financial.sqlite → PE, PB, ROE, ROA, banking KPIs (primary metrics)
        - vci_screening.sqlite       → snapshot fallback for missing market fields
        - vci_stats_financial.sqlite (history) → ratio chart series
        - vci_financials.sqlite     → income statement, balance sheet, cash flow
        - price_history.sqlite      → OHLCV
        """
        try:
            data = {'symbol': symbol, 'data_source': 'VCI_SQLite', 'data_period': period}

            # 1. Company info (name, sector, exchange, logo) - BASE layer
            company = self.vci.get_company_info(symbol)
            if company:
                data.update({
                    'name': company.get('name'),
                    'sector': company.get('sector'),
                    'industry': company.get('sector'),
                    'exchange': company.get('exchange'),
                    'floor': company.get('floor'),
                    'logo_url': company.get('logo_url'),
                    'isbank': company.get('isbank', False),
                })

            # 2. Overview data (stats/company primary, screening fallback)
            overview = self.vci.get_overview_data(symbol)
            if overview:
                # Snapshot market fields (screening only when primary sources are missing)
                for key in ['current_price', 'ref_price', 'ceiling', 'floor_price', 'market_cap',
                            'price_change_pct', 'accumulated_volume', 'accumulated_value']:
                    if overview.get(key) is not None:
                        data[key] = overview[key]
                # Update ratios from stats_financial
                for key in ['pe', 'pb', 'ps', 'roe', 'roa', 'eps', 'bvps',
                            'net_margin', 'gross_margin', 'current_ratio', 'quick_ratio',
                            'debt_to_equity', 'nim', 'car', 'casa', 'npl', 'ldr', 'cir']:
                    if overview.get(key) is not None:
                        data[key] = overview[key]
                # Keep margin aliases in sync for downstream summary builders/frontend.
                if overview.get('net_margin') is not None:
                    data['after_tax_margin'] = overview['net_margin']
                    data['net_profit_margin'] = overview['net_margin']
                # Only use sector from overview if company didn't provide it
                if not data.get('sector') and overview.get('sector'):
                    data['sector'] = overview['sector']
                    data['industry'] = overview['sector']
                if not data.get('exchange') and overview.get('exchange'):
                    data['exchange'] = overview['exchange']

            # 3. Shares outstanding from stats_financial
            ratios = self.vci.get_current_ratios(symbol)
            if ratios and ratios.get('shares'):
                data['shares_outstanding'] = ratios['shares']

            # 3b. Calculate EPS and BVPS from PE/PB + current price
            # EPS = Price / PE, BVPS = Price / PB
            price = data.get('current_price')
            pe = data.get('pe')
            pb = data.get('pb')
            if price and price > 0:
                if pe and pe > 0:
                    data['eps'] = round(price / pe, 0)
                if pb and pb > 0:
                    data['bvps'] = round(price / pb, 0)

            # 4. Chart series from ratio history (for frontend charts)
            ratio_history = self.vci.get_ratio_history(symbol)
            if ratio_history:
                # Filter by period type and take last 12
                if period == 'year':
                    # For yearly, aggregate by year
                    yearly = {}
                    for r in ratio_history:
                        y = r.get('year')
                        if y:
                            yearly.setdefault(y, []).append(r)
                    years = sorted(yearly.keys())[-12:]
                    data['years'] = [str(y) for y in years]
                    data['roe_data'] = []
                    data['roa_data'] = []
                    data['pe_ratio_data'] = []
                    data['pb_ratio_data'] = []
                    data['nim_data'] = []
                    data['casa_data'] = []
                    data['npl_data'] = []
                    for y in years:
                        items = yearly[y]
                        # Average quarterly values for yearly
                        data['roe_data'].append(round(sum(i.get('roe') or 0 for i in items) / len(items) * 100, 2) if items else 0)
                        data['roa_data'].append(round(sum(i.get('roa') or 0 for i in items) / len(items) * 100, 2) if items else 0)
                        data['pe_ratio_data'].append(round(sum(i.get('pe') or 0 for i in items) / len(items), 2) if items else 0)
                        data['pb_ratio_data'].append(round(sum(i.get('pb') or 0 for i in items) / len(items), 2) if items else 0)
                        data['nim_data'].append(round(sum(i.get('nim') or 0 for i in items) / len(items) * 100, 2) if items else 0)
                        data['casa_data'].append(round(sum(i.get('casa_ratio') or 0 for i in items) / len(items) * 100, 2) if items else 0)
                        data['npl_data'].append(round(sum(i.get('npl') or 0 for i in items) / len(items) * 100, 2) if items else 0)
                else:
                    # Quarterly - take last 12 quarters
                    quarters = ratio_history[-12:]
                    data['years'] = []
                    data['roe_data'] = []
                    data['roa_data'] = []
                    data['pe_ratio_data'] = []
                    data['pb_ratio_data'] = []
                    data['nim_data'] = []
                    data['casa_data'] = []
                    data['npl_data'] = []
                    for q in quarters:
                        y = q.get('year') or ''
                        qr = q.get('quarter')
                        label = f"{y} Q{qr}" if qr else str(y)
                        data['years'].append(label)
                        roe = q.get('roe')
                        data['roe_data'].append(round(roe * 100, 2) if roe and abs(roe) < 1 else roe or 0)
                        roa = q.get('roa')
                        data['roa_data'].append(round(roa * 100, 2) if roa and abs(roa) < 1 else roa or 0)
                        data['pe_ratio_data'].append(q.get('pe') or 0)
                        data['pb_ratio_data'].append(q.get('pb') or 0)
                        nim = q.get('nim')
                        data['nim_data'].append(round(nim * 100, 2) if nim and abs(nim) < 1 else nim or 0)
                        casa = q.get('casa_ratio')
                        data['casa_data'].append(round(casa * 100, 2) if casa and abs(casa) < 1 else casa or 0)
                        npl = q.get('npl')
                        data['npl_data'].append(round(npl * 100, 2) if npl and abs(npl) < 1 else npl or 0)

                # Revenue/profit data placeholder (from financial statements)
                data.setdefault('revenue_data', [])
                data.setdefault('profit_data', [])

            # 5. Company description from JSON export (exported from stocks_optimized.db)
            try:
                from pathlib import Path
                if self._company_profiles_cache is None:
                    profile_path = Path(__file__).resolve().parents[1] / "exports" / "company_profile_export.json"
                    if profile_path.exists():
                        with open(profile_path, "r", encoding="utf-8") as f:
                            self._company_profiles_cache = json.load(f)
                    else:
                        self._company_profiles_cache = {}
                profile_data = self._company_profiles_cache.get(symbol, {})
                if profile_data:
                    cp = profile_data.get("company_profile") or ""
                    if cp:
                        data['overview'] = {'description': cp}
            except Exception:
                pass

            # 3c. Ensure all numeric fields have defaults (prevent frontend null errors)
            for key in ['eps', 'bvps', 'nim', 'casa', 'npl_ratio', 'ldr', 'cir', 'car',
                        'debt_to_equity', 'current_ratio', 'quick_ratio', 'cash_ratio']:
                if data.get(key) is None:
                    data[key] = 0

            data.setdefault('overview', {'description': "No description available."})
            data['success'] = True

            # Normalize missing sectors
            if not data.get('sector') or str(data.get('sector')).strip().lower() in ('', 'unknown', 'none'):
                data['sector'] = data.get('industry') or "Unknown"
            if not data.get('industry') or str(data.get('industry')).strip().lower() in ('', 'unknown', 'none'):
                data['industry'] = data.get('sector') or "Unknown"

            return data if data.get('name') or data.get('current_price') else None

        except Exception as e:
            logger.error(f"Error reading VCI data for {symbol}: {e}")
            return None

    def get_stock_data(self, symbol: str, period: str = "year", fetch_current_price: bool = False, symbols_override=None) -> dict:
        """Get stock data: Primary: DB (SQLite), Fallback: Live API (Parallel)"""
        symbol = symbol.upper()
        cache_key = f"{symbol}:{period}"
        _CACHE_TTL = 15  # seconds

        # Check TTL cache before hitting the DB
        cached = self._stock_data_cache.get(cache_key)
        if cached is not None:
            cached_data, cached_ts = cached
            if time.time() - cached_ts < _CACHE_TTL:
                logger.info(f"✓ Cache hit for {symbol} ({period})")
                result = dict(cached_data)  # shallow copy so we don't mutate the cache
                if fetch_current_price:
                    price_data = self.get_current_price_with_change(symbol)
                    if price_data:
                        result.update(price_data)
                        shares = result.get('shares_outstanding') or result.get('shareOutstanding')
                        if pd.notna(shares) and shares > 0:
                            result['market_cap'] = price_data['current_price'] * shares
                return result

        # 1. Try DB first
        data = self._get_data_from_db(symbol, period)
        if data:
            logger.info(f"✓ Found {symbol} in DB")
            # Store in cache without live price so cached copy stays price-neutral
            self._stock_data_cache[cache_key] = (dict(data), time.time())
            if fetch_current_price:
                price_data = self.get_current_price_with_change(symbol)
                if price_data:
                    data.update(price_data)
                    shares = data.get('shares_outstanding') or data.get('shareOutstanding')
                    if pd.notna(shares) and shares > 0:
                        data['market_cap'] = price_data['current_price'] * shares
            return data

        # 2. If not in DB (UPCOM or missing), fetch from Live API
        logger.info(f"Symbol {symbol} not in DB, fetching Live API data...")
        
        # Get metadata from ticker_data.json or Listing
        meta = self.ticker_metadata.get(symbol, {})
        company_info = {
            'organ_name': meta.get('name', symbol),
            'industry': meta.get('sector', 'Unknown'),
            'exchange': meta.get('exchange', 'Unknown'),
            'isbank': meta.get('isbank', False),
        }
        
        # Fallback to Listing API if metadata incomplete
        if company_info['industry'] == "Unknown" or company_info['exchange'] == "Unknown":
            api_meta = self._get_company_metadata_from_listing(symbol)
            if api_meta:
                if company_info['organ_name'] == symbol: company_info['organ_name'] = api_meta['organ_name']
                if company_info['industry'] == "Unknown": company_info['industry'] = api_meta['industry']
                if company_info['exchange'] == "Unknown": company_info['exchange'] = api_meta['exchange']
        
        live_data = self._get_vci_data(symbol, period)
        if live_data and live_data.get('success'):
            live_data.update({
                "symbol": symbol,
                "name": company_info['organ_name'],
                "sector": company_info['industry'],
                "exchange": company_info['exchange'],
                "isbank": company_info['isbank'],
                "data_period": period,
                "success": True
            })
            
            if fetch_current_price:
                price_data = self.get_current_price_with_change(symbol)
                if price_data:
                    live_data.update(price_data)
                    shares = live_data.get('shares_outstanding')
                    if pd.notna(shares) and shares > 0:
                        live_data['market_cap'] = price_data['current_price'] * shares
            return live_data
        
        return {"symbol": symbol, "success": False, "error": "Data not found in DB or API"}
        
    def get_stock_peers(self, symbol: str) -> list:
        """Get peer stocks in the same industry"""
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # 1. Get industry of the symbol
            cursor.execute("SELECT industry FROM overview WHERE symbol = ?", (symbol,))
            row = cursor.fetchone()
            industry = row['industry'] if row and row['industry'] else None
            if industry and isinstance(industry, str):
                industry = industry.strip() or None
            
            if not industry:
                # Fallback to metadata/listing
                industry = self._get_industry_for_symbol(symbol)
                
            if not industry or industry == "Unknown":
                conn.close()
                return []

            # 2. Get top 9 peers in same industry by market cap (excluding current symbol)
            # GROUP BY s.symbol to deduplicate — overview view can return multiple rows per
            # symbol when income_statement has duplicate (symbol, year, quarter) entries.
            cursor.execute("""
                SELECT
                    s.symbol,
                    MAX(c.name)               AS name,
                    MAX(s.industry)           AS industry,
                    MAX(s.current_price)      AS current_price,
                    MAX(s.pe)                 AS pe,
                    MAX(s.pb)                 AS pb,
                    MAX(s.roe)                AS roe,
                    MAX(s.roa)                AS roa,
                    MAX(s.market_cap)         AS market_cap,
                    MAX(s.net_profit_margin)  AS net_profit_margin,
                    MAX(s.profit_growth)      AS profit_growth
                FROM overview s
                LEFT JOIN company c ON s.symbol = c.symbol
                WHERE s.industry = ? AND s.symbol != ?
                GROUP BY s.symbol
                ORDER BY MAX(s.market_cap) DESC
                LIMIT 9
            """, (industry, symbol))

            peers = [dict(r) for r in cursor.fetchall()]

            # 3. Also fetch the current symbol's own row so it appears in the table
            cursor.execute("""
                SELECT
                    s.symbol,
                    MAX(c.name)               AS name,
                    MAX(s.industry)           AS industry,
                    MAX(s.current_price)      AS current_price,
                    MAX(s.pe)                 AS pe,
                    MAX(s.pb)                 AS pb,
                    MAX(s.roe)                AS roe,
                    MAX(s.roa)                AS roa,
                    MAX(s.market_cap)         AS market_cap,
                    MAX(s.net_profit_margin)  AS net_profit_margin,
                    MAX(s.profit_growth)      AS profit_growth
                FROM overview s
                LEFT JOIN company c ON s.symbol = c.symbol
                WHERE s.symbol = ?
                GROUP BY s.symbol
            """, (symbol,))
            current_row = cursor.fetchone()
            conn.close()

            # 3. Prefer fresher metrics from VCI screening + stats-financial when available.
            all_symbols = [str(p.get('symbol', '')).upper() for p in peers if p.get('symbol')]
            if current_row:
                all_symbols.append(symbol.upper())
            screening_map: dict[str, dict] = {}
            stats_fin_map: dict[str, dict] = {}
            ratio_daily_map: dict[str, dict] = {}
            if all_symbols:
                screening_map = get_screening_metrics_map(all_symbols)
                stats_fin_map = get_stats_financial_metrics_map(all_symbols)
                ratio_daily_map = get_ratio_daily_metrics_map(all_symbols)

            # Normalize keys to camelCase for frontend
            result = []

            # Insert current stock first with isCurrent flag
            if current_row:
                p = dict(current_row)
                sym = symbol.upper()
                p = apply_peer_source_priority(p, screening_map.get(sym), stats_fin_map.get(sym), ratio_daily_map.get(sym))
                p['price'] = p['current_price']
                p['marketCap'] = p['market_cap']
                p['netMargin'] = p['net_profit_margin']
                p['profitGrowth'] = p['profit_growth']
                p['isCurrent'] = True
                result.append(p)

            for p in peers:
                sym = str(p.get('symbol', '')).upper()
                p = apply_peer_source_priority(
                    p, screening_map.get(sym), stats_fin_map.get(sym), ratio_daily_map.get(sym)
                )
                p['price'] = p['current_price']
                p['marketCap'] = p['market_cap']
                p['netMargin'] = p['net_profit_margin']
                p['profitGrowth'] = p['profit_growth']
                p['isCurrent'] = False
                result.append(p)

            return result
            
        except Exception as e:
            logger.error(f"Error fetching peers for {symbol}: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return []

    def _get_vci_data(self, symbol: str, period: str) -> dict:
        """Fetch VCI data from SQLite database - SQLite-only implementation."""
        logger.info(f"Fetching VCI data from SQLite for {symbol} ({period})...")
        symbol = symbol.upper()

        financial_data = {"success": True, "data_source": "SQLite", "data_period": period}

        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            # A. Get latest ratios from financial_ratios table
            cursor.execute(
                "SELECT * FROM financial_ratios WHERE symbol = ? ORDER BY year DESC, quarter DESC LIMIT 1",
                (symbol,)
            )
            ratio_row = cursor.fetchone()
            if ratio_row:
                ratio_dict = dict(ratio_row)
                # Map common keys
                for key in ['roe', 'roa', 'eps', 'pe', 'pb', 'current_ratio', 'quick_ratio',
                            'debt_to_equity', 'net_margin', 'gross_margin', 'nim', 'car',
                            'casa_ratio', 'npl_ratio', 'ldr']:
                    if key in ratio_dict and ratio_dict[key] is not None:
                        val = float(ratio_dict[key])
                        # Store under expected keys
                        if key == 'pe': financial_data['pe_ratio'] = val
                        elif key == 'pb': financial_data['pb_ratio'] = val
                        elif key == 'roe': financial_data['roe'] = val
                        elif key == 'roa': financial_data['roa'] = val
                        elif key == 'eps': financial_data['eps'] = val
                        elif key == 'current_ratio': financial_data['current_ratio'] = val
                        elif key == 'quick_ratio': financial_data['quick_ratio'] = val
                        elif key == 'debt_to_equity': financial_data['debt_to_equity'] = val
                        elif key == 'net_margin': financial_data['net_margin'] = val
                        elif key == 'gross_margin': financial_data['gross_margin'] = val
                        elif key == 'nim': financial_data['nim'] = val
                        elif key == 'car': financial_data['car'] = val
                        elif key == 'casa_ratio': financial_data['casa'] = val
                        elif key == 'npl_ratio': financial_data['npl_ratio'] = val
                        elif key == 'ldr': financial_data['ldr'] = val

            # B. Get shares outstanding from company_overview
            cursor.execute(
                "SELECT issue_share, charter_capital FROM company_overview WHERE symbol = ?",
                (symbol,)
            )
            ov_row = cursor.fetchone()
            if ov_row:
                shares = ov_row["issue_share"]
                if shares:
                    financial_data['shares_outstanding'] = float(shares)

            conn.close()
        except Exception as e:
            logger.warning(f"SQLite VCI data fetch failed for {symbol}: {e}")

        return financial_data

    def get_current_price(self, symbol: str) -> Optional[dict]:
        """Get real-time current price for a symbol
        Returns: dict {price, source, open, high, low, ...} or None
        """
        res = self.get_current_price_with_change(symbol)
        if res:
             # Map fields to match what callers expect if needed
             return {
                 'price': res['current_price'],
                 'source': res['source'],
                 'open': res.get('open', 0),
                 'high': res.get('high', 0),
                 'low': res.get('low', 0),
                 'volume': res.get('volume', 0),
                 'ceiling': res.get('ceiling', 0),
                 'floor': res.get('floor', 0),
                 'ref': res.get('ref_price', 0)
             }
        return None

    def get_current_price_with_change(self, symbol: str) -> Optional[dict]:
        """Get real-time current price with price change data for a symbol
        Returns: dict with current_price, price_change, price_change_percent, and other details
        """
        symbol = symbol.upper()
        now = datetime.now()
        
        # 0. Check short-term cache.
        # Keep this very short during trading so first-load price does not stay stale.
        if symbol in self._price_cache:
            data, timestamp = self._price_cache[symbol]
            try:
                from backend.data_sources.vci import VCIClient
                in_trading = bool(VCIClient._is_trading_hours())
                ws_live = getattr(VCIClient, "_prices_source", "") == "SOCKET_IO"
                max_age_seconds = 1 if ws_live and in_trading else (2 if in_trading else 30)
            except Exception:
                max_age_seconds = 2
            if (now - timestamp).total_seconds() < max_age_seconds:
                logger.debug(f"✓ Returning CACHED price for {symbol}")
                return data

        try:
            logger.info(f"Fetching current price with change for {symbol}")
            
            # 1. Get Realtime Price (Priority: VCIClient directly for speed)
            from backend.data_sources.vci import VCIClient
            market_data = VCIClient.get_price_detail(symbol)

            if not market_data:
                return None

            # Normalize prices - VCI RAM/direct payloads are already full VND
            def normalize(v):
                if pd.isna(v) or v is None: return 0
                val = float(v)
                if 0 < val < 1000: return val * 1000  # heuristic for thousand-unit
                return val

            current_price = normalize(market_data.get('price') or market_data.get('c'))
            ref_price = normalize(market_data.get('ref_price') or market_data.get('ref'))

            if current_price <= 0:
                return None

            price_change = 0
            price_change_percent = 0
            if ref_price > 0:
                price_change = current_price - ref_price
                price_change_percent = (price_change / ref_price) * 100

            result = {
                "current_price": current_price,
                "price_change": price_change,
                "price_change_percent": price_change_percent,
                "source": market_data.get('source', 'VCI'),
                "open": normalize(market_data.get('open', 0)),
                "high": normalize(market_data.get('high', 0)),
                "low": normalize(market_data.get('low', 0)),
                "volume": float(market_data.get('volume', 0)),
                "ceiling": normalize(market_data.get('ceiling', 0)),
                "floor": normalize(market_data.get('floor', 0)),
                "ref_price": ref_price,
            }

            self._price_cache[symbol] = (result, now)
            return result

        except Exception as e:
            logger.error(f"Error fetching price with change for {symbol}: {e}")
            return None
