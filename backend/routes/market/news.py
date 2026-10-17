from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from backend.services.news_service import NewsService
from backend.services.vci_news_sqlite import compact_news_item, default_news_db_path, get_meta_value, is_fresh, query_market_news

from .deps import cache_func, cache_ttl


logger = logging.getLogger(__name__)


def register(market_bp: Blueprint) -> None:
    @market_bp.route("/news")
    def api_market_news():
        compact = request.args.get("compact") == "1"
        try:
            page_index = max(1, int(request.args.get("page", "1")))
            page_size = max(1, min(int(request.args.get("size", "12")), 50))
        except ValueError:
            return jsonify({"success": False, "error": "page and size must be integers"}), 400

        try:
            news_db = default_news_db_path()
            data = query_market_news(news_db, page=page_index, page_size=page_size, compact=compact)
            # An initialized snapshot may legitimately have no rows on this
            # page. Do not turn pagination past the end into an upstream wait.
            if data or get_meta_value(news_db, "last_fetch_utc"):
                resp = jsonify({"success": True, "data": data})
                resp.headers["X-Cache"] = "SQLITE"
                resp.headers["X-News-Stale"] = "0" if is_fresh(
                    news_db,
                    max_age_seconds=cache_ttl().get("news", 300) if cache_ttl() else 300,
                ) else "1"
                return resp
        except Exception as e:
            logger.warning(f"SQLite news read failed; falling back to upstream: {e}")

        cache_key = f"news_vci_ai_upstream_{page_index}_{page_size}_{'compact' if compact else 'full'}"

        def fetch_news():
            return NewsService.fetch_news(ticker="", page=int(page_index), page_size=int(page_size))

        try:
            data, is_cached = cache_func()(cache_key, cache_ttl().get("news", 300), fetch_news)
            if compact and isinstance(data, list):
                data = [compact_news_item(item) for item in data]
            resp = jsonify(
                {"success": True, "data": data}
                if isinstance(data, list)
                else data
            )
            resp.headers["X-Cache"] = "HIT" if is_cached else "MISS"
            return resp
        except Exception as e:
            logger.error(f"News proxy error: {e}")
            return jsonify({"success": False, "data": [], "error": "News unavailable"}), 503
