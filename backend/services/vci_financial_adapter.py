"""
Adapter: read financial data from VCI financial statement DB (wide-format, VCI field codes).
Returns rows with raw VCI field codes (isa*, bsa*, cfa*) — NO translation to English names.

Mapping is handled in frontend via config/vci_field_codes.json.
"""

import sqlite3
import logging
from typing import Optional

from backend.db_path import resolve_vci_financial_statement_db_path

logger = logging.getLogger(__name__)

# ── VCI field codes to SELECT for each statement ──

_INCOME_COLS = [
    'isa1', 'isa2', 'isa3', 'isa4', 'isa5', 'isa6', 'isa7', 'isa8',
    'isa9', 'isa10', 'isa11', 'isa12', 'isa13', 'isa14', 'isa15',
    'isa16', 'isa17', 'isa18', 'isa19', 'isa20', 'isa21', 'isa22',
    'isa23', 'isa24', 'isa102',
]

def _get_db_path() -> Optional[str]:
    path = resolve_vci_financial_statement_db_path()
    if path:
        return path
    return None


def get_income_statement(
    symbol: str,
    annual_only: bool = True,
    limit: int = 20,
) -> list[dict]:
    """Return income statement rows with raw VCI field codes (isa*)."""
    db_path = _get_db_path()
    if not db_path:
        return []

    symbol = symbol.upper()
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row

        cols_sql = ', '.join(_INCOME_COLS)
        period_filter = "period_kind = 'YEAR'" if annual_only else "1=1"

        rows = conn.execute(
            f"""
            SELECT year_report, quarter_report, {cols_sql}
            FROM income_statement
            WHERE ticker = ? AND {period_filter}
            ORDER BY year_report DESC, quarter_report DESC
            LIMIT ?
            """,
            (symbol, limit),
        ).fetchall()
        conn.close()

        result = []
        for r in rows:
            rd = dict(r)
            out = {
                'year': rd.get('year_report'),
                'quarter': rd.get('quarter_report'),
            }
            # Return raw VCI codes without translation
            for col in _INCOME_COLS:
                val = rd.get(col)
                out[col] = float(val) if val is not None and val != '' else None
            result.append(out)
        return result
    except Exception as exc:
        logger.debug(f"VCI income_statement read failed for {symbol}: {exc}")
        return []


def load_eps_history_yearly(symbol: str, limit: int = 10) -> list[dict]:
    """EPS history from annual income statements (isa23 = EPS basic)."""
    rows = get_income_statement(symbol, annual_only=True, limit=limit)
    cleaned = []
    for r in rows:
        eps = r.get('isa23')
        year = r.get('year')
        if year is None or eps is None:
            continue
        eps_val = float(eps)
        if eps_val <= 0:
            continue
        cleaned.append({'year': int(year), 'eps': eps_val})
    cleaned.sort(key=lambda x: x['year'])
    return cleaned


def _consecutive_quarters(rows: list[dict]) -> bool:
    if len(rows) != 4:
        return False
    periods = [int(r['year_report']) * 4 + int(r['quarter_report']) for r in rows]
    return all(periods[i] - periods[i + 1] == 1 for i in range(3))


def _statement_rows(symbol: str, table: str, columns: str, annual: bool = False) -> list[dict]:
    """Read one annual period or four quarterly periods, newest first."""
    path = _get_db_path()
    if not path:
        return []
    conn = None
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            f"SELECT year_report, quarter_report, {columns} FROM {table} "
            "WHERE ticker = ? AND period_kind = ? "
            "ORDER BY year_report DESC, quarter_report DESC LIMIT ?",
            (symbol.upper(), 'YEAR' if annual else 'QUARTER', 1 if annual else 4),
        ).fetchall()
        return [dict(row) for row in rows]
    except sqlite3.Error as exc:
        logger.debug("Statement read failed for %s/%s: %s", symbol, table, exc)
        return []
    finally:
        if conn is not None:
            conn.close()


def _financial_components(income: list[dict], cashflow: list[dict], source: str) -> dict:
    def total(rows, field):
        return sum(float(row.get(field) or 0.0) for row in rows)

    # Field meanings are defined in config/vci_field_codes.json. Zero capex
    # is valid; do not silently replace it with depreciation.
    net_income = sum(float(r['isa22'] if r.get('isa22') is not None
                           else r.get('isa20') or 0.0) for r in income)
    depreciation = total(cashflow, 'cfa2')
    purchases = abs(total(cashflow, 'cfa19'))
    disposals = max(0.0, total(cashflow, 'cfa20'))
    borrowings = total(cashflow, 'cfa29')
    repayments = -abs(total(cashflow, 'cfa30'))
    return {
        'net_income': net_income,
        'period_year': income[0]['year_report'] if income else None,
        'period_quarter': 'TTM' if len(income) == 4 else 0 if income else None,
        # Retain this response key for existing clients; its value is interest only.
        'financial_expense': abs(total(income, 'isa8')),
        'depreciation': depreciation,
        'depreciation_fixed_assets': depreciation,
        'operating_cf': total(cashflow, 'cfa18'),
        'capex_net': purchases - disposals,
        'proceeds_borrowings': borrowings,
        'repayments_borrowings': repayments,
        'net_borrowing': borrowings + repayments,
        'source': source,
    }


_INCOME_COMPONENTS = 'isa20, isa22, isa8'
_CASHFLOW_COMPONENTS = 'cfa2, cfa18, cfa19, cfa20, cfa29, cfa30'


def load_latest_financial_components(symbol: str) -> dict:
    """Use a matching annual period when a complete TTM cannot be built.

    Never treat a single quarter as a full year of DCF cash flow.
    """
    income = _statement_rows(symbol, 'income_statement', _INCOME_COMPONENTS, annual=True)
    cashflow = _statement_rows(symbol, 'cash_flow', _CASHFLOW_COMPONENTS, annual=True)
    if (not income or not cashflow
            or income[0]['year_report'] != cashflow[0]['year_report']
            or cashflow[0]['cfa18'] is None):
        return _financial_components([], [], 'missing')
    return _financial_components(income, cashflow, 'vci_fs.annual (latest matched year)')


def load_ttm_eps(symbol: str) -> float | None:
    """Sum four consecutive quarterly EPS, retaining losses and zero values.

    None means unavailable; a reported loss must not trigger a positive fallback.
    """
    rows = _statement_rows(symbol, 'income_statement', 'isa23')
    if _consecutive_quarters(rows) and all(r['isa23'] is not None for r in rows):
        return sum(float(r['isa23']) for r in rows)
    annual = _statement_rows(symbol, 'income_statement', 'isa23', annual=True)
    if annual and annual[0]['isa23'] is not None:
        return float(annual[0]['isa23'])
    return None


def load_ttm_financial_components(symbol: str) -> dict:
    """Sum matching, consecutive quarters; otherwise use annual statements."""
    income = _statement_rows(symbol, 'income_statement', _INCOME_COMPONENTS)
    cashflow = _statement_rows(symbol, 'cash_flow', _CASHFLOW_COMPONENTS)
    def periods(rows):
        return [(r['year_report'], r['quarter_report']) for r in rows]
    if (not _consecutive_quarters(income) or not _consecutive_quarters(cashflow)
            or periods(income) != periods(cashflow)
            or any(r['cfa18'] is None for r in cashflow)):
        return load_latest_financial_components(symbol)
    return _financial_components(income, cashflow, 'vci_fs.ttm (4 matched quarters)')


def load_latest_balance_sheet_components(symbol: str) -> dict:
    """Load the latest reported cash and interest-bearing debt for an EV bridge.

    A DCF based on FCFF produces enterprise value, so the valuation service must
    deduct net debt before presenting a value per share.  This deliberately uses
    the latest balance-sheet snapshot rather than summing balance-sheet rows.
    """
    symbol = symbol.upper()
    db_path = _get_db_path()
    if not db_path:
        return {'cash': 0.0, 'short_term_debt': 0.0, 'long_term_debt': 0.0,
                'total_debt': 0.0, 'net_debt': 0.0, 'source': 'missing'}
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT year_report, quarter_report, bsa2, bsa5, bsa56, bsa71
            FROM balance_sheet
            WHERE ticker = ?
            ORDER BY year_report DESC, quarter_report DESC
            LIMIT 1
            """,
            (symbol,),
        ).fetchone()
        conn.close()
        if not row:
            return {'cash': 0.0, 'short_term_debt': 0.0, 'long_term_debt': 0.0,
                    'total_debt': 0.0, 'net_debt': 0.0, 'source': 'missing'}
        cash = max(0.0, float(row['bsa2'] or 0.0)) + max(0.0, float(row['bsa5'] or 0.0))
        short_term_debt = max(0.0, float(row['bsa56'] or 0.0))
        long_term_debt = max(0.0, float(row['bsa71'] or 0.0))
        total_debt = short_term_debt + long_term_debt
        return {
            'cash': cash,
            'short_term_debt': short_term_debt,
            'long_term_debt': long_term_debt,
            'total_debt': total_debt,
            'net_debt': total_debt - cash,
            'period_year': row['year_report'],
            'period_quarter': row['quarter_report'],
            'source': 'vci_fs.balance_sheet (latest reported period)',
        }
    except Exception as exc:
        logger.debug("Latest balance-sheet components failed for %s: %s", symbol, exc)
        return {'cash': 0.0, 'short_term_debt': 0.0, 'long_term_debt': 0.0,
                'total_debt': 0.0, 'net_debt': 0.0, 'source': 'missing'}


def load_eps_cagr(symbol: str, years: int = 5) -> dict:
    """EPS growth CAGR from annual history.

    Returns {'cagr': float|None, 'n_years': int, 'eps_start': float, 'eps_end': float}
    """
    # `years` is the intended CAGR span; request exactly years + one annual
    # observations rather than silently extending the window.
    history = load_eps_history_yearly(symbol, limit=years + 1)
    if len(history) < 2:
        return {'cagr': None, 'n_years': 0, 'eps_start': None, 'eps_end': None, 'years_used': []}
    eps_start = history[0]['eps']
    eps_end = history[-1]['eps']
    n_years = history[-1]['year'] - history[0]['year']
    if n_years <= 0 or eps_start <= 0 or eps_end <= 0:
        return {'cagr': None, 'n_years': n_years, 'eps_start': eps_start, 'eps_end': eps_end, 'years_used': [h['year'] for h in history]}
    cagr = (eps_end / eps_start) ** (1.0 / n_years) - 1.0
    return {
        'cagr': float(round(cagr, 4)),
        'n_years': int(n_years),
        'eps_start': float(eps_start),
        'eps_end': float(eps_end),
        'years_used': [h['year'] for h in history],
    }


def has_vci_financial_db() -> bool:
    """Check if VCI financial statement DB exists and is accessible."""
    path = _get_db_path()
    if not path:
        return False
    try:
        import os
        return os.path.exists(path)
    except Exception:
        return False
