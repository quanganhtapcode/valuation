from __future__ import annotations

from flask import Blueprint, jsonify

from .deps import gold_service


def register(market_bp: Blueprint) -> None:
    @market_bp.route("/gold", methods=["GET"])
    def get_gold_price():
        data = gold_service().snapshot()
        response = jsonify(data)
        if not data.get("success"):
            response.status_code = 503
            response.headers["Retry-After"] = "5"
        response.headers["Cache-Control"] = (
            "public, max-age=0, s-maxage=5, stale-while-revalidate=10"
            if data.get("success") and not data.get("stale") else "no-store"
        )
        return response
