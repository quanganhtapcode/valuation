from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from backend.services.market_ai_takeaways import read_market_ai_takeaways

logger = logging.getLogger(__name__)


def register(market_bp: Blueprint) -> None:
    @market_bp.route("/ai-takeaways")
    def api_market_ai_takeaways():
        """Serve a shared background-generated snapshot without invoking an AI provider."""
        data = read_market_ai_takeaways()
        if data is None:
            return jsonify({
                "available": False,
                "error": "AI takeaways are being prepared.",
            }), 503

        if request.args.get("compact") == "1":
            # Preserve the full snapshot contract; cards only need source links
            # and the five selected stories, not all 100 article excerpts.
            source_keys = {"title", "title_en", "title_vi", "url", "source", "published_at", "symbol"}
            news_keys = {"url", "source", "symbol"}
            data = {**{key: value for key, value in data.items() if key != "input_snapshot"},
                    "news_sources": [{key: value for key, value in item.items() if key in source_keys}
                                     for item in data.get("news_sources", [])],
                    "recent_news": [{key: value for key, value in item.items() if key in news_keys}
                                    for item in data.get("recent_news", [])],
                    "movers": [{**item, "news": [{key: value for key, value in article.items() if key in news_keys}
                                                for article in item.get("news", [])]}
                               for item in data.get("movers", [])]}
        response = jsonify(data)
        response.headers["Cache-Control"] = "public, max-age=0, s-maxage=30, stale-while-revalidate=60"
        response.headers["X-Cache"] = "PERSISTENT"
        return response
