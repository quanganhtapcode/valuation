from __future__ import annotations

import json
import logging
import os
import sqlite3
import statistics

from flask import Blueprint, jsonify

from backend.db_path import resolve_vci_stats_financial_db_path
from backend.extensions import get_provider
from backend.utils import validate_stock_symbol


logger = logging.getLogger(__name__)

_TICKER_DATA_CACHE: dict | None = None


def _load_ticker_data() -> dict[str, dict]:
    """Load ticker_data.json and return a dict keyed by symbol."""
    global _TICKER_DATA_CACHE
    if _TICKER_DATA_CACHE is not None:
        return _TICKER_DATA_CACHE
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    ticker_file = os.path.join(root_dir, "frontend-next", "public", "ticker_data.json")
    if not os.path.exists(ticker_file):
        return {}
    with open(ticker_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    _TICKER_DATA_CACHE = {t["symbol"]: t for t in data.get("tickers", [])}
    return _TICKER_DATA_CACHE


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
        """Get peer stocks with VCI stats financial data (PE, PB, ROE, ROA, EV/EBITDA).

        Uses ticker_data.json for sector grouping, then vci_stats_financial.sqlite for metrics.
        """
        try:
            is_valid, clean_symbol = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"success": False, "error": clean_symbol}), 400

            ticker_map = _load_ticker_data()
            sym_info = ticker_map.get(clean_symbol)
            if not sym_info or not sym_info.get("sector") or sym_info.get("sector") == "Unknown":
                return jsonify({"success": True, "data": [], "medianPe": None, "industry": None})

            sector = sym_info["sector"]

            # Find all tickers in the same sector from ticker_data.json
            peer_tickers = [s for s, info in ticker_map.items() if info.get("sector") == sector]
            ticker_names = {s: ticker_map[s].get("name", s) for s in peer_tickers}

            if not peer_tickers:
                return jsonify({"success": True, "data": [], "medianPe": None, "industry": sector})

            stats_db = resolve_vci_stats_financial_db_path()
            placeholders = ",".join(["?" for _ in peer_tickers])
            with sqlite3.connect(stats_db) as conn:
                conn.row_factory = sqlite3.Row
                cur = conn.cursor()
                cur.execute(
                    f"SELECT ticker, pe, pb, roe, roa, ev_to_ebitda, market_cap"
                    f" FROM stats_financial WHERE ticker IN ({placeholders})",
                    peer_tickers,
                )
                stats_rows = cur.fetchall()

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
                "industry": sector,
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
