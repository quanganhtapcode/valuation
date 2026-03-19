from __future__ import annotations

from flask import Blueprint, jsonify

from .deps import cache_func, gold_service


def register(market_bp: Blueprint) -> None:
    @market_bp.route("/gold", methods=["GET"])
    def get_gold_price():
        data, _ = cache_func()("gold_price_btmc", 60, gold_service().fetch_with_retry, should_cache_func=gold_service().validate_response)
        return jsonify(data)
