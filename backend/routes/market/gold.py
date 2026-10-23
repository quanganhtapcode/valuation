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
        response.headers["Cache-Control"] = "no-store"
        return response
