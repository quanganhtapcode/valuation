from __future__ import annotations

import json
import logging
import os
import sqlite3
from datetime import datetime

from flask import Blueprint, jsonify, request
from vnstock import Vnstock

from backend.extensions import get_provider
from backend.utils import validate_stock_symbol


logger = logging.getLogger(__name__)


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/stock/<symbol>/revenue-profit")
    def api_revenue_profit(symbol):
        """Get Revenue and Net Margin data for Revenue & Profit chart."""
        period = request.args.get("period", "quarter")
        is_valid, result = validate_stock_symbol(symbol)
        if not is_valid:
            return jsonify({"error": result}), 400
        symbol = result

        try:
            provider = get_provider()
            db_path = getattr(provider, "db_path", None)
            if not db_path or not os.path.exists(db_path):
                return jsonify({"periods": [], "error": "Database not found"})

            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='fin_stmt'")
            has_financial_statements = cursor.fetchone() is not None

            rows = []
            if has_financial_statements:
                cursor.execute(
                    """
                    SELECT year, quarter, data
                    FROM fin_stmt
                    WHERE symbol = ?
                      AND report_type = 'income'
                      AND period_type = ?
                    ORDER BY year DESC, quarter DESC
                    LIMIT 24
                    """,
                    (symbol, period),
                )
                rows = cursor.fetchall()
            conn.close()

            revenue_key_hints = ["revenue", "doanh thu", "net sales", "sales"]
            net_profit_key_hints = [
                "attribute to parent company",
                "net profit",
                "net income",
                "lợi nhuận sau thuế",
                "profit after tax",
            ]
            net_margin_key_hints = ["net profit margin", "biên lợi nhuận ròng"]

            def _safe_float(value):
                try:
                    return float(value)
                except Exception:
                    return None

            def _pick_metric(data_dict, hints, reject_tokens=None):
                reject_tokens = reject_tokens or []
                for key, value in data_dict.items():
                    key_lower = str(key).lower()
                    if any(token in key_lower for token in reject_tokens):
                        continue
                    if any(hint in key_lower for hint in hints):
                        val = _safe_float(value)
                        if val is not None:
                            return val
                return None

            periods = []
            for year, quarter, data_json in rows:
                try:
                    data = json.loads(data_json) if data_json else {}
                    revenue = _pick_metric(data, revenue_key_hints, reject_tokens=["yoy", "%", "growth", "margin"])
                    net_profit = _pick_metric(data, net_profit_key_hints, reject_tokens=["yoy", "%", "growth", "margin"])
                    net_margin = _pick_metric(data, net_margin_key_hints)
                    if revenue is None:
                        continue

                    revenue_bn = (revenue / 1_000_000_000) if abs(revenue) > 1_000_000 else revenue
                    if net_margin is None and net_profit is not None and revenue not in (0, None):
                        net_margin = (net_profit / revenue) * 100

                    q = int(quarter or 0)
                    periods.append(
                        {
                            "period": f"{year}" if period == "year" else f"{year} Q{q}",
                            "revenue": round(revenue_bn, 2),
                            "netMargin": round(float(net_margin), 2) if net_margin is not None else 0,
                            "year": int(year),
                            "quarter": q,
                        }
                    )
                except Exception:
                    continue

            if not periods:
                try:
                    stock = Vnstock().stock(symbol=symbol, source="VCI")
                    income_df = stock.finance.income_statement(period=period, lang="en", dropna=True)
                    if income_df is None or income_df.empty:
                        income_df = stock.finance.income_statement(period=period, lang="vn", dropna=True)
                    if income_df is not None and not income_df.empty:
                        year_col = None
                        quarter_col = None
                        for col in income_df.columns:
                            col_text = str(col)
                            if "yearReport" in col_text or col_text.lower() == "year":
                                year_col = col
                            if "lengthReport" in col_text or col_text.lower() == "quarter":
                                quarter_col = col

                        if year_col:
                            sort_cols = [year_col]
                            sort_dirs = [True]
                            if period == "quarter" and quarter_col:
                                sort_cols.append(quarter_col)
                                sort_dirs.append(True)
                            income_df = income_df.sort_values(sort_cols, ascending=sort_dirs)

                        for _, row in income_df.tail(24).iterrows():
                            row_dict = row.to_dict()
                            revenue = _pick_metric(row_dict, revenue_key_hints, reject_tokens=["yoy", "%", "growth", "margin"])
                            net_profit = _pick_metric(row_dict, net_profit_key_hints, reject_tokens=["yoy", "%", "growth", "margin"])
                            net_margin = _pick_metric(row_dict, net_margin_key_hints)
                            if revenue is None:
                                continue

                            revenue_bn = (revenue / 1_000_000_000) if abs(revenue) > 1_000_000 else revenue
                            if net_margin is None and net_profit is not None and revenue not in (0, None):
                                net_margin = (net_profit / revenue) * 100

                            y_raw = row.get(year_col) if year_col is not None else datetime.now().year
                            q_raw = row.get(quarter_col) if quarter_col is not None else 0
                            y = int(_safe_float(y_raw) or datetime.now().year)
                            q = int(_safe_float(q_raw) or 0)

                            periods.append(
                                {
                                    "period": f"{y}" if period == "year" else f"{y} Q{q}",
                                    "revenue": round(revenue_bn, 2),
                                    "netMargin": round(float(net_margin), 2) if net_margin is not None else 0,
                                    "year": y,
                                    "quarter": q,
                                }
                            )
                except Exception as live_exc:
                    logger.warning(f"Revenue live fallback failed for {symbol}: {live_exc}")

            periods.sort(key=lambda item: (item["year"], item.get("quarter", 0)))
            return jsonify({"periods": periods})
        except Exception as ex:
            logger.error(f"Error fetching revenue/profit for {symbol}: {ex}")
            return jsonify({"periods": []})
