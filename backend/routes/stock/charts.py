from __future__ import annotations

import logging
import os
import sqlite3

import pandas as pd
from flask import Blueprint, jsonify, request

from backend.db_path import resolve_vci_stats_financial_db_path
from backend.utils import validate_stock_symbol
from backend.cache_utils import cache_get, cache_set


logger = logging.getLogger(__name__)


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/historical-chart-data/<symbol>")
    @stock_bp.route("/stock/<symbol>/historical-chart-data")
    def api_historical_chart_data(symbol):
        """Historical financial ratios from VCI sources.

        Uses vci_stats_financial_history for PE, PB, ROE, ROA, margins.
        Falls back to stocks_optimized.db financial_ratios if VCI data unavailable.
        """
        try:
            is_valid, result = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"error": result}), 400
            symbol = result

            period = request.args.get("period", "quarter")
            cache_key = f"hist_chart_{symbol}_{period}"
            cached = cache_get(cache_key)
            if cached:
                return jsonify(cached)

            # Primary: VCI stats_financial_history
            db_path = resolve_vci_stats_financial_db_path()
            records = _query_vci_history(db_path, symbol, period)

            # Fallback: stocks_optimized.db financial_ratios
            if not records:
                from backend.db_path import resolve_stocks_db_path
                fallback_path = resolve_stocks_db_path()
                records = _query_legacy_ratios(fallback_path, symbol, period)

            if not records:
                return jsonify({"success": False, "message": "No data available"}), 404

            result = {
                "success": True,
                "symbol": symbol,
                "period": period,
                "count": len(records),
                "data": records,
            }
            cache_set(cache_key, result)
            return jsonify(result)

        except Exception as exc:
            logger.error(f"API /historical-chart-data error {symbol}: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500


def _query_vci_history(db_path: str, symbol: str, period: str) -> list[dict]:
    """Query historical ratios from vci_stats_financial_history."""
    if not db_path or not os.path.exists(db_path):
        return []

    try:
        with sqlite3.connect(db_path) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='stats_financial_history'")
            if not cur.fetchone():
                return []

            if period == "quarter":
                query = """
                    SELECT year_report as year, quarter_report as quarter,
                           pe, pb, roe, roa, after_tax_margin, net_interest_margin
                    FROM stats_financial_history
                    WHERE ticker = ?
                    ORDER BY year_report ASC, quarter_report ASC
                """
                rows = cur.execute(query, (symbol,)).fetchall()
            else:
                # Yearly: aggregate quarterly data
                query = """
                    SELECT year_report as year,
                           AVG(pe) as pe, AVG(pb) as pb,
                           AVG(roe) as roe, AVG(roa) as roa,
                           AVG(after_tax_margin) as net_margin,
                           AVG(net_interest_margin) as nim
                    FROM stats_financial_history
                    WHERE ticker = ?
                    GROUP BY year_report
                    ORDER BY year_report ASC
                """
                rows = cur.execute(query, (symbol,)).fetchall()

            if not rows:
                return []

            records = []
            for r in rows:
                d = dict(r)
                y = d.get("year")
                q = d.get("quarter")
                label = str(int(y)) if y else "Unknown"
                if period == "quarter" and q is not None:
                    label = f"Q{int(q)} '{str(y)[-2:]}"

                roe = d.get("roe")
                roa = d.get("roa")
                net_margin = d.get("after_tax_margin") or d.get("net_margin")
                nim = d.get("net_interest_margin") or d.get("nim")

                records.append({
                    "period": label,
                    "roe": round(roe * 100, 2) if roe and abs(roe) < 1 else roe,
                    "roa": round(roa * 100, 2) if roa and abs(roa) < 1 else roa,
                    "pe": d.get("pe"),
                    "pb": d.get("pb"),
                    "currentRatio": None,
                    "quickRatio": None,
                    "cashRatio": None,
                    "nim": round(nim * 100, 2) if nim and abs(nim) < 1 else nim,
                    "netMargin": round(net_margin * 100, 2) if net_margin and abs(net_margin) < 1 else net_margin,
                })

            return records

    except Exception as e:
        logger.warning(f"VCI history query failed for {symbol}: {e}")
        return []


def _query_legacy_ratios(db_path: str, symbol: str, period: str) -> list[dict]:
    """Fallback: query financial_ratios from stocks_optimized.db."""
    if not db_path or not os.path.exists(db_path):
        return []

    try:
        with sqlite3.connect(db_path) as conn:
            cur = conn.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='financial_ratios'")
            if not cur.fetchone():
                return []

            if period == "quarter":
                query = """
                    SELECT year, quarter,
                           roe, roa, price_to_earnings as pe, price_to_book as pb,
                           current_ratio, quick_ratio, cash_ratio,
                           net_profit_margin, ebit_margin as nim
                    FROM financial_ratios
                    WHERE symbol = ? AND quarter IS NOT NULL
                    ORDER BY year ASC, quarter ASC
                """
            else:
                query = """
                    SELECT year,
                           AVG(roe) as roe, AVG(roa) as roa,
                           AVG(price_to_earnings) as pe, AVG(price_to_book) as pb,
                           AVG(current_ratio) as current_ratio,
                           AVG(quick_ratio) as quick_ratio,
                           AVG(cash_ratio) as cash_ratio,
                           AVG(net_profit_margin) as net_profit_margin,
                           AVG(ebit_margin) as nim
                    FROM financial_ratios
                    WHERE symbol = ? AND (quarter IS NULL OR quarter = 0)
                    GROUP BY year
                    ORDER BY year ASC
                """

            df = pd.read_sql_query(query, conn, params=(symbol,))
            if df.empty:
                return []

            records = []
            for _, row in df.iterrows():
                y = row.get("year")
                q = row.get("quarter")
                label = str(int(y)) if y is not None else "Unknown"
                if period == "quarter" and q is not None:
                    label = f"Q{int(q)} '{str(y)[-2:]}"

                records.append({
                    "period": label,
                    "roe": round(row.get("roe") * 100, 2) if row.get("roe") is not None and abs(row.get("roe", 0)) < 1 else row.get("roe"),
                    "roa": round(row.get("roa") * 100, 2) if row.get("roa") is not None and abs(row.get("roa", 0)) < 1 else row.get("roa"),
                    "pe": row.get("pe") if pd.notna(row.get("pe")) else None,
                    "pb": row.get("pb") if pd.notna(row.get("pb")) else None,
                    "currentRatio": row.get("current_ratio") if pd.notna(row.get("current_ratio")) else None,
                    "quickRatio": row.get("quick_ratio") if pd.notna(row.get("quick_ratio")) else None,
                    "cashRatio": row.get("cash_ratio") if pd.notna(row.get("cash_ratio")) else None,
                    "nim": round(row.get("nim") * 100, 2) if row.get("nim") is not None and abs(row.get("nim", 0)) < 1 else row.get("nim"),
                    "netMargin": round(row.get("net_profit_margin") * 100, 2) if row.get("net_profit_margin") is not None and abs(row.get("net_profit_margin", 0)) < 1 else row.get("net_profit_margin"),
                })

            return records

    except Exception as e:
        logger.warning(f"Legacy ratios query failed for {symbol}: {e}")
        return []
