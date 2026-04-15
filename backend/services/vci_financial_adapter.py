"""
Adapter: read financial data from VCI financial statement DB (wide-format, VCI field codes).
Returns rows with raw VCI field codes (isa*, bsa*, cfa*) — NO translation to English names.

Mapping is handled in frontend via fetch_sqlite/vci_field_codes.json.
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

_CASH_FLOW_COLS = [
    'cfa1', 'cfa2', 'cfa3', 'cfa4', 'cfa5', 'cfa6', 'cfa7', 'cfa8',
    'cfa9', 'cfa10', 'cfa11', 'cfa12', 'cfa13', 'cfa14', 'cfa15',
    'cfa16', 'cfa17', 'cfa18', 'cfa19', 'cfa20', 'cfa21', 'cfa22',
    'cfa23', 'cfa24', 'cfa25', 'cfa26', 'cfa27', 'cfa28', 'cfa29',
    'cfa30', 'cfa31', 'cfa32', 'cfa33', 'cfa34', 'cfa35', 'cfa103',
    'cfa104', 'cfa105',
]

_BALANCE_SHEET_COLS = [
    'bsa1', 'bsa2', 'bsa3', 'bsa4', 'bsa5', 'bsa6', 'bsa7', 'bsa8',
    'bsa9', 'bsa10', 'bsa11', 'bsa12', 'bsa13', 'bsa14', 'bsa15',
    'bsa16', 'bsa17', 'bsa18', 'bsa19', 'bsa20', 'bsa21', 'bsa22',
    'bsa23', 'bsa24', 'bsa25', 'bsa26', 'bsa27', 'bsa28', 'bsa29',
    'bsa30', 'bsa31', 'bsa32', 'bsa33', 'bsa34', 'bsa35', 'bsa36',
    'bsa37', 'bsa38', 'bsa39', 'bsa40', 'bsa41', 'bsa42', 'bsa43',
    'bsa44', 'bsa45', 'bsa46', 'bsa47', 'bsa48', 'bsa49', 'bsa50',
    'bsa51', 'bsa52', 'bsa53', 'bsa54', 'bsa55', 'bsa56', 'bsa57',
    'bsa58', 'bsa59', 'bsa60', 'bsa61', 'bsa62', 'bsa63', 'bsa64',
    'bsa65', 'bsa66', 'bsa67', 'bsa68', 'bsa69', 'bsa70', 'bsa71',
    'bsa72', 'bsa73', 'bsa74', 'bsa76', 'bsa77', 'bsa78', 'bsa79',
    'bsa80', 'bsa81', 'bsa82', 'bsa83', 'bsa84', 'bsa85', 'bsa86',
    'bsa87', 'bsa88', 'bsa89', 'bsa90', 'bsa96', 'bsa210',
]

# ── Metadata columns always excluded from output ──
_META_COLS = frozenset({
    'ticker', 'period_kind', 'length_report',
    'public_date', 'create_date', 'update_date', 'fetched_at',
})


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


def get_cash_flow_statement(
    symbol: str,
    limit: int = 20,
) -> list[dict]:
    """Return cash flow statement rows with raw VCI field codes (cfa*)."""
    db_path = _get_db_path()
    if not db_path:
        return []

    symbol = symbol.upper()
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row

        cols_sql = ', '.join(_CASH_FLOW_COLS)

        rows = conn.execute(
            f"""
            SELECT year_report, quarter_report, {cols_sql}
            FROM cash_flow
            WHERE ticker = ?
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
            for col in _CASH_FLOW_COLS:
                val = rd.get(col)
                out[col] = float(val) if val is not None and val != '' else None
            result.append(out)
        return result
    except Exception as exc:
        logger.debug(f"VCI cash_flow_statement read failed for {symbol}: {exc}")
        return []


def get_balance_sheet(
    symbol: str,
    annual_only: bool = True,
    limit: int = 20,
) -> list[dict]:
    """Return balance sheet rows with raw VCI field codes (bsa*)."""
    db_path = _get_db_path()
    if not db_path:
        return []

    symbol = symbol.upper()
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row

        cols_sql = ', '.join(_BALANCE_SHEET_COLS)
        period_filter = "period_kind = 'YEAR'" if annual_only else "1=1"

        rows = conn.execute(
            f"""
            SELECT year_report, quarter_report, {cols_sql}
            FROM balance_sheet
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
            for col in _BALANCE_SHEET_COLS:
                val = rd.get(col)
                out[col] = float(val) if val is not None and val != '' else None
            result.append(out)
        return result
    except Exception as exc:
        logger.debug(f"VCI balance_sheet read failed for {symbol}: {exc}")
        return []


# ── Convenience functions matching valuation_service.py query patterns ──
# These now use raw VCI field codes internally.


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


def load_latest_net_income(symbol: str) -> tuple[float, str]:
    """Return (net_income, source) — priority: isa22 (parent) → isa20 (total)."""
    rows = get_income_statement(symbol, annual_only=False, limit=20)
    # First try net_profit_parent_company (isa22)
    for r in rows:
        val = r.get('isa22')
        if val is not None and float(val) > 0:
            return float(val), 'vci_fs.income_statement.isa22'
    # Fallback to net_profit_after_tax (isa20)
    for r in rows:
        val = r.get('isa20')
        if val is not None and float(val) > 0:
            return float(val), 'vci_fs.income_statement.isa20'
    return 0.0, 'missing'


def load_latest_financial_components(symbol: str) -> dict:
    """Return income + cash flow components needed for FCFE calculation.

    All keys are raw VCI field codes (isa*, cfa*).
    """
    db_path = _get_db_path()
    result = {
        'isa20': 0.0,  # net_profit
        'isa22': 0.0,  # net_profit_parent
        'period_year': None,
        'period_quarter': None,
        'isa7': 0.0,   # financial_expense
        'cfa2': 0.0,   # depreciation
        'cfa9': 0.0,   # receivables change
        'cfa10': 0.0,  # inventory change
        'cfa11': 0.0,  # payables change
        'cfa18': 0.0,  # purchase fixed assets
        'cfa19': 0.0,  # proceeds disposal fixed assets
        'cfa27': 0.0,  # proceeds borrowings
        'cfa28': 0.0,  # repayments borrowings
        'source': 'vci_fs.income_statement + cash_flow (latest period)',
    }

    # Income statement
    income_rows = get_income_statement(symbol, annual_only=False, limit=20)
    if income_rows:
        r = income_rows[0]
        result['isa22'] = float(r.get('isa22') or 0.0)
        result['isa20'] = float(r.get('isa20') or 0.0)
        result['period_year'] = r.get('year')
        result['period_quarter'] = r.get('quarter')
        result['isa7'] = float(r.get('isa7') or 0.0)

    # Cash flow statement
    cf_rows = get_cash_flow_statement(symbol, limit=20)
    if cf_rows:
        r = cf_rows[0]
        result['cfa2'] = float(r.get('cfa2') or 0.0)
        result['cfa9'] = float(r.get('cfa9') or 0.0)
        result['cfa10'] = float(r.get('cfa10') or 0.0)
        result['cfa11'] = float(r.get('cfa11') or 0.0)
        result['cfa18'] = float(r.get('cfa18') or 0.0)
        result['cfa19'] = float(r.get('cfa19') or 0.0)
        result['cfa27'] = float(r.get('cfa27') or 0.0)
        result['cfa28'] = float(r.get('cfa28') or 0.0)

    return result


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
