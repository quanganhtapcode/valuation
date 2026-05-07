from __future__ import annotations

import logging
import os

from flask import Blueprint, jsonify, request

from backend.routes.handlers.vci_top_movers import top_movers_from_screener_sqlite

from .deps import cache_func
from .paths import screener_db_path


logger = logging.getLogger(__name__)
_TOP_MOVERS_CACHE_SECONDS = max(1, int(os.getenv("TOP_MOVERS_CACHE_SECONDS", "30")))


def register(market_bp: Blueprint) -> None:
    @market_bp.route("/top-movers")
    def api_market_top_movers():
        move_type = request.args.get("type", "UP")
        cache_key = f"top_movers_vci_hsx_{move_type}_sqlite"

        def fetch_top_movers():
            return top_movers_from_screener_sqlite(db_path=screener_db_path(), move_type=move_type, exchange="HSX", limit=10)

        try:
            data, is_cached = cache_func()(cache_key, _TOP_MOVERS_CACHE_SECONDS, fetch_top_movers)
            resp = jsonify(data)
            resp.headers["X-Cache"] = "HIT" if is_cached else "MISS"
            resp.headers["X-Source"] = "VCI_SQLITE"
            resp.headers["X-DB"] = "fetch_sqlite/vci_screening.sqlite"
            return resp
        except Exception as e:
            logger.error(f"Top movers proxy error: {e}")
            return jsonify({"Data": [], "Success": False})
