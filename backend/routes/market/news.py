from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from backend.services.news_service import NewsService
from backend.services.vci_news_sqlite import default_news_db_path, is_fresh, query_market_news

from .deps import cache_func, cache_ttl


logger = logging.getLogger(__name__)


def register(market_bp: Blueprint) -> None:
    @market_bp.route("/news")
    def api_market_news():
        page_index = request.args.get("page", "1")
        page_size = request.args.get("size", "12")
        try:
            page_size = str(min(int(page_size), 50))
        except ValueError:
            page_size = "12"

        try:
            news_db = default_news_db_path()
            if is_fresh(news_db, max_age_seconds=cache_ttl().get("news", 300) if cache_ttl() else 300):
                data = query_market_news(news_db, page=int(page_index), page_size=int(page_size))
                resp = jsonify({"data": data})
                resp.headers["X-Cache"] = "SQLITE"
                return resp
        except Exception as e:
            logger.warning(f"SQLite news read failed; falling back to upstream: {e}")

        cache_key = f"news_vci_ai_upstream_{page_index}_{page_size}"

        def fetch_news():
            return NewsService.fetch_news(ticker="", page=int(page_index), page_size=int(page_size))

        try:
            data, is_cached = cache_func()(cache_key, cache_ttl().get("news", 300), fetch_news)
            resp = jsonify({"data": data} if isinstance(data, list) else data)
            resp.headers["X-Cache"] = "HIT" if is_cached else "MISS"
            return resp
        except Exception as e:
            logger.error(f"News proxy error: {e}")
            return jsonify([])
