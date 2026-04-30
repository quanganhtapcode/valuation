from __future__ import annotations

import logging
import os

import requests as http_requests
from flask import Blueprint, jsonify, request

from backend.services.vci_standouts_sqlite import default_standouts_db_path, is_fresh as is_standouts_fresh, read_ticker_info
from backend.routes.handlers.vci_top_movers import top_movers_from_screener_sqlite
from backend.routes.handlers.vci_standouts import standouts_join_with_screener, fetch_standouts_upstream

from .deps import cache_func, cache_ttl
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

    @market_bp.route("/standouts")
    def api_market_standouts():
        cache_key = "standouts_vci_hsx_ai_sqlite"

        def fetch_standouts():
            db_path = screener_db_path()

            ticker_info = []
            try:
                standouts_db = default_standouts_db_path()
                if is_standouts_fresh(standouts_db, max_age_seconds=3600):
                    ticker_info = read_ticker_info(standouts_db)
            except Exception as e:
                logger.warning(f"SQLite standouts read failed; falling back to upstream: {e}")

            if not ticker_info:
                ticker_info = fetch_standouts_upstream(http_get=http_requests.get, timeout_s=10)
            if not ticker_info:
                return []

            return standouts_join_with_screener(screener_db_path=db_path, ticker_info=ticker_info, max_positive=5)

        try:
            data, is_cached = cache_func()(cache_key, cache_ttl().get("basic", 300), fetch_standouts)
            resp = jsonify(data)
            resp.headers["X-Cache"] = "HIT" if is_cached else "MISS"
            return resp
        except Exception as e:
            logger.error(f"Standouts proxy error: {e}")
            return jsonify([])
