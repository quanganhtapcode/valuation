from __future__ import annotations

import logging
import os

from flask import Blueprint, jsonify, request

from backend.routes.handlers.index_history import resolve_index_db_path, read_index_history


logger = logging.getLogger(__name__)


def register(market_bp: Blueprint) -> None:
    @market_bp.route("/index-history")
    def api_market_index_history():
        index = request.args.get("index", "VNINDEX")
        try:
            days = int(request.args.get("days", "30"))
        except ValueError:
            days = 30

        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        db_path = resolve_index_db_path(base_dir=base_dir, index=index)
        if not db_path:
            return jsonify([])

        try:
            data = read_index_history(db_path=db_path, days=days, index=index)
            return jsonify(data)
        except Exception as e:
            logger.error(f"Error reading {index} history: {e}")
            return jsonify({"error": str(e)}), 500
