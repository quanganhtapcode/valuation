from __future__ import annotations

import json
import logging
import os

from flask import Blueprint, jsonify

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
