from __future__ import annotations

import logging

from flask import Blueprint, jsonify

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

        response = jsonify(data)
        response.headers["Cache-Control"] = "public, max-age=60, s-maxage=600, stale-while-revalidate=3600"
        response.headers["X-Cache"] = "PERSISTENT"
        return response
