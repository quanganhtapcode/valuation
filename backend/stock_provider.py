import warnings
import os
import json
import sqlite3
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Any, Optional
warnings.filterwarnings('ignore', message='pkg_resources is deprecated as an API.*', category=UserWarning)

import os
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))

import pandas as pd
import numpy as np
import logging
import json
import sqlite3
from datetime import datetime, timedelta
from backend.data_sources import VCIClient
from backend.db_path import resolve_vci_screening_db_path
from backend.vci_data_access import VCIDataAccess
from backend.services.source_priority import apply_peer_source_priority, get_screening_metrics_map, get_stats_financial_metrics_map, get_ratio_daily_metrics_map
import logging

logger = logging.getLogger(__name__)

class StockDataProvider:
    def __init__(self):
        self.sources = ["VCI"]
        self._listing_cache = None
        self._stock_data_cache = {} # In-memory cache for stock details
        self._price_cache = {} # Short-term cache for realtime prices (TTL 30s)
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

    def _safe_get_multi_index(self, row: dict, key_tuple: tuple, default=np.nan):
        """
        Helper to get value from dict whether key is a Tuple ('A','B') or a String "('A', 'B')"
        This fixes the issue where JSON dump converts Tuples to Strings.
        """
        # 1. Try direct tuple access (Live API data often keeps tuples if not JSON serialized yet)
        if key_tuple in row:
            return row[key_tuple]
        
        # 2. Try string representation (DB stored data - JSON converted)
        # Python's str(tuple) format: "('A', 'B')" - exact match
        key_str = str(key_tuple)
        if key_str in row:
            return row[key_str]
        
        # 3. Fallback: normalized string lookup (handle spacing diffs)
        # "('Meta', 'yearReport')" vs "('Meta','yearReport')"
        # This is slower, use only if necessary
        key_clean = key_str.replace(" ", "")
        for k in row.keys():
            if isinstance(k, str) and k.startswith("('") and k.replace(" ", "") == key_clean:
                return row[k]
            
        return default

    def _get_quarter_data_from_db(self, symbol: str) -> dict:
        """Get latest quarter data from SQLite via VCIDataAccess."""
        try:
            quarter_data = {}

            # Get latest financial statements via VCIDataAccess
            bs = self.vci.get_financial_statement(symbol, "balance", limit=1)
            if bs:
                quarter_data['balance_sheet'] = bs[0]

            is_data = self.vci.get_financial_statement(symbol, "income", limit=1)
            if is_data:
                quarter_data['income_statement'] = is_data[0]

            cf = self.vci.get_financial_statement(symbol, "cashflow", limit=1)
            if cf:
                quarter_data['cash_flow'] = cf[0]

            # Get latest ratios
            ratios = self.vci.get_ratio_history(symbol)
            if ratios:
                quarter_data['ratios'] = ratios[-1]  # latest

            # Get company info
            company = self.vci.get_company_info(symbol)
            if company:
                quarter_data['overview'] = company

            return quarter_data
        except Exception as e:
            logger.error(f"Failed to get quarter data from DB for {symbol}: {e}")
            return {}

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

    def _get_organ_name_for_symbol(self, symbol: str) -> str:
        """Get company name from metadata or DB"""
        symbol_upper = symbol.upper()
        if symbol_upper in self.ticker_metadata:
            return self.ticker_metadata[symbol_upper].get('name', symbol_upper)
            
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM company WHERE symbol = ?", (symbol_upper,))
            row = cursor.fetchone()
            conn.close()
            return row[0] if row else symbol_upper
        except Exception:
            return symbol_upper

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
                import json
                from pathlib import Path
                profile_path = Path(__file__).resolve().parents[1] / "exports" / "company_profile_export.json"
                if profile_path.exists():
                    with open(profile_path, "r", encoding="utf-8") as f:
                        profiles = json.load(f)
                    profile_data = profiles.get(symbol, {})
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
        
        # 1. Try DB first
        data = self._get_data_from_db(symbol, period)
        if data:
            logger.info(f"✓ Found {symbol} in DB")
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

    def _process_quarter_data(self, quarter_data: dict, symbol: str, company_info: dict) -> dict:
        """Process quarter data from SQLite into the expected format"""
        processed = {
            "symbol": symbol,
            "name": company_info['organ_name'],
            "sector": company_info['industry'],
            "exchange": company_info['exchange'],
            "data_source": "VCI_Quarter",
            "success": True
        }
        
        try:
            # From balance sheet - using exact column names from debug
            if 'balance_sheet' in quarter_data:
                bs = quarter_data['balance_sheet']
                
                # Total assets - exact match from debug output
                if 'TOTAL ASSETS (Bn. VND)' in bs.index:
                    processed['total_assets'] = float(bs['TOTAL ASSETS (Bn. VND)'])
                
                # Owner's equity - exact match from debug output  
                if "OWNER'S EQUITY(Bn.VND)" in bs.index:
                    processed['total_equity'] = float(bs["OWNER'S EQUITY(Bn.VND)"])
                
                # Total liabilities
                if 'TOTAL LIABILITIES (Bn. VND)' in bs.index:
                    processed['total_liabilities'] = float(bs['TOTAL LIABILITIES (Bn. VND)'])
                    processed['total_debt'] = processed['total_liabilities']  # Often used interchangeably
                elif 'total_assets' in processed and 'total_equity' in processed:
                    # Calculate total debt if we have both total assets and equity
                    processed['total_debt'] = processed['total_assets'] - processed['total_equity']
                    processed['total_liabilities'] = processed['total_debt']
                
                # Current assets
                if 'Current assets (Bn. VND)' in bs.index:
                    processed['current_assets'] = float(bs['Current assets (Bn. VND)'])
                elif 'CURRENT ASSETS (Bn. VND)' in bs.index:
                    processed['current_assets'] = float(bs['CURRENT ASSETS (Bn. VND)'])
                
                # Current liabilities  
                if 'Current liabilities (Bn. VND)' in bs.index:
                    processed['current_liabilities'] = float(bs['Current liabilities (Bn. VND)'])
                elif 'CURRENT LIABILITIES (Bn. VND)' in bs.index:
                    processed['current_liabilities'] = float(bs['CURRENT LIABILITIES (Bn. VND)'])
                
                # Cash and cash equivalents
                cash_fields = [
                    'Cash and cash equivalents (Bn. VND)',
                    'CASH AND CASH EQUIVALENTS (Bn. VND)', 
                    'Cash (Bn. VND)',
                    'CASH (Bn. VND)'
                ]
                for field in cash_fields:
                    if field in bs.index and pd.notna(bs[field]):
                        processed['cash'] = float(bs[field])
                        break
                
                # Short-term investments
                if 'Short-term investments (Bn. VND)' in bs.index:
                    processed['short_term_investments'] = float(bs['Short-term investments (Bn. VND)'])
                
                # Inventory
                inventory_fields = [
                    'Inventory (Bn. VND)',
                    'INVENTORY (Bn. VND)',
                    'Inventories (Bn. VND)',
                    'INVENTORIES (Bn. VND)'
                ]
                for field in inventory_fields:
                    if field in bs.index and pd.notna(bs[field]):
                        processed['inventory'] = float(bs[field])
                        break
                
                # Accounts receivable
                receivable_fields = [
                    'Accounts receivable (Bn. VND)',
                    'ACCOUNTS RECEIVABLE (Bn. VND)',
                    'Trade receivables (Bn. VND)',
                    'TRADE RECEIVABLES (Bn. VND)'
                ]
                for field in receivable_fields:
                    if field in bs.index and pd.notna(bs[field]):
                        processed['accounts_receivable'] = float(bs[field])
                        break
                
                # Fixed assets / Property, Plant & Equipment
                fixed_asset_fields = [
                    'Property, plant and equipment (Bn. VND)',
                    'PROPERTY, PLANT AND EQUIPMENT (Bn. VND)',
                    'Fixed assets (Bn. VND)',
                    'FIXED ASSETS (Bn. VND)',
                    'PPE (Bn. VND)'
                ]
                for field in fixed_asset_fields:
                    if field in bs.index and pd.notna(bs[field]):
                        processed['fixed_assets'] = float(bs[field])
                        processed['ppe'] = float(bs[field])  # Alias
                        break
                
                # Working capital calculation
                if 'current_assets' in processed and 'current_liabilities' in processed:
                    processed['working_capital'] = processed['current_assets'] - processed['current_liabilities']
            
            # From income statement - Enhanced extraction
            if 'income_statement' in quarter_data:
                is_data = quarter_data['income_statement']
                
                # Revenue and other income statement items - prioritize absolute values over percentages
                for key in is_data.index:
                    key_str = str(key).upper()
                    value = is_data[key]
                    
                    # Skip if value is not numeric or is NaN
                    if not pd.notna(value):
                        continue
                    try:
                        value = float(value)
                    except (ValueError, TypeError):
                        continue
                    
                    # Revenue - prioritize absolute revenue over YoY percentages
                    if ('REVENUE' in key_str or 'DOANH THU' in key_str) and 'YOY' not in key_str and '%' not in key_str and 'GROWTH' not in key_str:
                        processed['revenue'] = value
                        processed['revenue_ttm'] = value * 4  # Approximate TTM
                    elif ('NET SALES' in key_str or 'SALES' in key_str) and 'DEDUCTION' not in key_str and 'YOY' not in key_str and '%' not in key_str and 'revenue' not in processed:
                        # Use net sales as backup if no revenue found
                        processed['revenue'] = value
                        processed['revenue_ttm'] = value * 4  # Approximate TTM
                    
                    # Net Income/Profit
                    elif ('NET INCOME' in key_str or 'NET PROFIT' in key_str or 'LỢI NHUẬN RÒNG' in key_str) and 'MARGIN' not in key_str and '%' not in key_str:
                        processed['net_income'] = value
                        processed['net_income_ttm'] = value * 4  # Approximate TTM
                    
                    # Gross Profit
                    elif ('GROSS PROFIT' in key_str or 'LÃI GỘP' in key_str) and 'MARGIN' not in key_str and '%' not in key_str:
                        processed['gross_profit'] = value
                    
                    # Operating Income/EBIT
                    elif ('OPERATING INCOME' in key_str or 'OPERATING PROFIT' in key_str or 'EBIT' in key_str) and 'MARGIN' not in key_str and '%' not in key_str:
                        processed['ebit'] = value
                        processed['operating_income'] = value  # Alias
                    
                    # EBITDA
                    elif 'EBITDA' in key_str and 'MARGIN' not in key_str and '%' not in key_str:
                        processed['ebitda'] = value
                    
                    # EBITDA Margin (for reference)
                    elif 'EBITDA MARGIN' in key_str:
                        if pd.notna(value):
                            processed['ebitda_margin'] = float(value) * 100 if abs(float(value)) < 1 else float(value)
                    
                    # Interest Expense
                    elif 'INTEREST EXPENSE' in key_str or 'FINANCIAL EXPENSE' in key_str:
                        processed['interest_expense'] = value
                    
                    # Cost of Goods Sold
                    elif ('COST OF GOODS SOLD' in key_str or 'COGS' in key_str or 'GIÁ VỐN' in key_str) and '%' not in key_str:
                        processed['cost_of_goods_sold'] = value
                        processed['cogs'] = value  # Alias
                    
                    # Selling, General & Administrative expenses
                    elif ('SG&A' in key_str or 'SELLING' in key_str or 'ADMINISTRATIVE' in key_str) and 'EXPENSE' in key_str and '%' not in key_str:
                        if 'sga_expenses' not in processed:
                            processed['sga_expenses'] = value
                        else:
                            processed['sga_expenses'] += value
                    
                    # Depreciation and Amortization
                    elif ('DEPRECIATION' in key_str or 'AMORTIZATION' in key_str) and '%' not in key_str:
                        processed['depreciation'] = value
                        # Calculate EBITDA if we have EBIT and depreciation
                        if 'ebit' in processed and pd.notna(processed['ebit']):
                            processed['ebitda'] = processed['ebit'] + value
                    
                    # Try to calculate EBITDA from EBIT + Depreciation if available
                    elif 'EBITDA' in key_str and 'MARGIN' not in key_str and '%' not in key_str:
                        processed['ebitda'] = value
                    
                    # Operating expenses (to help calculate operating income)
                    elif ('OPERATING EXPENSE' in key_str or 'OPERATING COST' in key_str) and '%' not in key_str:
                        processed['operating_expenses'] = value
                    
                    # Tax expense
                    elif ('TAX EXPENSE' in key_str or 'INCOME TAX' in key_str or 'CORPORATE TAX' in key_str) and '%' not in key_str:
                        processed['tax_expense'] = value
            
            # From ratios - using exact structure from debug
            if 'ratios' in quarter_data:
                ratios = quarter_data['ratios']
                
                # === PROFITABILITY RATIOS ===
                # ROE from exact path
                if ('Chỉ tiêu khả năng sinh lợi', 'ROE (%)') in ratios.index:
                    roe_value = ratios[('Chỉ tiêu khả năng sinh lợi', 'ROE (%)')]
                    if pd.notna(roe_value):
                        # Convert to percentage if needed
                        processed['roe'] = float(roe_value) * 100 if abs(float(roe_value)) < 1 else float(roe_value)
                
                # ROA from exact path
                if ('Chỉ tiêu khả năng sinh lợi', 'ROA (%)') in ratios.index:
                    roa_value = ratios[('Chỉ tiêu khả năng sinh lợi', 'ROA (%)')]
                    if pd.notna(roa_value):
                        # Convert to percentage if needed
                        processed['roa'] = float(roa_value) * 100 if abs(float(roa_value)) < 1 else float(roa_value)
                
                # ROIC
                if ('Chỉ tiêu khả năng sinh lợi', 'ROIC (%)') in ratios.index:
                    roic_value = ratios[('Chỉ tiêu khả năng sinh lợi', 'ROIC (%)')]
                    if pd.notna(roic_value):
                        # Convert to percentage if needed
                        processed['roic'] = float(roic_value) * 100 if abs(float(roic_value)) < 1 else float(roic_value)
                
                # Net Profit Margin
                if ('Chỉ tiêu khả năng sinh lợi', 'Net Profit Margin (%)') in ratios.index:
                    npm_value = ratios[('Chỉ tiêu khả năng sinh lợi', 'Net Profit Margin (%)')]
                    if pd.notna(npm_value):
                        # Convert to percentage if needed
                        processed['net_margin'] = float(npm_value) * 100 if abs(float(npm_value)) < 1 else float(npm_value)
                        processed['net_profit_margin'] = processed['net_margin']  # Alias
                
                # Gross Profit Margin
                if ('Chỉ tiêu khả năng sinh lợi', 'Gross Profit Margin (%)') in ratios.index:
                    gpm_value = ratios[('Chỉ tiêu khả năng sinh lợi', 'Gross Profit Margin (%)')]
                    if pd.notna(gpm_value):
                        # Convert to percentage if needed
                        processed['gross_margin'] = float(gpm_value) * 100 if abs(float(gpm_value)) < 1 else float(gpm_value)
                        processed['gross_profit_margin'] = processed['gross_margin']  # Alias
                
                # EBIT Margin
                if ('Chỉ tiêu khả năng sinh lợi', 'EBIT Margin (%)') in ratios.index:
                    ebit_margin_value = ratios[('Chỉ tiêu khả năng sinh lợi', 'EBIT Margin (%)')]
                    if pd.notna(ebit_margin_value):
                        processed['ebit_margin'] = float(ebit_margin_value) * 100 if abs(float(ebit_margin_value)) < 1 else float(ebit_margin_value)
                
                # === VALUATION RATIOS ===
                # P/E ratio from exact path
                if ('Chỉ tiêu định giá', 'P/E') in ratios.index:
                    pe_value = ratios[('Chỉ tiêu định giá', 'P/E')]
                    if pd.notna(pe_value):
                        processed['pe_ratio'] = float(pe_value)
                
                # P/B ratio from exact path
                if ('Chỉ tiêu định giá', 'P/B') in ratios.index:
                    pb_value = ratios[('Chỉ tiêu định giá', 'P/B')]
                    if pd.notna(pb_value):
                        processed['pb_ratio'] = float(pb_value)
                
                # P/S ratio
                if ('Chỉ tiêu định giá', 'P/S') in ratios.index:
                    ps_value = ratios[('Chỉ tiêu định giá', 'P/S')]
                    if pd.notna(ps_value):
                        processed['ps_ratio'] = float(ps_value)
                
                # P/CF ratio
                if ('Chỉ tiêu định giá', 'P/CF') in ratios.index:
                    pcf_value = ratios[('Chỉ tiêu định giá', 'P/CF')]
                    if pd.notna(pcf_value):
                        processed['pcf_ratio'] = float(pcf_value)
                elif ('Chỉ tiêu định giá', 'P/Cash Flow') in ratios.index:
                    pcf_value = ratios[('Chỉ tiêu định giá', 'P/Cash Flow')]
                    if pd.notna(pcf_value):
                        processed['pcf_ratio'] = float(pcf_value)
                
                # EV/EBITDA
                if ('Chỉ tiêu định giá', 'EV/EBITDA') in ratios.index:
                    ev_ebitda_value = ratios[('Chỉ tiêu định giá', 'EV/EBITDA')]
                    if pd.notna(ev_ebitda_value):
                        processed['ev_ebitda'] = float(ev_ebitda_value)
                
                # EBITDA (absolute value)
                if ('Chỉ tiêu khả năng sinh lợi', 'EBITDA (Bn. VND)') in ratios.index:
                    ebitda_value = ratios[('Chỉ tiêu khả năng sinh lợi', 'EBITDA (Bn. VND)')]
                    if pd.notna(ebitda_value):
                        processed['ebitda'] = float(ebitda_value)
                
                # Outstanding shares from exact path
                if ('Chỉ tiêu định giá', 'Outstanding Share (Mil. Shares)') in ratios.index:
                    shares_value = ratios[('Chỉ tiêu định giá', 'Outstanding Share (Mil. Shares)')]
                    if pd.notna(shares_value):
                        processed['shares_outstanding'] = float(shares_value) * 1000000  # Convert from millions
                elif ('Chỉ tiêu định giá', 'Outstanding Shares (Mil. Shares)') in ratios.index:
                    shares_value = ratios[('Chỉ tiêu định giá', 'Outstanding Shares (Mil. Shares)')]
                    if pd.notna(shares_value):
                        processed['shares_outstanding'] = float(shares_value) * 1000000  # Convert from millions
                
                # Market cap from exact path
                if ('Chỉ tiêu định giá', 'Market Capital (Bn. VND)') in ratios.index:
                    market_cap_value = ratios[('Chỉ tiêu định giá', 'Market Capital (Bn. VND)')]
                    if pd.notna(market_cap_value):
                        processed['market_cap'] = float(market_cap_value)
                
                # EPS from exact path
                if ('Chỉ tiêu định giá', 'EPS (VND)') in ratios.index:
                    eps_value = ratios[('Chỉ tiêu định giá', 'EPS (VND)')]
                    if pd.notna(eps_value):
                        processed['eps'] = float(eps_value)
                        processed['eps_ttm'] = float(eps_value)  # For quarter data, treat as TTM
                
                # BVPS (Book Value Per Share) from exact path
                if ('Chỉ tiêu định giá', 'BVPS (VND)') in ratios.index:
                    bvps_value = ratios[('Chỉ tiêu định giá', 'BVPS (VND)')]
                    if pd.notna(bvps_value):
                        processed['book_value_per_share'] = float(bvps_value)
                        processed['bvps'] = float(bvps_value)  # Alias
                
                # === LEVERAGE RATIOS ===
                # Debt/Equity ratio
                if ('Chỉ tiêu cơ cấu nguồn vốn', 'Debt/Equity') in ratios.index:
                    de_value = ratios[('Chỉ tiêu cơ cấu nguồn vốn', 'Debt/Equity')]
                    if pd.notna(de_value):
                        processed['debt_to_equity'] = float(de_value)
                
                # Financial Leverage (can be used as equity multiplier)
                if ('Chỉ tiêu thanh khoản', 'Financial Leverage') in ratios.index:
                    fl_value = ratios[('Chỉ tiêu thanh khoản', 'Financial Leverage')]
                    if pd.notna(fl_value):
                        processed['financial_leverage'] = float(fl_value)
                        processed['equity_multiplier'] = float(fl_value)
                
                # === LIQUIDITY RATIOS ===
                # Current Ratio
                if ('Chỉ tiêu thanh khoản', 'Current Ratio') in ratios.index:
                    cr_value = ratios[('Chỉ tiêu thanh khoản', 'Current Ratio')]
                    if pd.notna(cr_value):
                        processed['current_ratio'] = float(cr_value)
                
                # Quick Ratio
                if ('Chỉ tiêu thanh khoản', 'Quick Ratio') in ratios.index:
                    qr_value = ratios[('Chỉ tiêu thanh khoản', 'Quick Ratio')]
                    if pd.notna(qr_value):
                        processed['quick_ratio'] = float(qr_value)
                
                # Cash Ratio
                if ('Chỉ tiêu thanh khoản', 'Cash Ratio') in ratios.index:
                    cash_ratio_value = ratios[('Chỉ tiêu thanh khoản', 'Cash Ratio')]
                    if pd.notna(cash_ratio_value):
                        processed['cash_ratio'] = float(cash_ratio_value)
                
                # === ACTIVITY/TURNOVER RATIOS ===
                # Asset Turnover
                if ('Chỉ tiêu hoạt động', 'Asset Turnover') in ratios.index:
                    at_value = ratios[('Chỉ tiêu hoạt động', 'Asset Turnover')]
                    if pd.notna(at_value):
                        processed['asset_turnover'] = float(at_value)
                elif ('Chỉ tiêu hiệu quả hoạt động', 'Asset Turnover') in ratios.index:
                    at_value = ratios[('Chỉ tiêu hiệu quả hoạt động', 'Asset Turnover')]
                    if pd.notna(at_value):
                        processed['asset_turnover'] = float(at_value)
                
                # Inventory Turnover
                if ('Chỉ tiêu hoạt động', 'Inventory Turnover') in ratios.index:
                    it_value = ratios[('Chỉ tiêu hoạt động', 'Inventory Turnover')]
                    if pd.notna(it_value):
                        processed['inventory_turnover'] = float(it_value)
                elif ('Chỉ tiêu hiệu quả hoạt động', 'Inventory Turnover') in ratios.index:
                    it_value = ratios[('Chỉ tiêu hiệu quả hoạt động', 'Inventory Turnover')]
                    if pd.notna(it_value):
                        processed['inventory_turnover'] = float(it_value)
                
                # Receivables Turnover
                if ('Chỉ tiêu hoạt động', 'Receivables Turnover') in ratios.index:
                    rt_value = ratios[('Chỉ tiêu hoạt động', 'Receivables Turnover')]
                    if pd.notna(rt_value):
                        processed['receivables_turnover'] = float(rt_value)
                elif ('Chỉ tiêu hiệu quả hoạt động', 'Receivables Turnover') in ratios.index:
                    rt_value = ratios[('Chỉ tiêu hiệu quả hoạt động', 'Receivables Turnover')]
                    if pd.notna(rt_value):
                        processed['receivables_turnover'] = float(rt_value)
                
                # Fixed Asset Turnover
                if ('Chỉ tiêu hoạt động', 'Fixed Asset Turnover') in ratios.index:
                    fat_value = ratios[('Chỉ tiêu hoạt động', 'Fixed Asset Turnover')]
                    if pd.notna(fat_value):
                        processed['fixed_asset_turnover'] = float(fat_value)
                elif ('Chỉ tiêu hiệu quả hoạt động', 'Fixed Asset Turnover') in ratios.index:
                    fat_value = ratios[('Chỉ tiêu hiệu quả hoạt động', 'Fixed Asset Turnover')]
                    if pd.notna(fat_value):
                        processed['fixed_asset_turnover'] = float(fat_value)
                
                # Working Capital Turnover
                if ('Chỉ tiêu hoạt động', 'Working Capital Turnover') in ratios.index:
                    wct_value = ratios[('Chỉ tiêu hoạt động', 'Working Capital Turnover')]
                    if pd.notna(wct_value):
                        processed['working_capital_turnover'] = float(wct_value)
                elif ('Chỉ tiêu hiệu quả hoạt động', 'Working Capital Turnover') in ratios.index:
                    wct_value = ratios[('Chỉ tiêu hiệu quả hoạt động', 'Working Capital Turnover')]
                    if pd.notna(wct_value):
                        processed['working_capital_turnover'] = float(wct_value)
                
                # === COVERAGE RATIOS ===
                # Interest Coverage Ratio
                if ('Chỉ tiêu thanh khoản', 'Interest Coverage') in ratios.index:
                    ic_value = ratios[('Chỉ tiêu thanh khoản', 'Interest Coverage')]
                    if pd.notna(ic_value):
                        processed['interest_coverage'] = float(ic_value)
                elif ('Chỉ tiêu khả năng thanh toán', 'Interest Coverage') in ratios.index:
                    ic_value = ratios[('Chỉ tiêu khả năng thanh toán', 'Interest Coverage')]
                    if pd.notna(ic_value):
                        processed['interest_coverage'] = float(ic_value)
                elif ('Chỉ tiêu thanh toán', 'Interest Coverage') in ratios.index:
                    ic_value = ratios[('Chỉ tiêu thanh toán', 'Interest Coverage')]
                    if pd.notna(ic_value):
                        processed['interest_coverage'] = float(ic_value)
                
                # === DIVIDEND RATIOS ===
                # Dividend Yield
                if ('Chỉ tiêu định giá', 'Dividend Yield (%)') in ratios.index:
                    dy_value = ratios[('Chỉ tiêu định giá', 'Dividend Yield (%)')]
                    if pd.notna(dy_value):
                        processed['dividend_yield'] = float(dy_value) * 100 if abs(float(dy_value)) < 1 else float(dy_value)
                
                # Dividend per Share
                if ('Chỉ tiêu định giá', 'DPS (VND)') in ratios.index:
                    dps_value = ratios[('Chỉ tiêu định giá', 'DPS (VND)')]
                    if pd.notna(dps_value):
                        processed['dividend_per_share'] = float(dps_value)
                
                # Payout Ratio
                if ('Chỉ tiêu định giá', 'Payout Ratio (%)') in ratios.index:
                    pr_value = ratios[('Chỉ tiêu định giá', 'Payout Ratio (%)')]
                    if pd.notna(pr_value):
                        processed['payout_ratio'] = float(pr_value) * 100 if abs(float(pr_value)) < 1 else float(pr_value)
                
                # === ADDITIONAL METRICS ===
                # Revenue Growth (if available)
                if ('Chỉ tiêu tăng trưởng', 'Revenue Growth (%)') in ratios.index:
                    rg_value = ratios[('Chỉ tiêu tăng trưởng', 'Revenue Growth (%)')]
                    if pd.notna(rg_value):
                        processed['revenue_growth'] = float(rg_value) * 100 if abs(float(rg_value)) < 1 else float(rg_value)
                elif ('Chỉ tiêu tăng trưởng', 'Doanh thu tăng trưởng (%)') in ratios.index:
                    rg_value = ratios[('Chỉ tiêu tăng trưởng', 'Doanh thu tăng trưởng (%)')]
                    if pd.notna(rg_value):
                        processed['revenue_growth'] = float(rg_value) * 100 if abs(float(rg_value)) < 1 else float(rg_value)
                
                # Earnings Growth
                if ('Chỉ tiêu tăng trưởng', 'Earnings Growth (%)') in ratios.index:
                    eg_value = ratios[('Chỉ tiêu tăng trưởng', 'Earnings Growth (%)')]
                    if pd.notna(eg_value):
                        processed['earnings_growth'] = float(eg_value) * 100 if abs(float(eg_value)) < 1 else float(eg_value)
                
                # Net margin alternative names
                if 'net_margin' not in processed:
                    net_margin_fields = [
                        ('Chỉ tiêu khả năng sinh lợi', 'Net Margin (%)'),
                        ('Chỉ tiêu khả năng sinh lợi', 'Biên lợi nhuận ròng (%)'),
                        ('Chỉ tiêu hiệu quả', 'Net Profit Margin (%)')
                    ]
                    for field in net_margin_fields:
                        if field in ratios.index:
                            nm_value = ratios[field]
                            if pd.notna(nm_value):
                                processed['net_margin'] = float(nm_value) * 100 if abs(float(nm_value)) < 1 else float(nm_value)
                                processed['net_profit_margin'] = processed['net_margin']
                                break
                
                # Operating margin
                if ('Chỉ tiêu khả năng sinh lợi', 'Operating Margin (%)') in ratios.index:
                    om_value = ratios[('Chỉ tiêu khả năng sinh lợi', 'Operating Margin (%)')]
                    if pd.notna(om_value):
                        processed['operating_margin'] = float(om_value) * 100 if abs(float(om_value)) < 1 else float(om_value)
                
                # === ALTERNATIVE RATIO NAMES FOR BACKUP ===
                # Alternative PE ratio names
                if 'pe_ratio' not in processed:
                    pe_fields = [
                        ('Chỉ tiêu định giá', 'P/E Ratio'),
                        ('Chỉ tiêu định giá', 'PE'),
                        ('Định giá', 'P/E')
                    ]
                    for field in pe_fields:
                        if field in ratios.index:
                            pe_value = ratios[field]
                            if pd.notna(pe_value):
                                processed['pe_ratio'] = float(pe_value)
                                break
                
                # Alternative PB ratio names  
                if 'pb_ratio' not in processed:
                    pb_fields = [
                        ('Chỉ tiêu định giá', 'P/B Ratio'),
                        ('Chỉ tiêu định giá', 'PB'),
                        ('Định giá', 'P/B')
                    ]
                    for field in pb_fields:
                        if field in ratios.index:
                            pb_value = ratios[field]
                            if pd.notna(pb_value):
                                processed['pb_ratio'] = float(pb_value)
                                break
            
            # From cash flow statement - Enhanced extraction
            if 'cash_flow' in quarter_data:
                cf_data = quarter_data['cash_flow']
                
                for key in cf_data.index:
                    key_str = str(key).upper()
                    value = cf_data[key]
                    
                    # Skip if value is not numeric or is NaN
                    if not pd.notna(value):
                        continue
                    try:
                        value = float(value)
                    except (ValueError, TypeError):
                        continue
                    
                    # Operating Cash Flow - Enhanced detection
                    if ('OPERATING CASH FLOW' in key_str or 
                        'CASH FROM OPERATIONS' in key_str or 
                        'CASH FROM OPERATING ACTIVITIES' in key_str or
                        'NET CASH FROM OPERATING ACTIVITIES' in key_str or
                        'NET OPERATING CASH FLOW' in key_str or
                        'OPERATING ACTIVITIES' in key_str or
                        'OPERATING PROFIT BEFORE CHANGES' in key_str):
                        processed['operating_cash_flow'] = value
                        processed['cash_from_operations'] = value  # Alias
                    
                    # Capital Expenditures
                    elif ('CAPITAL EXPENDITURE' in key_str or 
                          'CAPEX' in key_str or
                          'PURCHASE OF PROPERTY' in key_str or
                          'INVESTMENTS IN FIXED ASSETS' in key_str or
                          'PURCHASE OF PPE' in key_str):
                        processed['capex'] = abs(value)  # Usually negative, make positive
                        processed['capital_expenditure'] = abs(value)  # Alias
                    
                    # Free Cash Flow (if directly available)
                    elif 'FREE CASH FLOW' in key_str:
                        processed['free_cash_flow'] = value
                        processed['fcf'] = value  # Alias
                    
                    # Cash from Investing Activities
                    elif ('CASH FROM INVESTING' in key_str or 
                          'NET CASH FROM INVESTING' in key_str or
                          'INVESTING CASH FLOW' in key_str):
                        processed['cash_from_investing'] = value
                    
                    # Cash from Financing Activities
                    elif ('CASH FROM FINANCING' in key_str or 
                          'NET CASH FROM FINANCING' in key_str or
                          'FINANCING CASH FLOW' in key_str):
                        processed['cash_from_financing'] = value
                    
                    # Dividends Paid
                    elif ('DIVIDEND' in key_str and 'PAID' in key_str) or 'CASH DIVIDEND' in key_str:
                        processed['dividends_paid'] = abs(value)  # Usually negative, make positive
                    
                    # Share Repurchases
                    elif ('SHARE REPURCHASE' in key_str or 
                          'STOCK REPURCHASE' in key_str or
                          'TREASURY STOCK' in key_str):
                        processed['share_repurchases'] = abs(value)
                    
                    # Debt Issued/Repaid
                    elif 'DEBT ISSUE' in key_str or 'BORROW' in key_str:
                        processed['debt_issued'] = value
                    elif 'DEBT REPAY' in key_str or 'DEBT PAYMENT' in key_str:
                        processed['debt_repaid'] = abs(value)
                
                # Calculate Free Cash Flow if not directly available
                if 'free_cash_flow' not in processed:
                    ocf = processed.get('operating_cash_flow')
                    capex = processed.get('capex', 0)
                    if pd.notna(ocf):
                        processed['free_cash_flow'] = ocf - capex
                        processed['fcf'] = processed['free_cash_flow']  # Alias
                
                # Calculate FCFE (Free Cash Flow to Equity)
                fcf = processed.get('free_cash_flow')
                debt_issued = processed.get('debt_issued', 0)
                debt_repaid = processed.get('debt_repaid', 0)
                if pd.notna(fcf):
                    net_debt_change = debt_issued - debt_repaid
                    processed['fcfe'] = fcf + net_debt_change
            
            # From company overview - get additional info if available
            if 'overview' in quarter_data:
                overview = quarter_data['overview']
                
                # Issue shares (alternative source for shares outstanding) - only if not already set from ratios
                # Skip this entirely if we have ratios data, as it's more reliable
                if 'issue_share' in overview.index and not processed.get('shares_outstanding'):
                    shares_value = overview['issue_share']
                    if pd.notna(shares_value):
                        # Check if the value seems reasonable (not in trillions)
                        shares_float = float(shares_value)
                        if shares_float > 1e12:  # If larger than 1 trillion, likely in wrong unit
                            shares_float = shares_float / 1000  # Convert from thousands to actual shares
                        processed['shares_outstanding'] = shares_float
                
                # Charter capital
                if 'charter_capital' in overview.index:
                    charter_capital = overview['charter_capital']
                    if pd.notna(charter_capital):
                        processed['charter_capital'] = float(charter_capital)
        
        except Exception as e:
            logger.warning(f"Error processing quarter data for {symbol}: {e}")
        
        # Post-processing: Validate and fix shares outstanding
        if 'shares_outstanding' in processed:
            shares = processed['shares_outstanding']
            # If shares outstanding seems too large (> 1 trillion), it's likely in wrong unit
            if shares > 1e12:
                processed['shares_outstanding'] = shares / 1000
        
        # Ensure we have all key financial ratios and metrics
        self._ensure_quarter_data_completeness(processed)
        
        # Calculate missing ratios from available data
        processed = self.calculate_missing_ratios(processed)
        
        return processed

    def _ensure_quarter_data_completeness(self, processed: dict):
        """Ensure quarter data has all necessary fields for consistency with annual data"""
        
        # Add earnings per share calculation if missing
        if 'eps' not in processed and 'net_income' in processed and 'shares_outstanding' in processed:
            if pd.notna(processed['net_income']) and pd.notna(processed['shares_outstanding']) and processed['shares_outstanding'] > 0:
                # For quarterly EPS, multiply by 4 to annualize
                processed['eps'] = (processed['net_income'] * 4) / processed['shares_outstanding']
                processed['eps_ttm'] = processed['eps']
        
        # Add book value per share if missing
        if 'book_value_per_share' not in processed and 'bvps' not in processed:
            if 'total_equity' in processed and 'shares_outstanding' in processed:
                if pd.notna(processed['total_equity']) and pd.notna(processed['shares_outstanding']) and processed['shares_outstanding'] > 0:
                    bvps = processed['total_equity'] / processed['shares_outstanding']
                    processed['book_value_per_share'] = bvps
                    processed['bvps'] = bvps
        
        # Add dividend yield if missing but we have other dividend data
        if 'dividend_yield' not in processed and 'dividend_per_share' in processed and 'current_price' in processed:
            if pd.notna(processed['dividend_per_share']) and pd.notna(processed['current_price']) and processed['current_price'] > 0:
                processed['dividend_yield'] = (processed['dividend_per_share'] / processed['current_price']) * 100
        
        # Add price-to-cash-flow ratio if missing
        if 'pcf_ratio' not in processed and 'operating_cash_flow' in processed and 'shares_outstanding' in processed and 'current_price' in processed:
            if all(pd.notna(processed[key]) for key in ['operating_cash_flow', 'shares_outstanding', 'current_price']):
                if processed['shares_outstanding'] > 0 and processed['operating_cash_flow'] != 0:
                    cash_flow_per_share = (processed['operating_cash_flow'] * 4) / processed['shares_outstanding']  # Annualize
                    if cash_flow_per_share > 0:
                        processed['pcf_ratio'] = processed['current_price'] / cash_flow_per_share
        
        # Alternative P/CF calculation using quarterly data without annualizing if we don't have current price
        elif 'pcf_ratio' not in processed and 'operating_cash_flow' in processed and 'shares_outstanding' in processed:
            if pd.notna(processed['operating_cash_flow']) and pd.notna(processed['shares_outstanding']) and processed['shares_outstanding'] > 0:
                # Try to get current price from fetch if available
                current_price = processed.get('current_price')
                if current_price and pd.notna(current_price):
                    cash_flow_per_share = (processed['operating_cash_flow'] * 4) / processed['shares_outstanding']
                    if cash_flow_per_share > 0:
                        processed['pcf_ratio'] = current_price / cash_flow_per_share
        
        # Add interest coverage ratio if missing
        if 'interest_coverage' not in processed and 'ebit' in processed and 'interest_expense' in processed:
            if pd.notna(processed['ebit']) and pd.notna(processed['interest_expense']) and processed['interest_expense'] != 0:
                # Interest expense is usually negative, so we take absolute value for the calculation
                interest_expense_abs = abs(processed['interest_expense'])
                processed['interest_coverage'] = processed['ebit'] / interest_expense_abs
        
        # Add EBITDA if missing but we have EBIT and depreciation
        if 'ebitda' not in processed and 'ebit' in processed and 'depreciation' in processed:
            if pd.notna(processed['ebit']) and pd.notna(processed['depreciation']):
                processed['ebitda'] = processed['ebit'] + processed['depreciation']
        
        # If we still don't have EBITDA, try to estimate it from other data
        elif 'ebitda' not in processed and 'net_income' in processed and 'interest_expense' in processed and 'tax_expense' in processed and 'depreciation' in processed:
            # EBITDA = Net Income + Interest + Tax + Depreciation + Amortization
            components = [processed.get(key, 0) for key in ['net_income', 'tax_expense', 'depreciation']]
            interest_abs = abs(processed.get('interest_expense', 0))
            if all(pd.notna(x) for x in components) and pd.notna(interest_abs):
                processed['ebitda'] = sum(components) + interest_abs
        
        # Add enterprise value if missing
        if 'enterprise_value' not in processed and 'market_cap' in processed:
            market_cap = processed['market_cap']
            cash = processed.get('cash', 0)
            total_debt = processed.get('total_debt', 0)
            if pd.notna(market_cap):
                ev = market_cap + total_debt - cash
                processed['enterprise_value'] = ev
        
        # Add EV/EBITDA alternative calculation if missing
        if 'ev_ebitda' not in processed and 'enterprise_value' in processed and 'ebitda' in processed:
            if pd.notna(processed['enterprise_value']) and pd.notna(processed['ebitda']) and processed['ebitda'] > 0:
                processed['ev_ebitda'] = processed['enterprise_value'] / (processed['ebitda'] * 4)  # Annualize EBITDA
        
        # Add working capital if not calculated
        if 'working_capital' not in processed and 'current_assets' in processed and 'current_liabilities' in processed:
            if pd.notna(processed['current_assets']) and pd.notna(processed['current_liabilities']):
                processed['working_capital'] = processed['current_assets'] - processed['current_liabilities']
        
        # Add net debt if missing
        if 'net_debt' not in processed and 'total_debt' in processed and 'cash' in processed:
            if pd.notna(processed['total_debt']) and pd.notna(processed['cash']):
                processed['net_debt'] = processed['total_debt'] - processed['cash']
        
        # Ensure we have TTM versions of key metrics
        for base_metric in ['revenue', 'net_income', 'ebit', 'ebitda']:
            ttm_key = f"{base_metric}_ttm"
            if ttm_key not in processed and base_metric in processed:
                if pd.notna(processed[base_metric]):
                    processed[ttm_key] = processed[base_metric] * 4  # Annualize quarterly data
        
        # Add data quality indicators
        processed['data_quality'] = {
            'has_financials': any(key in processed for key in ['revenue', 'net_income', 'total_assets']),
            'has_real_price': 'current_price' in processed and pd.notna(processed.get('current_price')),
            'pe_reliable': 'pe_ratio' in processed and pd.notna(processed.get('pe_ratio')),
            'pb_reliable': 'pb_ratio' in processed and pd.notna(processed.get('pb_ratio')),
            'vci_data': True  # Quarter data always comes from VCI
        }

    def _get_live_stock_data(self, symbol: str, period: str = "year") -> dict:
        """Fallback method using live API - same as original implementation"""
        logger.info(f"Attempting to get live data from VCI for {symbol}")
        vci_data = self._get_vci_data(symbol, period)
        if vci_data and vci_data.get('success'):
            # Use company info from CSV if available
            company_info = self._get_company_info_from_csv(symbol)
            vci_data.update({
                "symbol": symbol,
                "name": company_info['organ_name'],
                "exchange": company_info['exchange'],
                "sector": company_info['industry'],
                "data_period": period,
                "price_change": np.nan
            })
            # Get current price from VCI
            try:
                from backend.data_sources.vci import VCIClient
                price_data = VCIClient.get_price_detail(symbol)
                if price_data and price_data.get('price'):
                    vci_data["current_price"] = price_data['price']
            except Exception:
                pass
            if pd.notna(vci_data.get("current_price")) and pd.notna(vci_data.get("shares_outstanding")):
                vci_data["market_cap"] = vci_data["current_price"] * vci_data["shares_outstanding"]
            return vci_data

        logger.warning(f"VCI comprehensive data failed for {symbol}")
        raise RuntimeError(f"VCI data sources failed for {symbol}")

    def reload_data(self):
        """Reload stock data from file - useful for updating without restarting server"""
        logger.info("Reloading stock data from file...")
        success = self._load_stock_data()
        if success:
            logger.info("Stock data reloaded successfully")
        else:
            logger.error("Failed to reload stock data")
        return success

    def _get_company_overview(self, stock, symbol: str) -> dict:
        try:
            symbols_df = stock.listing.symbols_by_exchange()
            industries_df = stock.listing.symbols_by_industries()
            company_info = symbols_df[symbols_df['symbol'] == symbol] if not symbols_df.empty else pd.DataFrame()
            industry_info = industries_df[industries_df['symbol'] == symbol] if not industries_df.empty else pd.DataFrame()
            name = symbol
            exchange = "HOSE"
            sector = self._get_industry_for_symbol(symbol)
            shares = np.nan
            if not company_info.empty:
                name_fields = ["organ_short_name", "organ_name", "short_name", "company_name"]
                for f in name_fields:
                    if f in company_info.columns and pd.notna(company_info[f].iloc[0]) and str(company_info[f].iloc[0]).strip():
                        name = str(company_info[f].iloc[0])
                        break
                exchange_fields = ["exchange", "comGroupCode", "type"]
                for f in exchange_fields:
                    if f in company_info.columns and pd.notna(company_info[f].iloc[0]):
                        exchange = str(company_info[f].iloc[0])
                        break
                share_fields = ["listed_share", "issue_share", "outstanding_share", "sharesOutstanding", "totalShares"]
                for f in share_fields:
                    if f in company_info.columns and pd.notna(company_info[f].iloc[0]):
                        shares = float(company_info[f].iloc[0])
                        break
            if not industry_info.empty:
                sector_fields = ["icb_name2", "icb_name3", "icb_name4", "industry", "industryName"]
                for f in sector_fields:
                    if f in industry_info.columns and pd.notna(industry_info[f].iloc[0]) and str(industry_info[f].iloc[0]).strip():
                        sector = str(industry_info[f].iloc[0])
                        break
            if pd.isna(shares) or name == symbol:
                try:
                    overview = stock.company.overview()
                    if overview is not None and not overview.empty:
                        row = overview.iloc[0]
                        if pd.isna(shares):
                            share_fields = ["issue_share", "listed_share", "outstanding_share", "sharesOutstanding", "totalShares"]
                            for f in share_fields:
                                if f in row and pd.notna(row[f]):
                                    shares = float(row[f])
                                    break
                        if name == symbol:
                            name_fields = ["organ_name", "short_name", "company_name", "shortName"]
                            for f in name_fields:
                                if f in row and pd.notna(row[f]) and str(row[f]).strip():
                                    name = str(row[f])
                                    break
                except Exception as e:
                    pass
            return {
                "symbol": symbol,
                "name": name,
                "exchange": exchange,
                "sector": sector,
                "shares_outstanding": shares
            }
        except Exception as e:
            logger.warning(f"Company overview failed for {symbol}: {e}")
            return {
                "symbol": symbol,
                "name": symbol,
                "exchange": "HOSE",
                "sector": self._get_industry_for_symbol(symbol),
                "shares_outstanding": np.nan
            }

    def _get_financial_statements(self, stock, period: str) -> dict:
        is_quarter = (period == "quarter")
        freq = "quarter" if is_quarter else "year"
        try:
            income = stock.finance.income_statement(period=freq, lang="en", dropna=True)
            balance = stock.finance.balance_sheet(period=freq, lang="en", dropna=True)
            cashfl = stock.finance.cash_flow(period=freq, lang="en", dropna=True)
            if income.empty and balance.empty:
                income = stock.finance.income_statement(period=freq, lang="vn", dropna=True)
                balance = stock.finance.balance_sheet(period=freq, lang="vn", dropna=True)
                cashfl = stock.finance.cash_flow(period=freq, lang="vn", dropna=True)
            return self._extract_financial_metrics(income, balance, cashfl, is_quarter)
        except Exception as e:
            logger.warning(f"Financial statements failed: {e}")
            return self._get_empty_financials(is_quarter)

    def _get_empty_financials(self, is_quarter: bool) -> dict:
        return {
            "revenue_ttm": np.nan,
            "net_income_ttm": np.nan,
            "ebit": np.nan,
            "ebitda": np.nan,
            "total_assets": np.nan,
            "total_debt": np.nan,
            "total_liabilities": np.nan,
            "cash": np.nan,
            "depreciation": np.nan,
            "fcfe": np.nan,
            "capex": np.nan,
            "is_quarterly_data": is_quarter
        }

    def _extract_financial_metrics(self, income, balance, cashfl, is_quarter):
        def _pick(df, candidates):
            if df.empty:
                return np.nan
            row = df.iloc[0]
            for c in candidates:
                if c in row and pd.notna(row[c]):
                    val = row[c]
                    if isinstance(val, str):
                        try:
                            val = float(val.replace(',', ''))
                        except (ValueError, AttributeError):
                            continue
                    return float(val)
            return np.nan

        def _sum_last_4_quarters(df, candidates):
            if df.empty or len(df) < 4:
                return np.nan
            total = 0
            for i in range(min(4, len(df))):
                row = df.iloc[i]
                for c in candidates:
                    if c in row and pd.notna(row[c]):
                        val = row[c]
                        if isinstance(val, str):
                            try:
                                val = float(val.replace(',', ''))
                            except (ValueError, AttributeError):
                                continue
                        total += float(val)
                        break
            return total if total != 0 else np.nan

        def _calculate_ebitda(income_df, cashfl_df):
            if income_df.empty:
                return np.nan
            # Only pick EBITDA directly, do not calculate from components
            return _pick(income_df, ["EBITDA", "ebitda", "EBITDA (Bn. VND)"])

        if is_quarter:
            # Lấy giá trị quý gần nhất cho revenue và net income
            net_income_latest = _pick(income, ["Net Profit For the Year", "Net income", "net_income", "netIncome", "profit", "Attributable to parent company"])
            revenue_latest = _pick(income, ["Revenue (Bn. VND)", "Revenue", "revenue", "netRevenue", "totalRevenue"])
            # Các chỉ số rolling 4 quý (TTM) nếu cần
            ebit_ttm = _sum_last_4_quarters(income, ["Lợi nhuận từ hoạt động kinh doanh", "Operating income", "EBIT", "Operating profit", "operationProfit"])
            depreciation_ttm = _sum_last_4_quarters(cashfl, ["Depreciation and Amortisation", "Depreciation", "depreciation"])
            fcfe_ttm = _sum_last_4_quarters(cashfl, ["Lưu chuyển tiền thuần từ hoạt động kinh doanh", "Operating cash flow", "Cash from operations"])
            capex_ttm = _sum_last_4_quarters(cashfl, ["Chi để mua sắm tài sản cố định", "Capital expenditure", "Capex", "capex"])
            ebitda_ttm = np.nan
            if not income.empty and len(income) >= 4:
                total_gross_profit = _sum_last_4_quarters(income, ["Lợi nhuận gộp", "Gross profit", "gross_profit", "grossProfit"])
                total_selling_exp = _sum_last_4_quarters(income, ["Chi phí bán hàng", "Selling expenses", "selling_expenses", "sellingExpenses"])
                total_admin_exp = _sum_last_4_quarters(income, ["Chi phí quản lý doanh nghiệp", "General & admin expenses", "admin_expenses", "adminExpenses"])
                total_depreciation = _sum_last_4_quarters(cashfl, ["Khấu hao tài sản cố định", "Depreciation", "depreciation"])
                components = [total_gross_profit, total_selling_exp, total_admin_exp, total_depreciation]
                if any(pd.notna(comp) for comp in components):
                    ebitda_ttm = sum(comp for comp in components if pd.notna(comp))
                else:
                    ebitda_ttm = _sum_last_4_quarters(income, ["EBITDA", "ebitda"])
            total_assets = _pick(balance, ["TỔNG CỘNG TÀI SẢN", "Total assets", "totalAsset", "totalAssets"])
            total_liabilities = _pick(balance, ["TỔNG CỘNG NỢ PHẢI TRẢ", "Total liabilities", "totalLiabilities", "totalDebt"])
            cash = _pick(balance, ["Tiền và tương đương tiền", "Cash", "cash", "cashAndEquivalents"])
            return {
                "revenue_ttm": revenue_latest if pd.notna(revenue_latest) else np.nan,
                "net_income_ttm": net_income_latest if pd.notna(net_income_latest) else np.nan,
                "ebit": ebit_ttm if pd.notna(ebit_ttm) else np.nan,
                "ebitda": ebitda_ttm if pd.notna(ebitda_ttm) else np.nan,
                "total_assets": total_assets,
                "total_debt": total_liabilities,
                "total_liabilities": total_liabilities,
                "cash": cash,
                "depreciation": depreciation_ttm if pd.notna(depreciation_ttm) else np.nan,
                "fcfe": fcfe_ttm if pd.notna(fcfe_ttm) else np.nan,
                "capex": capex_ttm if pd.notna(capex_ttm) else np.nan,
                "is_quarterly_data": is_quarter
            }
        else:
            net_income = _pick(income, ["Lợi nhuận sau thuế", "Net income", "net_income", "netIncome", "profit", "Net Profit For the Year", "Attributable to parent company"])
            revenue = _pick(income, ["Doanh thu thuần", "Revenue", "revenue", "netRevenue", "totalRevenue", "Revenue (Bn. VND)"])
            total_assets = _pick(balance, ["TỔNG CỘNG TÀI SẢN", "Total assets", "totalAsset", "totalAssets"])
            total_liabilities = _pick(balance, ["TỔNG CỘNG NỢ PHẢI TRẢ", "Total liabilities", "totalLiabilities", "totalDebt"])
            cash = _pick(balance, ["Tiền và tương đương tiền", "Cash", "cash", "cashAndEquivalents"])
            ebit = _pick(income, ["Lợi nhuận từ hoạt động kinh doanh", "Operating income", "EBIT", "Operating profit", "operationProfit"])
            depreciation = _pick(cashfl, ["Khấu hao tài sản cố định", "Depreciation", "depreciation"])
            fcfe = _pick(cashfl, ["Lưu chuyển tiền thuần từ hoạt động kinh doanh", "Operating cash flow", "Cash from operations"])
            capex = _pick(cashfl, ["Chi để mua sắm tài sản cố định", "Capital expenditure", "Capex", "capex"])
            ebitda = _calculate_ebitda(income, cashfl)
            return {
                "revenue_ttm": revenue if pd.notna(revenue) else np.nan,
                "net_income_ttm": net_income if pd.notna(net_income) else np.nan,
                "ebit": ebit if pd.notna(ebit) else np.nan,
                "ebitda": ebitda if pd.notna(ebitda) else np.nan,
                "total_assets": total_assets,
                "total_debt": total_liabilities,
                "total_liabilities": total_liabilities,
                "cash": cash,
                "depreciation": depreciation if pd.notna(depreciation) else np.nan,
                "fcfe": fcfe if pd.notna(fcfe) else np.nan,
                "capex": capex if pd.notna(capex) else np.nan,
                "is_quarterly_data": is_quarter
            }

    def _get_price_data(self, stock, shares_outstanding, symbol) -> dict:
        current_price = self._get_market_price_vci(stock, symbol)
        eps = book_value = np.nan
        try:
            ratios = stock.company.ratio_summary()
            if not ratios.empty:
                r = ratios.iloc[0]
                eps_fields = ["EPS (VND)", "earningsPerShare", "earnings_per_share"]
                for field in eps_fields:
                    if field in r and pd.notna(r[field]):
                        eps = float(r[field])
                        break
                bv_fields = ["BVPS (VND)", "bookValue", "book_value_per_share"]
                for field in bv_fields:
                    if field in r and pd.notna(r[field]):
                        book_value = float(r[field])
                        break
        except Exception as e:
            pass
        market_cap = (
            current_price * shares_outstanding
            if pd.notna(current_price) and pd.notna(shares_outstanding)
            else np.nan
        )
        return {
            "current_price": current_price,
            "market_cap": market_cap,
        }

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

    def _extract_historical_series(self, results: dict, period: str) -> dict:
        """Extract series of data for charts from multiple DataFrames"""
        series = {
            "years": [],
            "roe_data": [],
            "roa_data": [],
            "revenue_data": [],
            "profit_data": [],
            "pe_ratio_data": [],
            "pb_ratio_data": [],
            "ps_ratio_data": [],
            "current_ratio_data": [],
            "quick_ratio_data": [],
            "debt_to_equity_data": [],
            "nim_data": [],
            "npl_data": [],
            "casa_data": []
        }
        
        # 1. Period Labels and Ratios
        rp_df = results.get("ratio_period")
        if rp_df is not None and not rp_df.empty:
            # Handle sorting for both Tuple columns (Live) and String columns (DB)
            # Find the sort keys first
            year_col = None
            quarter_col = None
            
            # Helper to find column
            possible_year_keys = [('Meta', 'yearReport'), "('Meta', 'yearReport')"]
            possible_quarter_keys = [('Meta', 'lengthReport'), "('Meta', 'lengthReport')"]
            
            for col in rp_df.columns:
                if col in possible_year_keys or str(col) in possible_year_keys:
                    year_col = col
                if col in possible_quarter_keys or str(col) in possible_quarter_keys:
                    quarter_col = col
                    
            if year_col and quarter_col:
                try:
                    rp_df = rp_df.sort_values([year_col, quarter_col], ascending=[True, True])
                except Exception as e:
                    logger.warning(f"Sort failed: {e}")
            
            # Use last 12 periods maximum
            latest_rp = rp_df.tail(12)
            
            for _, row in latest_rp.iterrows():
                # Period Label (Using helper)
                year = self._safe_get_multi_index(row, ('Meta', 'yearReport'))
                quarter = self._safe_get_multi_index(row, ('Meta', 'lengthReport'))
                
                if year is None or pd.isna(year) or year == '': continue # Skip if no year found
                
                try:
                    label = f"{int(float(year))} Q{int(float(quarter))}" if pd.notna(quarter) and float(quarter) > 0 else str(int(float(year)))
                    series["years"].append(label)
                except (TypeError, ValueError):
                    series["years"].append(str(year))
                
                # Ratios (Normalized to %)
                def get_pct(key):
                    val = self._safe_get_multi_index(row, key)
                    if pd.isna(val) or val is None: return 0
                    try:
                        f_val = float(val)
                        return round(f_val * 100, 2) if abs(f_val) < 1 else round(f_val, 2)
                    except (TypeError, ValueError):
                        return 0

                def get_val(key):
                    val = self._safe_get_multi_index(row, key)
                    if pd.isna(val) or val is None: return 0
                    try:
                        return round(float(val), 2)
                    except (TypeError, ValueError):
                        return 0
                
                series["roe_data"].append(get_pct(('Chỉ tiêu khả năng sinh lợi', 'ROE (%)')))
                series["roa_data"].append(get_pct(('Chỉ tiêu khả năng sinh lợi', 'ROA (%)')))
                
                series["pe_ratio_data"].append(get_val(('Chỉ tiêu định giá', 'P/E')))
                series["pb_ratio_data"].append(get_val(('Chỉ tiêu định giá', 'P/B')))
                series["ps_ratio_data"].append(get_val(('Chỉ tiêu định giá', 'P/S')))
                
                series["current_ratio_data"].append(get_val(('Chỉ tiêu khả năng thanh toán', 'Chỉ số thanh toán hiện hành')))
                series["quick_ratio_data"].append(get_val(('Chỉ tiêu khả năng thanh toán', 'Chỉ số thanh toán nhanh')))
                series["debt_to_equity_data"].append(get_val(('Chỉ tiêu cấu trúc tài chính', 'Nợ/Vốn chủ sở hữu')))
                
                # Bank specific series
                series["nim_data"].append(get_pct(('Chỉ tiêu khả năng sinh lợi', 'NIM (%)')))
                series["casa_data"].append(get_pct(('Chỉ tiêu khả năng sinh lợi', 'CASA (%)')))
                series["npl_data"].append(get_pct(('Chỉ tiêu chất lượng tài sản', 'NPL (%)')))

        # 2. Revenue and Profit from Income Statement
        income_df = results.get("income")
        if income_df is not None and not income_df.empty:
            # Sort income by period if metadata present
            if 'yearReport' in income_df.columns:
                income_df = income_df.sort_values(['yearReport', 'lengthReport'], ascending=[True, True])
            
            latest_income = income_df.tail(12)
            rev_vals = []
            prof_vals = []
            
            for _, row in latest_income.iterrows():
                # Try to find revenue field
                rev = np.nan
                for f in ["Revenue", "revenue", "netRevenue", "totalRevenue", "Revenue (Bn. VND)"]:
                    if f in row and pd.notna(row[f]):
                        rev = float(row[f])
                        break
                rev_vals.append(rev if pd.notna(rev) else 0)
                
                # Try to find profit field
                prof = np.nan
                for f in ["Net Profit For the Year", "Net income", "net_income", "netIncome", "profit"]:
                    if f in row and pd.notna(row[f]):
                        prof = float(row[f])
                        break
                prof_vals.append(prof if pd.notna(prof) else 0)
            
            series["revenue_data"] = rev_vals
            series["profit_data"] = prof_vals

        return series

    def _get_price_from_vci_api(self, symbol: str) -> tuple:
        """Get realtime price directly from VCI API (no vnstock quota used)
        Returns: (price, source) tuple
        """
        price = VCIClient.get_price(symbol)
        if price:
            return float(price), "VCI_API"
        return np.nan, None

    def _get_market_price_vci(self, stock, symbol: str) -> dict:
        """Get full market price data, prioritizing VCI API over vnstock
        Returns: dict with price, open, high, low, volume, ceiling, floor, ref, source
        or None if failed
        """
        # Define field mapping for extraction from dataframe
        # Keys are our standard names, Values are list of possible column names (priority first)
        field_mapping = {
            "price": [('match', 'match_price'), ('match', 'close_price'), ('match', 'last_price')],
            "open": [('match', 'open_price')],
            "high": [('match', 'highest')],
            "low": [('match', 'lowest')],
            "volume": [('match', 'accumulated_volume'), ('match', 'total_volume')],
            "ceiling": [('listing', 'ceiling')],
            "floor": [('listing', 'floor')],
            "ref": [('listing', 'ref_price')],
        }

        # Helper to extract data from df
        def extract_from_df(df, source_name):
            result = {"source": source_name}
            has_data = False
            
            for key, possible_cols in field_mapping.items():
                val = 0
                for col in possible_cols:
                    if col in df.columns:
                        try:
                            v = df[col].iloc[0]
                            if pd.notna(v) and v > 0:
                                val = float(v)
                                break
                        except (TypeError, ValueError, AttributeError):
                            pass
                result[key] = val
                if key == "price" and val > 0:
                    has_data = True
            
            return result if has_data else None

        # PRIORITY 1: Direct VCI API via VCIClient
        try:
            from backend.data_sources.vci import VCIClient
            price_detail = VCIClient.get_price_detail(symbol)
            if price_detail and price_detail.get('price', 0) > 0:
                res = {
                    "price": price_detail['price'],
                    "source": "VCI_RAM",
                    "open": price_detail.get('open', 0),
                    "high": price_detail.get('high', 0),
                    "low": price_detail.get('low', 0),
                    "volume": price_detail.get('volume', 0),
                    "ceiling": price_detail.get('ceiling', 0),
                    "floor": price_detail.get('floor', 0),
                    "ref": price_detail.get('ref', 0),
                }
                logger.debug(f"✓ Got full market data from VCI_RAM for {symbol}")
                return res
        except Exception:
            pass

        # PRIORITY 2: Direct basic price fetch (Fallback)
        direct_price, source = self._get_price_from_vci_api(symbol)
        if pd.notna(direct_price) and direct_price > 0:
            return {
                "price": direct_price,
                "source": "VCI_SIMPLE",
                "open": 0, "high": 0, "low": 0, "volume": 0,
                "ceiling": 0, "floor": 0, "ref": 0
            }

        logger.warning(f"Could not retrieve market price for {symbol}")
        return None

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

    def calculate_missing_ratios(self, stock_data):
        try:
            # Get required fields - try both TTM and regular versions
            revenue = stock_data.get('revenue_ttm') or stock_data.get('revenue', 0)
            net_income = stock_data.get('net_income_ttm') or stock_data.get('net_income', 0)
            ebit = stock_data.get('ebit', 0)
            ebitda = stock_data.get('ebitda', 0)
            gross_profit = stock_data.get('gross_profit', 0)
            total_assets = stock_data.get('total_assets', 0)
            total_equity = stock_data.get('total_equity', 0)
            total_debt = stock_data.get('total_debt', 0)
            inventory = stock_data.get('inventory', 0)
            fixed_assets = stock_data.get('fixed_assets') or stock_data.get('ppe', 0)
            cash = stock_data.get('cash') or stock_data.get('cash_and_equivalents', 0)
            current_assets = stock_data.get('current_assets', 0)
            current_liabilities = stock_data.get('current_liabilities', 0)
            accounts_receivable = stock_data.get('accounts_receivable', 0)
            interest_expense = stock_data.get('interest_expense', 0)
            shares_outstanding = stock_data.get('shares_outstanding', 0)
            current_price = stock_data.get('current_price', 0)
            
            # Calculate missing margins if not available
            if not stock_data.get('gross_margin') and revenue > 0 and gross_profit:
                stock_data['gross_margin'] = (gross_profit / revenue) * 100
                
            if not stock_data.get('ebit_margin') and revenue > 0 and ebit:
                stock_data['ebit_margin'] = (ebit / revenue) * 100
                
            if not stock_data.get('net_profit_margin') and revenue > 0 and net_income:
                stock_data['net_profit_margin'] = (net_income / revenue) * 100
                stock_data['net_margin'] = stock_data['net_profit_margin']  # Alias
            
            # Calculate missing profitability ratios
            if not stock_data.get('roa') and total_assets > 0 and net_income:
                stock_data['roa'] = (net_income / total_assets) * 100
                
            if not stock_data.get('roe') and total_equity > 0 and net_income:
                stock_data['roe'] = (net_income / total_equity) * 100
            
            # Calculate missing turnover ratios
            if not stock_data.get('asset_turnover') and total_assets > 0 and revenue > 0:
                stock_data['asset_turnover'] = revenue / total_assets
                
            if not stock_data.get('inventory_turnover') and inventory > 0 and revenue > 0:
                stock_data['inventory_turnover'] = revenue / inventory
                
            if not stock_data.get('fixed_asset_turnover') and fixed_assets > 0 and revenue > 0:
                stock_data['fixed_asset_turnover'] = revenue / fixed_assets
                
            if not stock_data.get('receivables_turnover') and accounts_receivable > 0 and revenue > 0:
                stock_data['receivables_turnover'] = revenue / accounts_receivable
            
            # Calculate missing liquidity ratios
            if not stock_data.get('current_ratio') and current_liabilities > 0 and current_assets > 0:
                stock_data['current_ratio'] = current_assets / current_liabilities
                
            if not stock_data.get('quick_ratio') and current_liabilities > 0:
                quick_assets = current_assets - inventory
                if quick_assets > 0:
                    stock_data['quick_ratio'] = quick_assets / current_liabilities
                    
            if not stock_data.get('cash_ratio') and current_liabilities > 0 and cash > 0:
                stock_data['cash_ratio'] = cash / current_liabilities
            
            # Calculate missing leverage ratios
            if not stock_data.get('debt_to_equity') and total_equity > 0 and total_debt:
                stock_data['debt_to_equity'] = total_debt / total_equity
                
            if not stock_data.get('equity_multiplier') and total_equity > 0 and total_assets > 0:
                stock_data['equity_multiplier'] = total_assets / total_equity
                stock_data['financial_leverage'] = stock_data['equity_multiplier']  # Alias
            
            # EPS calculation - only as fallback if eps_ttm doesn't exist
                if not stock_data.get('eps_ttm') and net_income:
                    stock_data['eps_ttm'] = net_income / shares_outstanding
                
                # Book value per share - only if missing
                if not stock_data.get('bvps') and total_equity > 0:
                    stock_data['bvps'] = total_equity / shares_outstanding
                
                # Market cap
                if not stock_data.get('market_cap') and current_price > 0:
                    stock_data['market_cap'] = current_price * shares_outstanding
                
                # P/S ratio
                if not stock_data.get('ps_ratio') and current_price > 0 and revenue > 0:
                    sales_per_share = revenue / shares_outstanding
                    if sales_per_share > 0:
                        stock_data['ps_ratio'] = current_price / sales_per_share
            
            # Calculate interest coverage ratio
            if not stock_data.get('interest_coverage') and interest_expense != 0 and ebit > 0:
                # Interest expense is usually negative, take absolute value
                stock_data['interest_coverage'] = ebit / abs(interest_expense)
            
            # Calculate EBITDA if missing
            if not stock_data.get('ebitda'):
                depreciation = stock_data.get('depreciation', 0)
                if ebit > 0 and depreciation > 0:
                    stock_data['ebitda'] = ebit + depreciation
                elif net_income > 0:  # Alternative calculation from bottom up
                    tax_expense = stock_data.get('tax_expense', 0)
                    if interest_expense and depreciation:
                        # EBITDA = NI + Tax + Interest + D&A
                        stock_data['ebitda'] = net_income + tax_expense + abs(interest_expense) + depreciation
            
            # Calculate P/CF ratio if missing
            if not stock_data.get('pcf_ratio') and shares_outstanding > 0 and current_price > 0:
                operating_cash_flow = stock_data.get('operating_cash_flow')
                if operating_cash_flow and operating_cash_flow > 0:
                    cash_flow_per_share = operating_cash_flow / shares_outstanding
                    stock_data['pcf_ratio'] = current_price / cash_flow_per_share
            
            # Calculate enterprise value and EV ratios
            market_cap = stock_data.get('market_cap', 0)
            if not stock_data.get('enterprise_value') and market_cap > 0:
                ev = market_cap + total_debt - cash
                stock_data['enterprise_value'] = ev
                
                # EV/EBITDA
                if not stock_data.get('ev_ebitda') and ebitda > 0:
                    stock_data['ev_ebitda'] = ev / ebitda
            
            # Calculate working capital
            if not stock_data.get('working_capital') and current_assets and current_liabilities:
                stock_data['working_capital'] = current_assets - current_liabilities
                
            # Calculate working capital turnover
            if not stock_data.get('working_capital_turnover') and revenue > 0:
                wc = stock_data.get('working_capital')
                if wc and wc > 0:
                    stock_data['working_capital_turnover'] = revenue / wc
                
            return stock_data
            
        except Exception as e:
            logger.error(f"Error calculating missing ratios: {e}")
            return stock_data

    def get_financial_df(self, symbol: str, report_type: str, period: str) -> pd.DataFrame:
        """Get financial data as DataFrame from SQLite (simulating vnstock format)"""
        try:
            records = self.db.get_financial_statement(symbol, report_type, period)
            if not records:
                 return pd.DataFrame()
            
            # Convert list of dicts to DataFrame
            flattened_data = []
            for r in records:
                 item = r['data'].copy() if r['data'] else {}
                 item['year'] = r['year']
                 item['quarter'] = r['quarter']
                 flattened_data.append(item)
                 
            df = pd.DataFrame(flattened_data)
            return df
        except Exception as e:
            logger.error(f"Error converting DB financials to DF for {symbol}: {e}")
            return pd.DataFrame()

