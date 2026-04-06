from __future__ import annotations

from flask import Blueprint, jsonify, request

from backend.data_sources.vci import VCIClient


def _to_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


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

        symbols_param = request.args.get("symbols", "")
        filter_set = set(s.strip().upper() for s in symbols_param.split(",") if s.strip()) if symbols_param else None

        result = {}
        for sym, item in cache.items():
            if filter_set and sym not in filter_set:
                continue
            price = _to_float(item.get("c") or item.get("ref"))
            ref = _to_float(item.get("ref"))
            change = round(price - ref, 2) if ref > 0 else 0
            change_pct = round((change / ref) * 100, 2) if ref > 0 else 0
            payload = {"price": price, "change": change, "changePercent": change_pct}
            if request.args.get("include_orderbook") in {"1", "true", "yes"}:
                payload["orderbook"] = _build_orderbook(item)
            result[sym] = payload

        return jsonify(result)

    @market_bp.route("/orderbook")
    def api_market_orderbook():
        """Top 3 bid/ask levels for each symbol from VCI RAM cache."""
        VCIClient.ensure_background_refresh()
        cache = VCIClient._price_cache

        symbols_param = request.args.get("symbols", "")
        filter_set = set(s.strip().upper() for s in symbols_param.split(",") if s.strip()) if symbols_param else None

        result = {}
        for sym, item in cache.items():
            if filter_set and sym not in filter_set:
                continue
            result[sym] = {
                "lastPrice": _to_float(item.get("c") or item.get("ref")),
                "matchedVolume": _to_float(item.get("mv")),
                "matchedValue": _to_float(item.get("va")),
                "orderbook": _build_orderbook(item),
            }

        return jsonify(result)
