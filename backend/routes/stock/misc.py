from __future__ import annotations

import json
import logging
import os
import sqlite3
import statistics

from flask import Blueprint, jsonify

from backend.db_path import resolve_vci_company_db_path, resolve_vci_stats_financial_db_path
from backend.extensions import get_provider
from backend.utils import validate_stock_symbol


logger = logging.getLogger(__name__)


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/stock/peers/<symbol>")
    def api_stock_peers(symbol):
        """Get peer stocks for industry comparison."""
        try:
            is_valid, clean_symbol = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"success": False, "error": clean_symbol}), 400
            provider = get_provider()
            peers = provider.get_stock_peers(clean_symbol)
            return jsonify({"success": True, "data": peers})
        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 500

    @stock_bp.route("/stock/peers-vci/<symbol>")
    def api_stock_peers_vci(symbol):
        """Get peer stocks with VCI stats financial data (PE, PB, ROE, ROA, EV/EBITDA)."""
        try:
            is_valid, clean_symbol = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"success": False, "error": clean_symbol}), 400

            company_db = resolve_vci_company_db_path()
            stats_db = resolve_vci_stats_financial_db_path()

            # Get industry code for this symbol
            with sqlite3.connect(company_db) as conn:
                conn.row_factory = sqlite3.Row
                cur = conn.cursor()
                cur.execute(
                    "SELECT icb_code3, icb_name3 FROM companies WHERE ticker=?",
                    (clean_symbol,),
                )
                sym_row = cur.fetchone()
                if not sym_row or not sym_row["icb_code3"]:
                    return jsonify({"success": True, "data": [], "medianPe": None, "industry": None})

                icb_code3 = sym_row["icb_code3"]
                industry_name = sym_row["icb_name3"]

                # Get all peers in the same industry
                cur.execute(
                    "SELECT ticker, organ_name FROM companies WHERE icb_code3=? ORDER BY ticker",
                    (icb_code3,),
                )
                company_rows = cur.fetchall()

            ticker_names = {r["ticker"]: r["organ_name"] for r in company_rows}
            tickers = list(ticker_names.keys())
            if not tickers:
                return jsonify({"success": True, "data": [], "medianPe": None, "industry": industry_name})

            # Get stats financial for all tickers
            placeholders = ",".join(["?" for _ in tickers])
            with sqlite3.connect(stats_db) as conn2:
                conn2.row_factory = sqlite3.Row
                cur2 = conn2.cursor()
                cur2.execute(
                    f"SELECT ticker, pe, pb, roe, roa, ev_to_ebitda, market_cap"
                    f" FROM stats_financial WHERE ticker IN ({placeholders})",
                    tickers,
                )
                stats_rows = cur2.fetchall()

            peers = []
            for r in stats_rows:
                peers.append({
                    "symbol": r["ticker"],
                    "name": ticker_names.get(r["ticker"], r["ticker"]),
                    "pe": r["pe"],
                    "pb": r["pb"],
                    "roe": r["roe"],
                    "roa": r["roa"],
                    "evEbitda": r["ev_to_ebitda"],
                    "marketCap": r["market_cap"],
                    "isCurrent": r["ticker"] == clean_symbol,
                })

            peers.sort(key=lambda x: (x["marketCap"] or 0), reverse=True)

            pe_values = sorted(p["pe"] for p in peers if p["pe"] and p["pe"] > 0)
            median_pe: float | None = None
            if pe_values:
                median_pe = statistics.median(pe_values)

            return jsonify({
                "success": True,
                "data": peers,
                "medianPe": median_pe,
                "industry": industry_name,
                "icbCode": icb_code3,
            })
        except Exception as exc:
            logger.exception("peers-vci error for %s", symbol)
            return jsonify({"success": False, "error": str(exc)}), 500

    @stock_bp.route("/tickers")
    def api_tickers():
        """Serve the latest ticker_data.json content."""
        try:
            root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            ticker_file = os.path.join(root_dir, "frontend-next", "public", "ticker_data.json")
            if not os.path.exists(ticker_file):
                ticker_file = os.path.join(root_dir, "frontend", "ticker_data.json")

            if os.path.exists(ticker_file):
                with open(ticker_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return jsonify(data)

            provider = get_provider()
            conn = provider.db._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT symbol, name, industry, exchange
                FROM company
                ORDER BY symbol
                """
            )
            rows = cursor.fetchall()
            conn.close()

            tickers = [
                {
                    "symbol": row[0],
                    "name": row[1] or row[0],
                    "sector": row[2] or "Unknown",
                    "exchange": row[3] or "Unknown",
                }
                for row in rows
            ]

            from datetime import datetime

            return jsonify(
                {
                    "last_updated": datetime.now().isoformat(),
                    "count": len(tickers),
                    "tickers": tickers,
                    "source": "database",
                }
            )
        except Exception as e:
            return jsonify({"error": str(e)}), 500
