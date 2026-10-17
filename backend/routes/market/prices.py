from __future__ import annotations

import math

from flask import Blueprint, jsonify, request

from backend.data_sources.vci import VCIClient


def _to_float(value, default=0.0):
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def _selected_quotes(cache):
    """Read requested symbols directly instead of scanning the whole market."""
    symbols = dict.fromkeys(
        symbol.strip().upper()
        for symbol in request.args.get("symbols", "").split(",")
        if symbol.strip()
    )
    if not symbols:
        return cache.items()
    return ((symbol, cache[symbol]) for symbol in symbols if symbol in cache)


def _build_orderbook(item):
    return {
        "bid": [
            {"price": _to_float(item.get("bp1")), "volume": _to_float(item.get("bv1"))},
            {"price": _to_float(item.get("bp2")), "volume": _to_float(item.get("bv2"))},
            {"price": _to_float(item.get("bp3")), "volume": _to_float(item.get("bv3"))},
        ],
        "ask": [
            {"price": _to_float(item.get("ap1")), "volume": _to_float(item.get("av1"))},
            {"price": _to_float(item.get("ap2")), "volume": _to_float(item.get("av2"))},
            {"price": _to_float(item.get("ap3")), "volume": _to_float(item.get("av3"))},
        ],
    }


def register(market_bp: Blueprint) -> None:
    @market_bp.route("/prices")
    def api_market_prices():
        """Bulk price data from VCI RAM cache (background refreshed)."""
        VCIClient.ensure_background_refresh()
        cache = VCIClient._price_cache

        include_orderbook = request.args.get("include_orderbook", "").lower() in {"1", "true", "yes"}
        result = {}
        for sym, item in _selected_quotes(cache):
            price = _to_float(item.get("c") or item.get("ref"))
            ref = _to_float(item.get("ref"))
            change = round(price - ref, 2) if ref > 0 else 0
            change_pct = round((change / ref) * 100, 2) if ref > 0 else 0
            payload = {"price": price, "change": change, "changePercent": change_pct}
            if include_orderbook:
                payload["orderbook"] = _build_orderbook(item)
            result[sym] = payload

        return jsonify(result)

    @market_bp.route("/orderbook")
    def api_market_orderbook():
        """Top 3 bid/ask levels for each symbol from VCI RAM cache."""
        VCIClient.ensure_background_refresh()
        cache = VCIClient._price_cache

        result = {}
        for sym, item in _selected_quotes(cache):
            result[sym] = {
                "lastPrice": _to_float(item.get("c") or item.get("ref")),
                "matchedVolume": _to_float(item.get("mv")),
                "matchedValue": _to_float(item.get("va")),
                "orderbook": _build_orderbook(item),
            }

        return jsonify(result)
