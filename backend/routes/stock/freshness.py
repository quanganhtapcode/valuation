"""Freshness metadata for stock data sources."""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime
from flask import Blueprint, jsonify
from backend.db_path import resolve_vci_stats_financial_db_path
from backend.utils import validate_stock_symbol

logger = logging.getLogger(__name__)

def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/stock/<symbol>/freshness")
    def api_stock_freshness(symbol: str):
        """Return data-freshness metadata for a symbol from VCI sources."""
        is_valid, clean_symbol = validate_stock_symbol(symbol)
        if not is_valid:
            return jsonify({"error": clean_symbol}), 400

        try:
            from backend.db_path import resolve_price_history_db_path, resolve_vci_stats_financial_db_path
            freshness: dict = {"symbol": clean_symbol}

            try:
                with sqlite3.connect(resolve_price_history_db_path()) as conn:
                    row = conn.execute(
                        "SELECT MAX(time) FROM stock_price_history WHERE symbol = ?",
                        (clean_symbol,),
                    ).fetchone()
                    freshness["price_latest_date"] = row[0] if row else None
            except Exception:
                pass

            try:
                with sqlite3.connect(resolve_vci_stats_financial_db_path()) as conn:
                    row = conn.execute(
                        "SELECT fetched_at FROM stats_financial WHERE ticker = ? LIMIT 1",
                        (clean_symbol,),
                    ).fetchone()
                    freshness["ratios_updated_at"] = row[0] if row else None
            except Exception:
                pass

            freshness["checked_at"] = datetime.utcnow().isoformat() + "Z"
            return jsonify(freshness)
        except Exception as exc:
            logger.error(f"GET /stock/{clean_symbol}/freshness error: {exc}")
            return jsonify({"error": str(exc)}), 500
