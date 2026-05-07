from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from backend.services.vci_technical_sqlite import default_technical_db_path, query_technical_snapshot
from backend.utils import validate_stock_symbol


logger = logging.getLogger(__name__)

ALLOWED_TIMEFRAMES = {"ONE_HOUR", "ONE_DAY", "ONE_WEEK"}


def _resolve_timeframe(route_timeframe: str | None) -> str:
    timeframe = (request.args.get("timeframe") or route_timeframe or "ONE_DAY").strip().upper()
    if timeframe not in ALLOWED_TIMEFRAMES:
        raise ValueError(f"Unsupported timeframe: {timeframe}")
    return timeframe


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/stock/<symbol>/technical")
    @stock_bp.route("/stock/<symbol>/technical/<timeframe>")
    def api_stock_technical(symbol: str, timeframe: str | None = None):
        """Return cached Vietcap technical indicators from SQLite."""
        try:
            is_valid, clean_symbol = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"success": False, "error": clean_symbol}), 400

            clean_timeframe = _resolve_timeframe(timeframe)
            db_path = default_technical_db_path()
            snapshot = query_technical_snapshot(db_path, clean_symbol, clean_timeframe)
            if not snapshot:
                return jsonify({
                    "success": False,
                    "error": f"No technical snapshot available for {clean_symbol} {clean_timeframe}",
                    "symbol": clean_symbol,
                    "timeframe": clean_timeframe,
                }), 404

            return jsonify(snapshot)
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400
        except Exception as exc:
            logger.exception("technical route error for %s/%s", symbol, timeframe)
            return jsonify({"success": False, "error": str(exc)}), 500
