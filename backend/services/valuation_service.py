import sqlite3
import statistics
import threading
import time
import logging
from typing import Dict, Any, Optional
from backend.db_path import resolve_vci_screening_db_path, resolve_vci_stats_financial_db_path, resolve_vci_company_db_path, resolve_valuation_cache_db_path
from backend.data_sources.financial_repository import FinancialRepository
from backend.services.vci_financial_adapter import (
    has_vci_financial_db,
    load_eps_history_yearly as vci_load_eps_history,
    load_latest_net_income as vci_load_latest_net_income,
    load_latest_financial_components as vci_load_financial_components,
    load_ttm_eps as vci_load_ttm_eps,
    load_ttm_financial_components as vci_load_ttm_financial_components,
    load_eps_cagr as vci_load_eps_cagr,
)
from backend.services.beta_calculator import suggest_wacc as _suggest_wacc

logger = logging.getLogger(__name__)

class ValuationService:
    def __init__(self, repo: FinancialRepository):
        self.repo = repo

    def calculate(self, symbol: str, request_data: dict) -> Dict[str, Any]:
        return calculate_valuation(symbol, request_data)

    def calculate_sensitivity(self, symbol: str, request_data: dict) -> Dict[str, Any]:
        return calculate_sensitivity(symbol, request_data)



def _to_float(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    values = sorted(float(v) for v in values)
    n = len(values)
    mid = n // 2
    if n % 2 == 1:
        return values[mid]
    return (values[mid - 1] + values[mid]) / 2.0


def _summarize(values: list[float], computed_median: float | None) -> dict:
    if not values:
        return {
            'count': 0,
            'min': None,
            'max': None,
            'median_computed': computed_median,
            'std_dev': None,
        }
    std = float(statistics.stdev(values)) if len(values) >= 2 else None
    return {
        'count': len(values),
        'min': float(min(values)),
        'max': float(max(values)),
        'median_computed': computed_median,
        'std_dev': std,
    }


class _IndustryCacheEntry:
    __slots__ = ('created_at', 'rows')

    def __init__(self, created_at: float, rows: list[tuple[str, float, float]]):
        self.created_at = created_at
        self.rows = rows


def _load_stats_financial_row(symbol: str) -> dict | None:
    """Load TTM ratios for a single symbol from vci_stats_financial.sqlite.

    Returns dict with keys: pe, pb, ps, roe, shares, market_cap — or None if not found.
    """
    sf_path = resolve_vci_stats_financial_db_path()
    conn = sqlite3.connect(sf_path)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            "SELECT pe, pb, ps, roe, shares, market_cap FROM stats_financial WHERE UPPER(ticker) = ?",
            (symbol.upper(),),
        ).fetchone()
        return dict(row) if row else None
    except Exception:
        return None
    finally:
        conn.close()


def _load_symbol_overview_from_vci(symbol: str) -> dict | None:
    """Build an overview-compatible row from VCI company + screening DBs.

    Used as fallback when stocks_optimized.db overview table is empty or missing.
    Returns a dict with keys: symbol, industry, current_price, eps_ttm, bvps, pe, pb.
    """
    symbol = symbol.upper()

    industry = 'Unknown'
    current_price = None
    pe = 0.0
    pb = 0.0
    is_bank = False

    # Industry + isbank from vci_company
    try:
        conn = sqlite3.connect(resolve_vci_company_db_path())
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT icb_name4, icb_name3, icb_name2, isbank FROM companies WHERE UPPER(ticker) = ?",
            (symbol,),
        ).fetchone()
        if row:
            industry = row['icb_name4'] or row['icb_name3'] or row['icb_name2'] or 'Unknown'
            is_bank = bool(row['isbank'])
        conn.close()
    except Exception as exc:
        logger.debug(f"VCI company lookup failed for {symbol}: {exc}")

    if industry == 'Unknown':
        # Try sector name from screening as secondary fallback
        try:
            conn = sqlite3.connect(resolve_vci_screening_db_path())
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT viSector, enSector FROM screening_data WHERE UPPER(ticker) = ?",
                (symbol,),
            ).fetchone()
            if row:
                industry = row['viSector'] or row['enSector'] or 'Unknown'
            conn.close()
        except Exception:
            pass

    # Current price + PE/PB from stats_financial (TTM)
    sf = _load_stats_financial_row(symbol)
    if sf:
        pe = _to_float(sf.get('pe'))
        pb = _to_float(sf.get('pb'))

    # Market price from screening (live, updated every few minutes)
    try:
        conn = sqlite3.connect(resolve_vci_screening_db_path())
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT marketPrice FROM screening_data WHERE UPPER(ticker) = ?",
            (symbol,),
        ).fetchone()
        if row and row['marketPrice']:
            current_price = float(row['marketPrice'])
        conn.close()
    except Exception:
        pass

    if industry == 'Unknown' and pe == 0.0 and current_price is None:
        # Symbol truly not found in any VCI source
        return None

    return {
        'symbol': symbol,
        'industry': industry,
        'current_price': current_price,
        'eps_ttm': 0.0,
        'bvps': 0.0,
        'pe': pe,
        'pb': pb,
        'is_bank': is_bank,
    }


class ScreeningIndustryComparablesCache:
    """Cache of (symbol, pe, pb) tuples for an ICB industry group.

    Peers are identified via vci_screening.icbCodeLv2 and their PE/PB come
    from vci_stats_financial.stats_financial (updated daily, ~1500 stocks).
    The old approach read ttmPe/ttmPb from vci_screening directly, but those
    columns were never populated because the sync step failed due to a SQLite
    lock race between cron jobs.
    """

    def __init__(self, ttl_seconds: int = 3600):
        self._ttl_seconds = ttl_seconds
        self._lock = threading.Lock()
        self._cache: dict[str, _IndustryCacheEntry] = {}

    def get_rows(self, screening_db_path: str, icb_code_lv2: str) -> list[tuple[str, float, float]]:
        icb_code_lv2 = str(icb_code_lv2)
        now = time.time()
        entry = self._cache.get(icb_code_lv2)
        if entry and (now - entry.created_at) < self._ttl_seconds:
            return entry.rows

        with self._lock:
            entry = self._cache.get(icb_code_lv2)
            if entry and (now - entry.created_at) < self._ttl_seconds:
                return entry.rows

            sf_path = resolve_vci_stats_financial_db_path()
            rows: list[tuple[str, float, float]] = []
            conn = sqlite3.connect(screening_db_path)
            conn.row_factory = sqlite3.Row
            try:
                conn.execute(f"ATTACH DATABASE '{sf_path}' AS sf")
                cur = conn.execute(
                    """
                    SELECT s.ticker, sf.pe, sf.pb
                    FROM screening_data s
                    JOIN sf.stats_financial sf ON UPPER(sf.ticker) = UPPER(s.ticker)
                    WHERE s.icbCodeLv2 = ?
                      AND (sf.pe IS NOT NULL OR sf.pb IS NOT NULL)
                    """,
                    (icb_code_lv2,),
                )
                for r in cur.fetchall() or []:
                    rows.append((
                        str(r['ticker']).upper(),
                        _to_float(r['pe']),
                        _to_float(r['pb']),
                    ))
            except Exception:
                rows = []
            finally:
                try:
                    conn.execute("DETACH DATABASE sf")
                except Exception:
                    pass
                conn.close()

            self._cache[icb_code_lv2] = _IndustryCacheEntry(now, rows)
            return rows


_screening_industry_cache = ScreeningIndustryComparablesCache(ttl_seconds=3600)


class ScreeningPsCache:
    """Cache of (symbol, ps) tuples for an ICB industry group from vci_stats_financial."""

    def __init__(self, ttl_seconds: int = 3600):
        self._ttl_seconds = ttl_seconds
        self._lock = threading.Lock()
        self._cache: dict[str, _IndustryCacheEntry] = {}

    def get_ps_rows(self, screening_db_path: str, icb_code_lv2: str) -> list[tuple[str, float]]:
        icb_code_lv2 = str(icb_code_lv2)
        now = time.time()
        entry = self._cache.get(icb_code_lv2)
        if entry and (now - entry.created_at) < self._ttl_seconds:
            return entry.rows  # type: ignore[return-value]

        with self._lock:
            entry = self._cache.get(icb_code_lv2)
            if entry and (now - entry.created_at) < self._ttl_seconds:
                return entry.rows  # type: ignore[return-value]

            sf_path = resolve_vci_stats_financial_db_path()
            rows: list[tuple[str, float]] = []
            conn = sqlite3.connect(screening_db_path)
            conn.row_factory = sqlite3.Row
            try:
                conn.execute(f"ATTACH DATABASE '{sf_path}' AS sf")
                cur = conn.execute(
                    """
                    SELECT s.ticker, sf.ps
                    FROM screening_data s
                    JOIN sf.stats_financial sf ON UPPER(sf.ticker) = UPPER(s.ticker)
                    WHERE s.icbCodeLv2 = ?
                      AND sf.ps IS NOT NULL AND sf.ps > 0 AND sf.ps <= 200
                    """,
                    (icb_code_lv2,),
                )
                for r in cur.fetchall() or []:
                    rows.append((str(r['ticker']).upper(), _to_float(r['ps'])))
            except Exception:
                rows = []
            finally:
                try:
                    conn.execute("DETACH DATABASE sf")
                except Exception:
                    pass
                conn.close()

            self._cache[icb_code_lv2] = _IndustryCacheEntry(now, rows)  # type: ignore[arg-type]
            return rows


_screening_ps_cache = ScreeningPsCache(ttl_seconds=3600)


def _load_eps_history_yearly(symbol: str, limit: int = 10) -> list[dict]:
    """EPS history from VCI annual income statements."""
    symbol = symbol.upper()
    if has_vci_financial_db():
        try:
            result = vci_load_eps_history(symbol, limit=limit)
            if result:
                return result
        except Exception as exc:
            logger.debug(f"VCI EPS history failed for {symbol}: {exc}")
    return []


def _load_latest_net_income(symbol: str) -> tuple[float, str]:
    """Return (net_income, source) from VCI financial statements."""
    symbol = symbol.upper()
    if has_vci_financial_db():
        try:
            val, source = vci_load_latest_net_income(symbol)
            if val > 0:
                return val, source
        except Exception as exc:
            logger.debug(f"VCI net_income failed for {symbol}: {exc}")
    return 0.0, 'missing'


def _load_latest_financial_components(symbol: str) -> dict:
    """Return income + cash flow components for FCFE calculation from VCI financial statements."""
    symbol = symbol.upper()

    if has_vci_financial_db():
        try:
            vci_data = vci_load_financial_components(symbol)
            if vci_data.get('isa20', 0) > 0 or vci_data.get('cfa2', 0) > 0:
                # Map raw VCI codes to the expected output format
                dr = vci_data.get('cfa9', 0.0)
                di = vci_data.get('cfa10', 0.0)
                dp = vci_data.get('cfa11', 0.0)
                pfa = vci_data.get('cfa18', 0.0)
                pdfa = vci_data.get('cfa19', 0.0)
                pb = vci_data.get('cfa27', 0.0)
                rb = vci_data.get('cfa28', 0.0)
                dep = vci_data.get('cfa2', 0.0)

                net_income = vci_data.get('isa22', 0.0) or vci_data.get('isa20', 0.0)
                capex_out = abs(pfa)

                return {
                    'net_income': float(net_income),
                    'period_year': vci_data.get('period_year'),
                    'period_quarter': vci_data.get('period_quarter'),
                    'financial_expense': float(vci_data.get('isa7', 0.0)),
                    'depreciation_fixed_assets': float(dep),
                    'depreciation': float(dep),
                    'increase_decrease_receivables': float(dr),
                    'increase_decrease_inventory': float(di),
                    'increase_decrease_payables': float(dp),
                    'purchase_purchase_fixed_assets': float(pfa),
                    'proceeds_from_disposal_fixed_assets': float(pdfa),
                    'proceeds_disposal_fixed_assets': float(pdfa),
                    'proceeds_from_borrowings': float(pb),
                    'proceeds_borrowings': float(pb),
                    'repayments_of_borrowings': float(rb),
                    'repayments_borrowings': float(rb),
                    'delta_receivables': float(dr),
                    'delta_inventory': float(di),
                    'delta_payables': float(dp),
                    'delta_working_capital': float(dr + di - dp),
                    'purchase_fixed_assets_raw': float(pfa),
                    'capex_purchase_outflow': float(capex_out),
                    'capex_net': max(0.0, capex_out - max(0.0, abs(pdfa))),
                    'net_borrowing': float(pb + rb),
                    'source': 'vci_fs.income_statement + cash_flow (latest period)',
                }
        except Exception as exc:
            logger.debug(f"VCI financial components failed for {symbol}: {exc}")

    return {
        'net_income': 0.0, 'period_year': None, 'period_quarter': None,
        'financial_expense': 0.0, 'depreciation': 0.0, 'depreciation_fixed_assets': 0.0,
        'delta_receivables': 0.0, 'delta_inventory': 0.0, 'delta_payables': 0.0,
        'delta_working_capital': 0.0, 'purchase_fixed_assets_raw': 0.0,
        'proceeds_disposal_fixed_assets': 0.0, 'capex_purchase_outflow': 0.0,
        'capex_net': 0.0, 'proceeds_borrowings': 0.0, 'repayments_borrowings': 0.0,
        'net_borrowing': 0.0, 'source': 'missing',
    }


def _load_screening_peer_details(screening_db_path: str, icb_code_lv2: str, symbol: str) -> list[dict]:
    """Load peer details for stocks in the same ICB industry group.

    PE/PB/ROE come from vci_stats_financial.sqlite (updated daily).
    Market cap and sector labels come from vci_screening.sqlite.
    """
    symbol = symbol.upper()
    icb_code_lv2 = str(icb_code_lv2)

    sf_path = resolve_vci_stats_financial_db_path()
    conn = sqlite3.connect(screening_db_path)
    conn.row_factory = sqlite3.Row
    peers: list[dict] = []
    try:
        conn.execute(f"ATTACH DATABASE '{sf_path}' AS sf")
        rows = conn.execute(
            """
            SELECT s.ticker, s.marketCap, s.viSector, s.enSector,
                   sf.pe, sf.pb, sf.ps, sf.roe, sf.roa
            FROM screening_data s
            LEFT JOIN sf.stats_financial sf ON UPPER(sf.ticker) = UPPER(s.ticker)
            WHERE s.icbCodeLv2 = ?
              AND UPPER(s.ticker) != ?
            ORDER BY
              CASE WHEN s.marketCap IS NULL THEN 1 ELSE 0 END,
              s.marketCap DESC,
              s.ticker ASC
            """,
            (icb_code_lv2, symbol),
        ).fetchall() or []
        for r in rows:
            sym = str(r['ticker']).upper()
            roe_raw = _to_float(r['roe'])
            roa_raw = _to_float(r['roa'])
            peers.append({
                'symbol': sym,
                'pe': _to_float(r['pe']),
                'pb': _to_float(r['pb']),
                'ps': _to_float(r['ps']),
                'roe': roe_raw * 100.0 if 0 < abs(roe_raw) <= 1 else roe_raw,
                'roa': roa_raw * 100.0 if 0 < abs(roa_raw) <= 1 else roa_raw,
                'market_cap': _to_float(r['marketCap']),
                'sector': (r['viSector'] or r['enSector'] or ''),
            })
    except Exception:
        peers = []
    finally:
        try:
            conn.execute("DETACH DATABASE sf")
        except Exception:
            pass
        conn.close()
    return peers



def _load_valuation_datamart_row(db_path: str, symbol: str) -> dict | None:
    symbol = str(symbol or '').upper().strip()
    if not symbol:
        return None

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    try:
        exists = cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='valuation_datamart'"
        ).fetchone()
        if not exists:
            return None

        row = cur.execute(
            """
            SELECT *
            FROM valuation_datamart
            WHERE UPPER(symbol) = ?
            LIMIT 1
            """,
            (symbol,),
        ).fetchone()
        return dict(row) if row else None
    except Exception:
        return None
    finally:
        conn.close()


def _merge_peer_details(screening_peers: list[dict], overview_peers: list[dict]) -> list[dict]:
    merged: dict[str, dict] = {}

    for p in overview_peers:
        sym = str(p.get('symbol') or '').upper()
        if not sym:
            continue
        merged[sym] = {
            'symbol': sym,
            'pe': _to_float(p.get('pe')),
            'pb': _to_float(p.get('pb')),
            'ps': 0.0,
            'roe': _to_float(p.get('roe')),
            'roa': _to_float(p.get('roa')),
            'market_cap': _to_float(p.get('market_cap')),
            'sector': p.get('sector') or '',
        }

    for p in screening_peers:
        sym = str(p.get('symbol') or '').upper()
        if not sym:
            continue
        base = merged.get(sym, {
            'symbol': sym,
            'pe': 0.0,
            'pb': 0.0,
            'ps': 0.0,
            'roe': 0.0,
            'roa': 0.0,
            'market_cap': 0.0,
            'sector': p.get('sector') or '',
        })

        pe = _to_float(p.get('pe'))
        pb = _to_float(p.get('pb'))
        roe = _to_float(p.get('roe'))
        mcap = _to_float(p.get('market_cap'))

        if pe > 0:
            base['pe'] = pe
        if pb > 0:
            base['pb'] = pb
        if roe != 0:
            base['roe'] = roe
        if mcap > 0:
            base['market_cap'] = mcap
        if p.get('sector'):
            base['sector'] = p.get('sector')

        merged[sym] = base

    return sorted(
        merged.values(),
        key=lambda x: (
            0 if _to_float(x.get('market_cap')) > 0 else 1,
            -_to_float(x.get('market_cap')),
            str(x.get('symbol') or ''),
        ),
    )


def _dcf_per_share(
    base_cashflow_per_share: float,
    annual_growth: float,
    discount_rate: float,
    terminal_growth_rate: float,
    years: int,
) -> tuple[float, dict]:
    details = {
        'base_cashflow_per_share': float(base_cashflow_per_share),
        'annual_growth': float(annual_growth),
        'discount_rate': float(discount_rate),
        'terminal_growth': float(terminal_growth_rate),
        'years': int(years),
        'pv_sum': 0.0,
        'terminal_value': 0.0,
        'terminal_value_discounted': 0.0,
        'result': 0.0,
        'notes': [],
    }

    if base_cashflow_per_share == 0:
        details['notes'].append('base_cashflow_per_share==0 (cannot run DCF)')
        return 0.0, details
    if discount_rate <= 0:
        details['notes'].append('discount_rate<=0 (invalid)')
        return 0.0, details

    tg = terminal_growth_rate
    if tg >= discount_rate:
        tg = max(0.0, discount_rate - 0.01)
        details['notes'].append('terminal_growth adjusted to keep (r > g)')
    if tg < 0:
        tg = 0.0
        details['notes'].append('terminal_growth clamped to 0')

    pv_sum = 0.0
    cashflows = []
    for t in range(1, years + 1):
        cf_t = float(base_cashflow_per_share * ((1.0 + annual_growth) ** t))
        pv_t = float(cf_t / ((1.0 + discount_rate) ** t))
        pv_sum += pv_t
        cashflows.append({'t': t, 'cashflow': cf_t, 'pv': pv_t})

    cf_n = float(base_cashflow_per_share * ((1.0 + annual_growth) ** years))
    tv = float((cf_n * (1.0 + tg)) / (discount_rate - tg))
    tv_disc = float(tv / ((1.0 + discount_rate) ** years))
    result = float(pv_sum + tv_disc)

    details['pv_sum'] = float(pv_sum)
    details['terminal_value'] = float(tv)
    details['terminal_value_discounted'] = float(tv_disc)
    details['cashflows'] = cashflows
    details['terminal_growth_used'] = float(tg)
    details['result'] = float(result)
    return result, details


def _compute_weighted_average(valuations: dict, weights: dict) -> float:
    total_val = 0.0
    total_weight = 0.0
    for key, weight in (weights or {}).items():
        val = _to_float(valuations.get(key))
        w = _to_float(weight)
        if val > 0 and w > 0:
            total_val += val * w
            total_weight += w
    return (total_val / total_weight) if total_weight > 0 else 0.0


def _quality_grade(score: float) -> str:
    s = _to_float(score)
    if s >= 85:
        return 'A'
    if s >= 70:
        return 'B'
    if s >= 55:
        return 'C'
    if s >= 40:
        return 'D'
    return 'F'


def _build_quality_score(inputs: dict, pe_count: int, pb_count: int, ps_count: int) -> dict:
    checks: list[dict] = []

    def add_check(name: str, passed: bool, points: int, detail: str = ''):
        checks.append(
            {
                'name': name,
                'passed': bool(passed),
                'points': int(points if passed else 0),
                'max_points': int(points),
                'detail': detail,
            }
        )

    eps_ok = _to_float(inputs.get('eps_ttm')) > 0
    bvps_ok = _to_float(inputs.get('bvps')) > 0
    shares_ok = _to_float(inputs.get('shares_outstanding')) > 0
    screening_group_ok = bool(inputs.get('industry_screening_key'))

    add_check('eps_ttm_available', eps_ok, 20, inputs.get('eps_source', 'missing'))
    add_check('bvps_available', bvps_ok, 15, inputs.get('bvps_source', 'missing'))
    add_check('shares_outstanding_available', shares_ok, 10, 'sqlite.ratio_wide.outstanding_share')
    add_check('pe_peer_sample_ge_10', int(pe_count) >= 10, 15, f'count={int(pe_count)}')
    add_check('pb_peer_sample_ge_10', int(pb_count) >= 10, 15, f'count={int(pb_count)}')
    add_check('ps_peer_sample_ge_10', int(ps_count) >= 10, 15, f'count={int(ps_count)}')
    add_check('screening_industry_group_available', screening_group_ok, 10, str(inputs.get('industry_screening_key') or ''))

    total_points = int(sum(int(c.get('points', 0)) for c in checks))
    max_points = int(sum(int(c.get('max_points', 0)) for c in checks))
    pct = (100.0 * total_points / max_points) if max_points > 0 else 0.0

    return {
        'score': float(round(pct, 2)),
        'grade': _quality_grade(pct),
        'raw_points': total_points,
        'max_points': max_points,
        'checks': checks,
    }


def _calc_scenario(
    name: str,
    fcfe_base_per_share: float,
    fcff_base_per_share: float,
    eps: float,
    bvps: float,
    rev_per_share: float,
    pe_used: float,
    pb_used: float,
    ps_used: float,
    graham: float,
    weights: dict,
    projection_years: int,
    growth: float,
    terminal_growth: float,
    required_return: float,
    wacc: float,
    multiple_factor: float,
    current_price: float,
) -> dict:
    fcfe_value, _ = _dcf_per_share(
        base_cashflow_per_share=float(fcfe_base_per_share),
        annual_growth=float(growth),
        discount_rate=float(required_return),
        terminal_growth_rate=float(terminal_growth),
        years=int(projection_years),
    )
    fcff_value, _ = _dcf_per_share(
        base_cashflow_per_share=float(fcff_base_per_share),
        annual_growth=float(growth),
        discount_rate=float(wacc),
        terminal_growth_rate=float(terminal_growth),
        years=int(projection_years),
    )

    vals = {
        'fcfe': float(fcfe_value),
        'fcff': float(fcff_value),
        'justified_pe': float(eps * pe_used * multiple_factor) if eps > 0 else 0.0,
        'justified_pb': float(bvps * pb_used * multiple_factor) if bvps > 0 else 0.0,
        'graham': float(graham),
        'justified_ps': float(rev_per_share * ps_used * multiple_factor) if rev_per_share > 0 else 0.0,
    }
    weighted = _compute_weighted_average(vals, weights)
    vals['weighted_average'] = float(weighted)

    upside = 0.0
    if _to_float(current_price) > 0 and weighted > 0:
        upside = ((weighted - current_price) / current_price) * 100.0

    return {
        'name': name,
        'assumptions': {
            'growth': float(growth),
            'terminal_growth': float(terminal_growth),
            'required_return': float(required_return),
            'wacc': float(wacc),
            'multiple_factor': float(multiple_factor),
        },
        'valuations': vals,
        'upside_pct': float(upside),
    }


def _build_default_scenarios(
    fcfe_base_per_share: float,
    fcff_base_per_share: float,
    eps: float,
    bvps: float,
    rev_per_share: float,
    pe_used: float,
    pb_used: float,
    ps_used: float,
    graham: float,
    weights: dict,
    projection_years: int,
    growth: float,
    terminal_growth: float,
    required_return: float,
    wacc: float,
    current_price: float,
) -> dict:
    base = _calc_scenario(
        name='base',
        fcfe_base_per_share=fcfe_base_per_share,
        fcff_base_per_share=fcff_base_per_share,
        eps=eps,
        bvps=bvps,
        rev_per_share=rev_per_share,
        pe_used=pe_used,
        pb_used=pb_used,
        ps_used=ps_used,
        graham=graham,
        weights=weights,
        projection_years=projection_years,
        growth=growth,
        terminal_growth=terminal_growth,
        required_return=required_return,
        wacc=wacc,
        multiple_factor=1.0,
        current_price=current_price,
    )

    bull = _calc_scenario(
        name='bull',
        fcfe_base_per_share=fcfe_base_per_share,
        fcff_base_per_share=fcff_base_per_share,
        eps=eps,
        bvps=bvps,
        rev_per_share=rev_per_share,
        pe_used=pe_used,
        pb_used=pb_used,
        ps_used=ps_used,
        graham=graham,
        weights=weights,
        projection_years=projection_years,
        growth=min(0.30, growth + 0.02),
        terminal_growth=min(0.08, terminal_growth + 0.005),
        required_return=max(0.05, required_return - 0.01),
        wacc=max(0.05, wacc - 0.01),
        multiple_factor=1.1,
        current_price=current_price,
    )

    bear = _calc_scenario(
        name='bear',
        fcfe_base_per_share=fcfe_base_per_share,
        fcff_base_per_share=fcff_base_per_share,
        eps=eps,
        bvps=bvps,
        rev_per_share=rev_per_share,
        pe_used=pe_used,
        pb_used=pb_used,
        ps_used=ps_used,
        graham=graham,
        weights=weights,
        projection_years=projection_years,
        growth=max(-0.10, growth - 0.02),
        terminal_growth=max(0.0, terminal_growth - 0.005),
        required_return=min(0.35, required_return + 0.01),
        wacc=min(0.35, wacc + 0.01),
        multiple_factor=0.9,
        current_price=current_price,
    )

    return {'bear': bear, 'base': base, 'bull': bull}


def load_inputs_from_sqlite(symbol: str, current_price_override: float | None = None) -> dict:
    symbol = symbol.upper()

    ov = _load_symbol_overview_from_vci(symbol)
    if not ov:
        return {'success': False, 'error': f'Symbol {symbol} not found in overview'}

    ratio_wide_row = None

    industry = (ov['industry'] or 'Unknown')

    screening_db_path = resolve_vci_screening_db_path()
    screening_row = None
    try:
        screening_conn = sqlite3.connect(screening_db_path)
        screening_conn.row_factory = sqlite3.Row
        screening_row = screening_conn.execute(
            """
            SELECT ticker, icbCodeLv2, viSector, enSector, marketPrice
            FROM screening_data
            WHERE UPPER(ticker) = ?
            LIMIT 1
            """,
            (symbol,),
        ).fetchone()
        screening_conn.close()
    except Exception:
        screening_row = None

    # vci_stats_financial: freshest TTM ratios (pe, pb, ps, roe, shares)
    sf_row = _load_stats_financial_row(symbol)
    sf_pe = _to_float(sf_row['pe']) if sf_row else 0.0
    sf_pb = _to_float(sf_row['pb']) if sf_row else 0.0
    sf_ps = _to_float(sf_row['ps']) if sf_row else 0.0
    sf_roe = _to_float(sf_row['roe']) if sf_row else 0.0
    sf_shares = _to_float(sf_row['shares']) if sf_row else 0.0

    screening_market_price = _to_float(screening_row['marketPrice']) if screening_row else 0.0

    current_price = _to_float(current_price_override) if current_price_override and current_price_override > 0 else _to_float(ov['current_price'])
    current_price_source = 'request.currentPrice' if current_price_override and current_price_override > 0 else 'sqlite.overview.current_price'

    # Use VCI marketPrice as current_price fallback (updated every 5-15 min)
    if not (current_price and current_price > 0) and screening_market_price > 0:
        current_price = screening_market_price
        current_price_source = 'vci_screening.marketPrice'

    ov_eps_ttm = _to_float(ov['eps_ttm'])
    ov_bvps = _to_float(ov['bvps'])
    ov_pe = _to_float(ov['pe'])
    ov_pb = _to_float(ov['pb'])

    eps = 0.0
    bvps = 0.0
    eps_source = 'missing'
    bvps_source = 'missing'

    # EPS priority: TTM from vci_financials.isa23 → annual isa23 → price/pe (circular fallback)
    fs_ttm_eps = vci_load_ttm_eps(symbol) if has_vci_financial_db() else 0.0
    sf_eps = (screening_market_price / sf_pe) if (screening_market_price > 0 and sf_pe > 0) else 0.0
    if fs_ttm_eps > 0:
        eps = fs_ttm_eps
        eps_source = 'vci_financials.isa23 (TTM)'
    elif sf_eps > 0:
        eps = sf_eps
        eps_source = 'vci_stats_financial: marketPrice / pe (derived)'
    elif ov_eps_ttm > 0:
        eps = ov_eps_ttm
        eps_source = 'sqlite.overview.eps_ttm'
    elif current_price > 0 and ov_pe > 0:
        eps = current_price / ov_pe
        eps_source = 'derived: current_price / overview.pe'

    # BVPS priority: vci_stats_financial (marketPrice/pb) → overview.bvps → fallback
    sf_bvps = (screening_market_price / sf_pb) if (screening_market_price > 0 and sf_pb > 0) else 0.0
    if sf_bvps > 0:
        bvps = sf_bvps
        bvps_source = 'vci_stats_financial: marketPrice / pb'
    elif ov_bvps > 0:
        bvps = ov_bvps
        bvps_source = 'sqlite.overview.bvps'
    elif current_price > 0 and ov_pb > 0:
        bvps = current_price / ov_pb
        bvps_source = 'derived: current_price / overview.pb'

    # Normalize sf_roe: VCI returns decimal (0.15 = 15%)
    if 0 < abs(sf_roe) <= 1:
        sf_roe = sf_roe * 100.0

    screening_industry_key = None
    screening_industry_name = None
    if screening_row:
        try:
            screening_industry_key = str(screening_row['icbCodeLv2']) if screening_row['icbCodeLv2'] is not None else None
        except Exception:
            screening_industry_key = None
        screening_industry_name = screening_row['viSector'] or screening_row['enSector']

    # shares_outstanding: vci_stats_financial.shares → ratio_wide.outstanding_share
    outstanding_share = 0.0
    if sf_shares > 0:
        outstanding_share = sf_shares
    elif ratio_wide_row and ratio_wide_row['outstanding_share']:
        outstanding_share = _to_float(ratio_wide_row['outstanding_share'])

    # P/S: vci_stats_financial.ps → ratio_wide.ps
    ps_company = 0.0
    if sf_ps > 0:
        ps_company = sf_ps
    elif ratio_wide_row and ratio_wide_row['ps']:
        ps_company = _to_float(ratio_wide_row['ps'])

    market_cap_raw = _to_float((sf_row or {}).get('market_cap'))
    # TTM financial components (4-quarter sum when available)
    if has_vci_financial_db():
        financial_components = vci_load_ttm_financial_components(symbol)
    else:
        financial_components = _load_latest_financial_components(symbol)
    net_income_ttm = float(financial_components.get('net_income') or 0.0)
    net_income_source = financial_components.get('source', 'missing')
    # If BCTC has no net income, fall back to EPS × shares
    if net_income_ttm <= 0 and eps > 0 and outstanding_share > 0:
        net_income_ttm = float(eps * outstanding_share)
        net_income_source = 'derived: eps_ttm * shares_outstanding'
    implied_price_rw = (market_cap_raw / outstanding_share) if outstanding_share > 0 else 0.0
    eps_history_yearly = _load_eps_history_yearly(symbol, limit=10)
    eps_cagr = vci_load_eps_cagr(symbol, years=5) if has_vci_financial_db() else {'cagr': None, 'n_years': 0}

    return {
        'success': True,
        'symbol': symbol,
        'industry': industry,
        'industry_screening_key': screening_industry_key,
        'industry_screening_name': screening_industry_name,
        'is_bank': ov.get('is_bank', False),
        'current_price': float(current_price),
        'current_price_source': current_price_source,
        'eps_ttm': float(eps),
        'eps_source': eps_source,
        'bvps': float(bvps),
        'bvps_source': bvps_source,
        'ps_company': float(ps_company),
        'implied_price_rw': float(implied_price_rw),
        'shares_outstanding': float(outstanding_share),
        'net_income_ttm': float(net_income_ttm),
        'net_income_source': net_income_source,
        'cashflow_components': financial_components,
        'eps_history_yearly': eps_history_yearly,
        'eps_growth_suggestion': eps_cagr,
        'screening_roe': float(sf_roe),
    }


def calculate_valuation(symbol: str, request_data: dict) -> dict:
    include_lists = bool(request_data.get('includeComparableLists') or request_data.get('include_comparable_lists'))
    include_quality = bool(request_data.get('includeQuality', True))
    try:
        comparable_list_limit = int(request_data.get('comparableListLimit') or (500 if include_lists else 50))
    except Exception:
        comparable_list_limit = 500 if include_lists else 50
    comparable_list_limit = max(0, min(comparable_list_limit, 2000))

    current_price_override = _to_float(request_data.get('currentPrice'))
    inputs = load_inputs_from_sqlite(
        symbol=symbol,
        current_price_override=current_price_override if current_price_override > 0 else None,
    )
    if not inputs.get('success'):
        return inputs

    industry = inputs['industry']
    current_price = float(inputs['current_price'])
    eps = float(inputs['eps_ttm'])
    bvps = float(inputs['bvps'])
    shares_outstanding = float(inputs.get('shares_outstanding') or 0.0)
    net_income_ttm = float(inputs.get('net_income_ttm') or 0.0)
    fcfe_base_per_share = (net_income_ttm / shares_outstanding) if shares_outstanding > 0 else 0.0

    is_bank = bool(inputs.get('is_bank', False))

    # Assumptions
    projection_years = int(_to_float(request_data.get('projectionYears'), 5))
    projection_years = max(1, min(projection_years, 20))

    # Growth: user override → EPS CAGR suggestion → 8% default
    eps_cagr_data = inputs.get('eps_growth_suggestion') or {}
    eps_cagr_val = eps_cagr_data.get('cagr')
    default_growth_pct = round(float(eps_cagr_val) * 100, 1) if eps_cagr_val is not None else 8.0
    growth = _to_float(request_data.get('revenueGrowth'), default_growth_pct) / 100.0
    terminal_growth = _to_float(request_data.get('terminalGrowth'), 3.0) / 100.0
    required_return = _to_float(request_data.get('requiredReturn'), 12.0) / 100.0

    # WACC: user override → auto from Beta → 10.5% default
    wacc_from_request = _to_float(request_data.get('wacc'), 0.0) / 100.0
    if wacc_from_request > 0:
        wacc = wacc_from_request
        wacc_suggestion = None
    else:
        wacc_suggestion = _suggest_wacc(symbol, is_bank=is_bank)
        wacc = wacc_suggestion['wacc']
    tax_rate = _to_float(request_data.get('taxRate'), 20.0) / 100.0

    # Industry comparables: VCI screening industry peers (cached) → valuation_datamart fallback.
    screening_db_path = resolve_vci_screening_db_path()
    db_path = resolve_valuation_cache_db_path()
    screening_key = inputs.get('industry_screening_key')
    screening_name = inputs.get('industry_screening_name')
    datamart_row = _load_valuation_datamart_row(db_path, inputs['symbol'])

    rows: list[tuple[str, float, float]] = []
    ps_rows: list[tuple[str, float]] = []
    comparables_source = 'sqlite.vci_screening (icbCodeLv2 cohort; symbol excluded)'
    comparables_group = {'type': 'vci_screening.icbCodeLv2', 'key': industry}

    dm_screening_key = str((datamart_row or {}).get('industry_screening_key') or '').strip()
    dm_screening_name = str((datamart_row or {}).get('industry_screening_name') or '').strip()

    effective_screening_key = screening_key or (dm_screening_key or None)
    effective_screening_name = screening_name or dm_screening_name

    if effective_screening_key:
        try:
            rows = _screening_industry_cache.get_rows(screening_db_path, str(effective_screening_key))
            ps_rows = _screening_ps_cache.get_ps_rows(screening_db_path, str(effective_screening_key))
            comparables_group = {
                'type': 'vci_screening.icbCodeLv2',
                'key': str(effective_screening_key),
                'name': effective_screening_name,
            }
        except Exception:
            rows = []
            ps_rows = []

    # PE/PB should use their own valid samples independently.
    pe_values_all = [pe for sym, pe, _pb in rows if sym != inputs['symbol'] and 0 < pe <= 80]
    pb_values_all = [pb for sym, _pe, pb in rows if sym != inputs['symbol'] and 0 < pb <= 20]

    industry_median_pe = _median(pe_values_all)
    industry_median_pb = _median(pb_values_all)

    pe_sample_size = len(pe_values_all)
    pb_sample_size = len(pb_values_all)

    # valuation_datamart fallback: use precomputed medians only when VCI screening yielded nothing.
    if datamart_row and (industry_median_pe is None or industry_median_pb is None):
        dm_pe = _to_float(datamart_row.get('pe_median'))
        dm_pb = _to_float(datamart_row.get('pb_median'))
        dm_pe_count = int(_to_float(datamart_row.get('pe_count')))
        dm_pb_count = int(_to_float(datamart_row.get('pb_count')))
        if industry_median_pe is None and dm_pe > 0 and dm_pe_count > 0:
            industry_median_pe = float(dm_pe)
            pe_sample_size = dm_pe_count
            comparables_source = 'sqlite.valuation_datamart (precomputed medians fallback)'
        if industry_median_pb is None and dm_pb > 0 and dm_pb_count > 0:
            industry_median_pb = float(dm_pb)
            pb_sample_size = dm_pb_count

    pe_used = float(industry_median_pe) if industry_median_pe is not None else 15.0
    pb_used = float(industry_median_pb) if industry_median_pb is not None else 1.5

    justified_pe = float(eps * pe_used) if eps > 0 else 0.0
    justified_pb = float(bvps * pb_used) if bvps > 0 else 0.0

    graham = 0.0
    if eps > 0 and bvps > 0:
        graham = float((22.5 * eps * bvps) ** 0.5)

    # ── P/S (Price-to-Sales) valuation ──────────────────────────────────────────
    ps_company = float(inputs.get('ps_company', 0.0))
    implied_price_rw = float(inputs.get('implied_price_rw', 0.0))
    # Revenue per share derived from the company's own P/S ratio and implied price
    # rev_per_share = price / ps  (because ps = price / rev_per_share)
    price_for_ps = implied_price_rw if implied_price_rw > 0 else current_price
    rev_per_share = (price_for_ps / ps_company) if (ps_company > 0 and price_for_ps > 0) else 0.0

    ps_values_all = [ps for sym, ps in ps_rows if sym != inputs['symbol'] and 0 < ps <= 200]
    industry_median_ps = _median(ps_values_all)
    ps_sample_size = len(ps_values_all)

    if datamart_row:
        dm_ps = _to_float(datamart_row.get('ps_median'))
        dm_ps_count = int(_to_float(datamart_row.get('ps_count')))
        if dm_ps > 0 and dm_ps_count > 0:
            industry_median_ps = float(dm_ps)
            ps_sample_size = dm_ps_count

    ps_used = float(industry_median_ps) if industry_median_ps is not None else 3.0

    justified_ps = float(rev_per_share * ps_used) if rev_per_share > 0 else 0.0

    peers_detailed: list[dict] = []
    pe_peers: list[dict] = []
    pb_peers: list[dict] = []
    ps_peers: list[dict] = []

    if include_lists:
        screening_peers: list[dict] = []
        if screening_key:
            try:
                screening_peers = _load_screening_peer_details(screening_db_path, str(screening_key), inputs['symbol'])
            except Exception:
                screening_peers = []

        peers_detailed = _merge_peer_details(screening_peers, [])

        pe_peers = [
            {'symbol': str(p['symbol']).upper(), 'pe': float(_to_float(p.get('pe')))}
            for p in peers_detailed
            if _to_float(p.get('pe')) > 0 and _to_float(p.get('pe')) <= 80
        ]
        pb_peers = [
            {'symbol': str(p['symbol']).upper(), 'pb': float(_to_float(p.get('pb')))}
            for p in peers_detailed
            if _to_float(p.get('pb')) > 0 and _to_float(p.get('pb')) <= 20
        ]
        ps_peers = [
            {'symbol': str(p['symbol']).upper(), 'ps': float(_to_float(p.get('ps')))}
            for p in peers_detailed
            if _to_float(p.get('ps')) > 0 and _to_float(p.get('ps')) <= 200
        ]

    cashflow_components = inputs.get('cashflow_components') or {}
    net_income_base = _to_float(cashflow_components.get('net_income'))
    if net_income_base == 0:
        net_income_base = net_income_ttm

    depreciation_base = _to_float(cashflow_components.get('depreciation'))
    delta_wc_base = _to_float(cashflow_components.get('delta_working_capital'))
    capex_net_base = _to_float(cashflow_components.get('capex_net'))
    net_borrowing_base = _to_float(cashflow_components.get('net_borrowing'))
    interest_expense_base = abs(_to_float(cashflow_components.get('financial_expense')))
    interest_after_tax_base = interest_expense_base * (1.0 - tax_rate)

    fcfe_base_total = net_income_base + depreciation_base + net_borrowing_base - delta_wc_base - capex_net_base
    fcff_base_total = net_income_base + depreciation_base + interest_after_tax_base - delta_wc_base - capex_net_base

    fcfe_base_per_share = (fcfe_base_total / shares_outstanding) if shares_outstanding > 0 else 0.0
    fcff_base_per_share = (fcff_base_total / shares_outstanding) if shares_outstanding > 0 else 0.0

    fcfe_value, fcfe_details = _dcf_per_share(
        base_cashflow_per_share=float(fcfe_base_per_share),
        annual_growth=float(growth),
        discount_rate=float(required_return),
        terminal_growth_rate=float(terminal_growth),
        years=int(projection_years),
    )
    fcff_value, fcff_details = _dcf_per_share(
        base_cashflow_per_share=float(fcff_base_per_share),
        annual_growth=float(growth),
        discount_rate=float(wacc),
        terminal_growth_rate=float(terminal_growth),
        years=int(projection_years),
    )

    valuations = {
        'fcfe': float(fcfe_value),
        'fcff': float(fcff_value),
        'justified_pe': float(justified_pe),
        'justified_pb': float(justified_pb),
        'graham': float(graham),
        'justified_ps': float(justified_ps),
    }

    # Weighted average — bank model uses different weights
    weights = request_data.get('modelWeights', {}) or {}
    if not any(_to_float(w) > 0 for w in weights.values()):
        if is_bank:
            # Banks: PB-heavy (book value is meaningful), no FCFF (debt = product not capital)
            weights = {
                'fcfe': 10,
                'fcff': 0,
                'justified_pe': 20,
                'justified_pb': 35,
                'graham': 20,
                'justified_ps': 15,
            }
        else:
            weights = {
                'fcfe': 15,
                'fcff': 15,
                'justified_pe': 20,
                'justified_pb': 20,
                'graham': 15,
                'justified_ps': 15,
            }

    weighted_avg = _compute_weighted_average(valuations, weights)
    valuations['weighted_average'] = float(weighted_avg)

    scenarios = _build_default_scenarios(
        fcfe_base_per_share=float(fcfe_base_per_share),
        fcff_base_per_share=float(fcff_base_per_share),
        eps=float(eps),
        bvps=float(bvps),
        rev_per_share=float(rev_per_share),
        pe_used=float(pe_used),
        pb_used=float(pb_used),
        ps_used=float(ps_used),
        graham=float(graham),
        weights=weights,
        projection_years=int(projection_years),
        growth=float(growth),
        terminal_growth=float(terminal_growth),
        required_return=float(required_return),
        wacc=float(wacc),
        current_price=float(current_price),
    )

    quality = None
    if include_quality:
        quality = _build_quality_score(
            inputs=inputs,
            pe_count=pe_sample_size,
            pb_count=pb_sample_size,
            ps_count=ps_sample_size,
        )

    pe_values_export = pe_values_all[:comparable_list_limit]
    pb_values_export = pb_values_all[:comparable_list_limit]
    ps_values_export = ps_values_all[:comparable_list_limit]
    pe_peers_export = pe_peers[:comparable_list_limit]
    pb_peers_export = pb_peers[:comparable_list_limit]
    ps_peers_export = ps_peers[:comparable_list_limit]
    detailed_peers_export = peers_detailed[:comparable_list_limit]
    pe_truncated = len(pe_values_all) > len(pe_values_export)
    pb_truncated = len(pb_values_all) > len(pb_values_export)
    ps_truncated = len(ps_values_all) > len(ps_values_export)
    peers_detailed_truncated = len(peers_detailed) > len(detailed_peers_export)

    pe_summary = _summarize(pe_values_all, industry_median_pe)
    pb_summary = _summarize(pb_values_all, industry_median_pb)
    ps_summary = _summarize(ps_values_all, industry_median_ps)

    if pe_sample_size > pe_summary.get('count', 0):
        pe_summary['count'] = int(pe_sample_size)
        pe_summary['median_computed'] = industry_median_pe
    if pb_sample_size > pb_summary.get('count', 0):
        pb_summary['count'] = int(pb_sample_size)
        pb_summary['median_computed'] = industry_median_pb
    if ps_sample_size > ps_summary.get('count', 0):
        ps_summary['count'] = int(ps_sample_size)
        ps_summary['median_computed'] = industry_median_ps

    # Fair value range: ±1 std dev of industry PE applied to EPS
    pe_std = pe_summary.get('std_dev') or 0.0
    pb_std = pb_summary.get('std_dev') or 0.0
    fair_value_range = None
    if eps > 0 and pe_used > 0:
        fair_value_range = {
            'low_pe':  float(round(eps * max(0.0, pe_used - pe_std), 2)),
            'mid_pe':  float(round(eps * pe_used, 2)),
            'high_pe': float(round(eps * (pe_used + pe_std), 2)),
            'pe_std':  float(round(pe_std, 2)),
        }
        if bvps > 0 and pb_used > 0:
            fair_value_range.update({
                'low_pb':  float(round(bvps * max(0.0, pb_used - pb_std), 2)),
                'mid_pb':  float(round(bvps * pb_used, 2)),
                'high_pb': float(round(bvps * (pb_used + pb_std), 2)),
                'pb_std':  float(round(pb_std, 2)),
            })

    export = {
        'market': {
            'current_price': float(current_price),
            'current_price_source': inputs['current_price_source'],
        },
        'comparables': {
            'industry': industry,
            'group': comparables_group,
            'pe_ttm': {
                **pe_summary,
                'used': float(pe_used),
                'values': [float(v) for v in pe_values_export] if include_lists else [],
                'peers': pe_peers_export if include_lists else [],
                'truncated': bool(pe_truncated) if include_lists else False,
                'filter': {'min_exclusive': 0, 'max_inclusive': 80},
            },
            'pb': {
                **pb_summary,
                'used': float(pb_used),
                'values': [float(v) for v in pb_values_export] if include_lists else [],
                'peers': pb_peers_export if include_lists else [],
                'truncated': bool(pb_truncated) if include_lists else False,
                'filter': {'min_exclusive': 0, 'max_inclusive': 20},
            },
            'ps': {
                **ps_summary,
                'used': float(ps_used),
                'values': [float(v) for v in ps_values_export] if include_lists else [],
                'peers': ps_peers_export if include_lists else [],
                'truncated': bool(ps_truncated) if include_lists else False,
                'filter': {'min_exclusive': 0, 'max_inclusive': 200},
            },
            'peers_detailed': detailed_peers_export if include_lists else [],
            'peers_detailed_truncated': bool(peers_detailed_truncated) if include_lists else False,
            'defaults_if_missing': {'pe_ttm': 15.0, 'pb': 1.5, 'ps': 3.0},
            'source': comparables_source,
            'null_handling': 'PE/PB samples exclude only NULL/invalid values for each metric independently',
        },
        'calculation': {
            'dcf_fcfe': {
                'cashflow_proxy': 'FCFE = net_income + depreciation + net_borrowing - delta_working_capital - capex_net',
                'net_income': float(net_income_base),
                'net_income_source': inputs.get('net_income_source', 'missing'),
                'shares_outstanding': float(shares_outstanding),
                'depreciation': float(depreciation_base),
                'net_borrowing': float(net_borrowing_base),
                'delta_working_capital': float(delta_wc_base),
                'capex_net': float(capex_net_base),
                'base_cashflow_total': float(fcfe_base_total),
                'base_cashflow_per_share': float(fcfe_base_per_share),
                'inputs': {
                    'projection_years': int(projection_years),
                    'growth': float(growth),
                    'terminal_growth': float(terminal_growth),
                    'required_return': float(required_return),
                },
                'details': fcfe_details,
                'result': float(fcfe_value),
            },
            'dcf_fcff': {
                'cashflow_proxy': 'FCFF = net_income + depreciation + interest_after_tax - delta_working_capital - capex_net',
                'net_income': float(net_income_base),
                'net_income_source': inputs.get('net_income_source', 'missing'),
                'depreciation': float(depreciation_base),
                'interest_expense': float(interest_expense_base),
                'interest_after_tax': float(interest_after_tax_base),
                'tax_rate': float(tax_rate),
                'delta_working_capital': float(delta_wc_base),
                'capex_net': float(capex_net_base),
                'base_cashflow_total': float(fcff_base_total),
                'base_cashflow_per_share': float(fcff_base_per_share),
                'inputs': {
                    'projection_years': int(projection_years),
                    'growth': float(growth),
                    'terminal_growth': float(terminal_growth),
                    'wacc': float(wacc),
                },
                'details': fcff_details,
                'result': float(fcff_value),
            },
            'justified_pe': {
                'eps_ttm': float(eps),
                'eps_source': inputs['eps_source'],
                'pe_used': float(pe_used),
                'formula': 'eps_ttm * pe_used',
                'result': float(justified_pe),
            },
            'justified_pb': {
                'bvps': float(bvps),
                'bvps_source': inputs['bvps_source'],
                'pb_used': float(pb_used),
                'formula': 'bvps * pb_used',
                'result': float(justified_pb),
            },
            'justified_ps': {
                'ps_company': float(ps_company),
                'rev_per_share': float(rev_per_share),
                'ps_used': float(ps_used),
                'formula': 'rev_per_share * industry_median_ps',
                'industry_ps_sample_size': int(ps_sample_size),
                'result': float(justified_ps),
            },
        },
        'list_limit': comparable_list_limit,
        'include_lists': bool(include_lists),
        'scenarios': scenarios,
        'quality': quality,
        'inputs_sources': {
            'eps_ttm': inputs['eps_source'],
            'bvps': inputs['bvps_source'],
            'current_price': inputs['current_price_source'],
            'shares_outstanding': 'sqlite.ratio_wide.outstanding_share',
            'net_income_ttm': inputs.get('net_income_source', 'missing'),
            'cashflow_components': (cashflow_components.get('source') or 'missing'),
        },
    }

    fcfe_inputs_legacy = {
        'netIncome': float(net_income_base),
        'depreciation': float(depreciation_base),
        'workingCapitalInvestment': float(delta_wc_base),
        'fixedCapitalInvestment': float(capex_net_base),
        'netBorrowing': float(net_borrowing_base),
        'sharesOutstanding': float(shares_outstanding),
    }
    fcff_inputs_legacy = {
        'netIncome': float(net_income_base),
        'depreciation': float(depreciation_base),
        'interestExpense': float(interest_expense_base),
        'interestAfterTax': float(interest_after_tax_base),
        'workingCapitalInvestment': float(delta_wc_base),
        'fixedCapitalInvestment': float(capex_net_base),
        'sharesOutstanding': float(shares_outstanding),
    }
    fcfe_details['inputs'] = fcfe_inputs_legacy
    fcff_details['inputs'] = fcff_inputs_legacy

    return {
        'success': True,
        'symbol': inputs['symbol'],
        'is_bank': is_bank,
        'valuations': valuations,
        'fair_value_range': fair_value_range,
        'fcfe_details': fcfe_details,
        'fcff_details': fcff_details,
        'scenarios': scenarios,
        'quality': quality,
        'wacc_suggestion': wacc_suggestion,
        'inputs': {
            'current_price': float(current_price),
            'eps_ttm': float(eps),
            'eps_source': inputs['eps_source'],
            'bvps': float(bvps),
            'is_bank': is_bank,
            'industry': industry,
            'industry_median_pe_ttm_used': float(pe_used),
            'industry_median_pb_used': float(pb_used),
            'industry_pe_sample_size': int(pe_sample_size),
            'industry_pb_sample_size': int(pb_sample_size),
            'ps_company': float(ps_company),
            'rev_per_share': float(rev_per_share),
            'industry_median_ps_used': float(ps_used),
            'industry_ps_sample_size': int(ps_sample_size),
            'shares_outstanding': float(shares_outstanding),
            'net_income_ttm': float(net_income_ttm),
            'fcfe_base_per_share': float(fcfe_base_per_share),
            'fcff_base_per_share': float(fcff_base_per_share),
            'cashflow_components': cashflow_components,
            'eps_ttm_current': float(eps),
            'eps_history_yearly': inputs.get('eps_history_yearly', []),
            'eps_growth_suggestion': inputs.get('eps_growth_suggestion'),
            'growth_used': float(round(growth * 100, 2)),
            'wacc_used': float(round(wacc * 100, 2)),
            'model_weights': weights,
        },
        'export': export,
    }


def calculate_sensitivity(symbol: str, request_data: dict) -> dict:
    current_price_override = _to_float(request_data.get('currentPrice'))
    inputs = load_inputs_from_sqlite(
        symbol=symbol,
        current_price_override=current_price_override if current_price_override > 0 else None,
    )
    if not inputs.get('success'):
        return inputs

    eps = float(inputs.get('eps_ttm') or 0.0)
    if eps <= 0:
        return {
            'success': False,
            'symbol': str(symbol).upper(),
            'error': 'EPS not available for sensitivity calculation',
        }

    is_bank = bool(inputs.get('is_bank', False))
    wacc_suggestion = _suggest_wacc(symbol, is_bank=is_bank)
    default_wacc_pct = round(wacc_suggestion['wacc'] * 100, 1)
    base_wacc = _to_float(request_data.get('baseWacc'), default_wacc_pct) / 100.0
    base_growth = _to_float(request_data.get('baseGrowth'), 8.0) / 100.0
    terminal_growth = _to_float(request_data.get('terminalGrowth'), 3.0) / 100.0
    projection_years = int(_to_float(request_data.get('projectionYears'), 5))
    projection_years = max(1, min(projection_years, 20))

    # +/-2 percentage points around base assumptions.
    wacc_axis = [
        round((base_wacc + delta) * 100.0, 2)
        for delta in (-0.02, -0.01, 0.0, 0.01, 0.02)
    ]
    growth_axis = [
        round((base_growth + delta) * 100.0, 2)
        for delta in (-0.02, -0.01, 0.0, 0.01, 0.02)
    ]

    matrix: list[list[float]] = []
    for wacc_pct in wacc_axis:
        row: list[float] = []
        wacc = max(0.04, min(0.40, wacc_pct / 100.0))
        for growth_pct in growth_axis:
            growth = max(-0.20, min(0.35, growth_pct / 100.0))
            tg = max(0.0, min(0.10, terminal_growth))
            val, _details = _dcf_per_share(
                base_cashflow_per_share=float(eps),
                annual_growth=float(growth),
                discount_rate=float(wacc),
                terminal_growth_rate=float(tg),
                years=int(projection_years),
            )
            row.append(float(round(_to_float(val), 4)))
        matrix.append(row)

    return {
        'success': True,
        'symbol': inputs['symbol'],
        'wacc_axis': wacc_axis,
        'growth_axis': growth_axis,
        'matrix': matrix,
        'eps_used': float(eps),
        'base_wacc': round(base_wacc * 100.0, 2),
        'base_growth': round(base_growth * 100.0, 2),
        'terminal_growth': round(terminal_growth * 100.0, 2),
        'projection_years': int(projection_years),
        'source': 'valuation_service._dcf_per_share',
    }
