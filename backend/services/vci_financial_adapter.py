"""
Adapter: read financial data from VCI financial statement DB (wide-format, VCI field codes)
and present it in the same shape that valuation_service.py expects from stocks_optimized.db.

VCI DB field code mapping (via vci_financial_statement_metrics_hose_hnx.json):
  Income:  isa1=Sales, isa3=Net sales, isa5=Gross Profit, isa7=Financial expenses,
           isa16=Profit before tax, isa19=Corporate income tax, isa20=Net profit after tax,
           isa21=Minority interests, isa22=Attributable to parent, isa23/isa24=EPS
  Cash flow: cfa1=Profit before tax, cfa2=Depreciation, cfa9=Receivables change,
             cfa10=Inventory change, cfa11=Payables change,
             csb141=Purchase fixed assets, csb142=Proceeds disposal fixed assets,
             csb146=Proceeds from borrowings, csb147=Repayments of borrowings
"""

import sqlite3
import json
import logging
from pathlib import Path
from typing import Optional

from backend.db_path import resolve_vci_financial_statement_db_path

logger = logging.getLogger(__name__)

# ── VCI field code → English column name (maps to stocks_optimized.db columns) ──

_INCOME_MAP = {
    'isa1': 'revenue',
    'isa3': 'net_revenue',
    'isa4': 'cost_of_goods_sold',
    'isa5': 'gross_profit',
    'isa6': 'financial_income',
    'isa7': 'financial_expense',
    'isa11': 'operating_profit',
    'isa16': 'profit_before_tax',
    'isa19': 'corporate_income_tax',
    'isa20': 'net_profit',
    'isa21': 'minority_interest',
    'isa22': 'net_profit_parent_company',
    'isa23': 'eps',
    'isa24': 'eps_diluted',
}

_CASH_FLOW_MAP = {
    'cfa1': 'profit_before_tax',
    'cfa2': 'depreciation_fixed_assets',
    'cfa3': 'provision_credit_loss_real_estate',
    'cfa4': 'profit_loss_from_disposal_fixed_assets',
    'cfa5': 'profit_loss_investment_activities',
    'cfa6': 'interest_income',
    'cfa7': 'interest_and_dividend_income',
    'cfa8': 'net_cash_flow_from_operating_activities_before_working_capital',
    'cfa9': 'increase_decrease_receivables',
    'cfa10': 'increase_decrease_inventory',
    'cfa11': 'increase_decrease_payables',
    'cfa12': 'increase_decrease_prepaid_expenses',
    'cfa13': 'interest_expense_paid',
    'cfa14': 'corporate_income_tax_paid',
    'cfa15': 'other_cash_from_operating_activities',
    'cfa16': 'other_cash_paid_for_operating_activities',
    'cfa17': 'net_cash_from_operating_activities',
    'cfa18': 'purchase_purchase_fixed_assets',
    'cfa19': 'proceeds_from_disposal_fixed_assets',
    'cfa20': 'loans_other_collections',
    'cfa21': 'investments_other_companies',
    'cfa22': 'proceeds_from_sale_investments_other_companies',
    'cfa23': 'dividends_and_profits_received',
    'cfa24': 'net_cash_from_investing_activities',
    'cfa25': 'increase_share_capital_contribution_equity',
    'cfa26': 'payment_for_capital_contribution_buyback_shares',
    'cfa27': 'proceeds_from_borrowings',
    'cfa28': 'repayments_of_borrowings',
    'cfa29': 'lease_principal_payments',
    'cfa30': 'dividends_paid',
    'cfa31': 'other_cash_from_financing_activities',
    'cfa32': 'net_cash_from_financing_activities',
    'cfa33': 'net_cash_flow_period',
    'cfa34': 'cash_and_cash_equivalents_beginning',
    'cfa35': 'cash_and_cash_equivalents_ending',
}

# Reverse maps: English → VCI field code (for building queries)
_VCI_INCOME_BY_ENGLISH = {v: k for k, v in _INCOME_MAP.items()}
_VCI_CASH_FLOW_BY_ENGLISH = {v: k for k, v in _CASH_FLOW_MAP.items()}

# Which VCI fields to SELECT for income statement (valuation_service needs these)
_INCOME_COLS_NEEDED = [
    'isa1',   # revenue
    'isa3',   # net_revenue
    'isa5',   # gross_profit
    'isa7',   # financial_expense
    'isa11',  # operating_profit
    'isa16',  # profit_before_tax
    'isa19',  # corporate_income_tax
    'isa20',  # net_profit
    'isa21',  # minority_interest
    'isa22',  # net_profit_parent_company
    'isa23',  # eps
    'isa24',  # eps_diluted
]

_CASH_FLOW_COLS_NEEDED = [
    'cfa1',   # profit_before_tax
    'cfa2',   # depreciation_fixed_assets
    'cfa10',  # increase_decrease_receivables
    'cfa11',  # increase_decrease_inventory
    'cfa12',  # increase_decrease_payables
    'cfa18',  # purchase_purchase_fixed_assets
    'cfa19',  # proceeds_from_disposal_fixed_assets
    'cfa27',  # proceeds_from_borrowings
    'cfa28',  # repayments_of_borrowings
]

# ── Metadata columns always excluded from output ──
_META_COLS = frozenset({
    'ticker', 'period_kind', 'length_report',
    'public_date', 'create_date', 'update_date', 'fetched_at',
})


def _translate_row(raw: dict, field_map: dict) -> dict:
    """Translate a row from VCI field codes to English column names."""
    result = {}
    for vci_code, en_name in field_map.items():
        val = raw.get(vci_code)
        if val is not None:
            try:
                result[en_name] = float(val)
            except (ValueError, TypeError):
                result[en_name] = None
        else:
            result[en_name] = None
    return result


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
    """Return income statement rows with English column names.

    Returns list of dicts with keys: year, quarter, + English column names
    from _INCOME_MAP. Sorted by year DESC, quarter DESC.
    """
    db_path = _get_db_path()
    if not db_path:
        return []

    symbol = symbol.upper()
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row

        cols_sql = ', '.join(_INCOME_COLS_NEEDED)
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
            out.update(_translate_row(rd, _INCOME_MAP))
            result.append(out)
        return result
    except Exception as exc:
        logger.debug(f"VCI income_statement read failed for {symbol}: {exc}")
        return []


def get_cash_flow_statement(
    symbol: str,
    limit: int = 20,
) -> list[dict]:
    """Return cash flow statement rows with English column names."""
    db_path = _get_db_path()
    if not db_path:
        return []

    symbol = symbol.upper()
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row

        cols_sql = ', '.join(_CASH_FLOW_COLS_NEEDED)

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
            out.update(_translate_row(rd, _CASH_FLOW_MAP))
            result.append(out)
        return result
    except Exception as exc:
        logger.debug(f"VCI cash_flow_statement read failed for {symbol}: {exc}")
        return []


# ── Convenience functions matching valuation_service.py query patterns ──


def load_eps_history_yearly(symbol: str, limit: int = 10) -> list[dict]:
    """EPS history from annual income statements (isa23 = EPS basic).

    Returns same shape as _load_eps_history_yearly() from valuation_service.py:
        [{'year': 2023, 'eps': 12345.0}, ...]
    """
    rows = get_income_statement(symbol, annual_only=True, limit=limit)
    cleaned = []
    for r in rows:
        eps = r.get('eps')
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
    """Return (net_income, source) — same shape as valuation_service version.

    Priority: net_profit_parent_company (isa22) → net_profit (isa20)
    """
    rows = get_income_statement(symbol, annual_only=False, limit=20)
    # First try net_profit_parent_company (isa22)
    for r in rows:
        val = r.get('net_profit_parent_company')
        if val is not None and float(val) > 0:
            return float(val), 'vci_fs.income_statement.net_profit_parent_company'
    # Fallback to net_profit (isa20)
    for r in rows:
        val = r.get('net_profit')
        if val is not None and float(val) > 0:
            return float(val), 'vci_fs.income_statement.net_profit'
    return 0.0, 'missing'


def load_latest_financial_components(symbol: str) -> dict:
    """Return income + cash flow components needed for FCFE calculation.

    Returns same shape as _load_latest_financial_components() from valuation_service.py.
    Includes both detailed column names (depreciation_fixed_assets) and aliases
    expected by valuation_service (depreciation, delta_working_capital, etc.).
    """
    db_path = _get_db_path()
    result = {
        'net_income': 0.0,
        'period_year': None,
        'period_quarter': None,
        'financial_expense': 0.0,
        'depreciation_fixed_assets': 0.0,
        'depreciation': 0.0,
        'increase_decrease_receivables': 0.0,
        'increase_decrease_inventory': 0.0,
        'increase_decrease_payables': 0.0,
        'purchase_purchase_fixed_assets': 0.0,
        'proceeds_from_disposal_fixed_assets': 0.0,
        'proceeds_disposal_fixed_assets': 0.0,
        'proceeds_from_borrowings': 0.0,
        'proceeds_borrowings': 0.0,
        'repayments_of_borrowings': 0.0,
        'repayments_borrowings': 0.0,
        'delta_receivables': 0.0,
        'delta_inventory': 0.0,
        'delta_payables': 0.0,
        'delta_working_capital': 0.0,
        'purchase_fixed_assets_raw': 0.0,
        'capex_purchase_outflow': 0.0,
        'capex_net': 0.0,
        'net_borrowing': 0.0,
        'source': 'vci_fs.income_statement + cash_flow (latest period)',
    }

    # Income statement
    income_rows = get_income_statement(symbol, annual_only=False, limit=20)
    if income_rows:
        r = income_rows[0]
        result['net_income'] = (
            float(r.get('net_profit_parent_company') or 0.0) or
            float(r.get('net_profit') or 0.0)
        )
        result['period_year'] = r.get('year')
        result['period_quarter'] = r.get('quarter')
        result['financial_expense'] = float(r.get('financial_expense') or 0.0)

    # Cash flow statement
    cf_rows = get_cash_flow_statement(symbol, limit=20)
    if cf_rows:
        r = cf_rows[0]
        dep = float(r.get('depreciation_fixed_assets') or 0.0)
        dr = float(r.get('increase_decrease_receivables') or 0.0)
        di = float(r.get('increase_decrease_inventory') or 0.0)
        dp = float(r.get('increase_decrease_payables') or 0.0)
        pfa = float(r.get('purchase_purchase_fixed_assets') or 0.0)
        pdfa = float(r.get('proceeds_from_disposal_fixed_assets') or 0.0)
        pb = float(r.get('proceeds_from_borrowings') or 0.0)
        rb = float(r.get('repayments_of_borrowings') or 0.0)

        result['depreciation_fixed_assets'] = dep
        result['depreciation'] = dep  # alias
        result['increase_decrease_receivables'] = dr
        result['increase_decrease_inventory'] = di
        result['increase_decrease_payables'] = dp
        result['purchase_purchase_fixed_assets'] = pfa
        result['proceeds_from_disposal_fixed_assets'] = pdfa
        result['proceeds_disposal_fixed_assets'] = pdfa  # alias for valuation_service
        result['proceeds_from_borrowings'] = pb
        result['proceeds_borrowings'] = pb  # alias for valuation_service
        result['repayments_of_borrowings'] = rb
        result['repayments_borrowings'] = rb  # alias for valuation_service

        # Aliases for valuation_service
        result['delta_receivables'] = dr
        result['delta_inventory'] = di
        result['delta_payables'] = dp
        result['delta_working_capital'] = dr + di - dp
        result['purchase_fixed_assets_raw'] = pfa
        capex_out = abs(pfa)
        result['capex_purchase_outflow'] = capex_out
        result['capex_net'] = max(0.0, capex_out - max(0.0, abs(pdfa)))
        result['net_borrowing'] = pb + rb

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
