from __future__ import annotations

import logging
import os
import sqlite3

import pandas as pd
from flask import Blueprint, jsonify, request

from backend.db_path import resolve_vci_ratio_daily_db_path, resolve_vci_stats_financial_db_path
from backend.utils import validate_stock_symbol
from backend.cache_utils import cache_get, cache_set


logger = logging.getLogger(__name__)


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/ratio-daily-history/<symbol>")
    @stock_bp.route("/stock/<symbol>/ratio-daily-history")
    def api_ratio_daily_history(symbol):
        """Recent daily PE/PB TTM history from VCI company-ratio-daily SQLite cache."""
        try:
            is_valid, result = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"error": result}), 400
            symbol = result

            try:
                limit = int(request.args.get("limit", 10))
            except (TypeError, ValueError):
                limit = 10
            limit = max(1, min(limit, 250))

            cache_key = f"ratio_daily_history_{symbol}_{limit}"
            cached = cache_get(cache_key)
            if cached:
                return jsonify(cached)

            db_path = resolve_vci_ratio_daily_db_path()
            records = _query_ratio_daily_history(db_path, symbol, limit)

            if not records:
                return jsonify({"success": False, "message": "No ratio daily history available"}), 404

            result = {
                "success": True,
                "symbol": symbol,
                "period": "daily",
                "source": "vci_ratio_daily.sqlite",
                "count": len(records),
                "data": records,
            }
            cache_set(cache_key, result)
            return jsonify(result)

        except Exception as exc:
            logger.error(f"API /ratio-daily-history error {symbol}: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @stock_bp.route("/historical-chart-data/<symbol>")
    @stock_bp.route("/stock/<symbol>/historical-chart-data")
    def api_historical_chart_data(symbol):
        """Historical financial ratios from VCI stats_financial_history."""
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

            db_path = resolve_vci_stats_financial_db_path()
            records = _query_vci_history(db_path, symbol, period)

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


def _query_ratio_daily_history(db_path: str, symbol: str, limit: int) -> list[dict]:
    """Query recent daily PE/PB TTM rows from vci_ratio_daily.sqlite."""
    if not db_path or not os.path.exists(db_path):
        return []

    try:
        with sqlite3.connect(db_path) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            rows: list[sqlite3.Row] = []

            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ratio_daily_history'")
            if cur.fetchone():
                rows = cur.execute(
                    """
                    SELECT ticker, trading_date, pe, pb, fetched_at
                    FROM ratio_daily_history
                    WHERE UPPER(ticker) = UPPER(?)
                      AND (pe IS NOT NULL OR pb IS NOT NULL)
                    ORDER BY trading_date DESC
                    LIMIT ?
                    """,
                    (symbol, limit),
                ).fetchall()

            if not rows:
                cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ratio_daily'")
                if cur.fetchone():
                    rows = cur.execute(
                        """
                        SELECT ticker, trading_date, pe, pb, fetched_at
                        FROM ratio_daily
                        WHERE UPPER(ticker) = UPPER(?)
                          AND (pe IS NOT NULL OR pb IS NOT NULL)
                        ORDER BY trading_date DESC
                        LIMIT ?
                        """,
                        (symbol, limit),
                    ).fetchall()

            records = []
            for row in reversed(rows):
                trading_date = str(row["trading_date"] or "")[:10]
                if not trading_date:
                    continue
                pe = row["pe"]
                pb = row["pb"]
                records.append({
                    "period": trading_date,
                    "date": trading_date,
                    "pe": round(float(pe), 4) if pe is not None else None,
                    "pb": round(float(pb), 4) if pb is not None else None,
                })

            return records

    except Exception as e:
        logger.warning(f"VCI ratio daily history query failed for {symbol}: {e}")
        return []


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
                # Yearly: average Q1-Q4 only (exclude Q5/TTM to avoid mixing TTM into yearly avg)
                query = """
                    SELECT year_report as year,
                           AVG(pe) as pe, AVG(pb) as pb,
                           AVG(roe) as roe, AVG(roa) as roa,
                           AVG(after_tax_margin) as net_margin,
                           AVG(net_interest_margin) as nim
                    FROM stats_financial_history
                    WHERE ticker = ? AND quarter_report BETWEEN 1 AND 4
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
                    # Quarter 5 is VCI's TTM (trailing twelve months)
                    label = f"TTM '{str(y)[-2:]}" if int(q) == 5 else f"Q{int(q)} '{str(y)[-2:]}"

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

