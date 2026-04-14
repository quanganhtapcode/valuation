from __future__ import annotations

import logging
import os
import sqlite3

from flask import Blueprint, jsonify, request

from backend.db_path import resolve_vci_financial_statement_db_path, resolve_vci_company_db_path
from backend.utils import validate_stock_symbol


logger = logging.getLogger(__name__)

# VCI income statement field codes
# Non-bank (isa*): isa1=total revenue, isa20=net profit after tax
# Bank (isb*):     isb25=net interest income, isb31=net profit after tax
# Insurance (isi*): isi1=total revenue, isi19=net profit after tax
# Securities (iss*): iss1=total revenue, iss19=net profit after tax

_NORMAL_FIELDS = {
    "revenue": "isa1",
    "net_profit": "isa20",
}

_BANK_FIELDS = {
    "revenue": "isb25",       # Net interest income
    "net_profit": "isb31",    # Profit after tax
}

_INSURANCE_FIELDS = {
    "revenue": "isi1",
    "net_profit": "isi19",
}

_SECURITIES_FIELDS = {
    "revenue": "iss1",
    "net_profit": "iss19",
}


def _is_bank(symbol: str) -> bool:
    """Check if a symbol is a bank using vci_company.sqlite."""
    db_path = resolve_vci_company_db_path()
    if not db_path or not os.path.exists(db_path):
        return False
    try:
        with sqlite3.connect(db_path) as conn:
            row = conn.execute(
                "SELECT isbank FROM companies WHERE ticker = ?", (symbol,)
            ).fetchone()
            return bool(row and row[0] == 1)
    except Exception:
        return False


def _get_income_data(
    symbol: str, period: str, limit: int = 24
) -> list[dict]:
    """Query income statement from vci_financials.sqlite.

    Automatically detects bank vs non-bank field codes.
    """
    db_path = resolve_vci_financial_statement_db_path()
    if not db_path or not os.path.exists(db_path):
        return []

    try:
        with sqlite3.connect(db_path) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()

            # Check table exists
            cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='income_statement'"
            )
            if not cur.fetchone():
                return []

            # Determine field codes
            is_bank = _is_bank(symbol)
            if is_bank:
                rev_col = _BANK_FIELDS["revenue"]
                profit_col = _BANK_FIELDS["net_profit"]
            else:
                rev_col = _NORMAL_FIELDS["revenue"]
                profit_col = _NORMAL_FIELDS["net_profit"]

            # Build query
            if period == "year":
                # Yearly: aggregate quarterly data by year
                query = f"""
                    SELECT year_report,
                           SUM({rev_col}) AS revenue,
                           SUM({profit_col}) AS net_profit
                    FROM income_statement
                    WHERE ticker = ?
                    GROUP BY year_report
                    ORDER BY year_report DESC
                    LIMIT ?
                """
            else:
                # Quarterly: return individual quarters
                query = f"""
                    SELECT year_report, quarter_report, {rev_col} AS revenue, {profit_col} AS net_profit
                    FROM income_statement
                    WHERE ticker = ?
                    ORDER BY year_report DESC, quarter_report DESC
                    LIMIT ?
                """

            rows = cur.execute(query, (symbol, limit)).fetchall()
            if not rows:
                return []

            periods = []
            for r in rows:
                year = r["year_report"]
                quarter = r.get("quarter_report")  # None for yearly aggregation
                revenue = r["revenue"]
                net_profit = r["net_profit"]

                if revenue is None or revenue == 0:
                    continue

                # Convert to billions VND
                revenue_bn = revenue / 1_000_000_000 if abs(revenue) > 1_000_000 else revenue

                # Calculate net margin
                net_margin = (net_profit / revenue * 100) if net_profit and revenue else None

                q = int(quarter or 0)
                periods.append({
                    "period": str(year) if period == "year" else f"{year} Q{q}",
                    "revenue": round(revenue_bn, 2),
                    "netMargin": round(float(net_margin), 2) if net_margin is not None else 0,
                    "year": int(year),
                    "quarter": q,
                })

            return periods

    except Exception as e:
        logger.warning(f"Failed to fetch income data for {symbol}: {e}")
        return []


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/stock/<symbol>/revenue-profit")
    def api_revenue_profit(symbol):
        """Get Revenue and Net Margin data for Revenue & Profit chart.

        Sources: vci_financials.sqlite (VCI field codes: isa*/isb*/isi*/iss*)
        """
        period = request.args.get("period", "quarter")
        is_valid, result = validate_stock_symbol(symbol)
        if not is_valid:
            return jsonify({"error": result}), 400
        symbol = result

        try:
            periods = _get_income_data(symbol, period)
            periods.sort(key=lambda item: (item["year"], item.get("quarter", 0)))
            return jsonify({"periods": periods})
        except Exception as ex:
            logger.error(f"Error fetching revenue/profit for {symbol}: {ex}")
            return jsonify({"periods": []})
