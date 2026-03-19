from __future__ import annotations

from flask import Blueprint, jsonify, request

from backend.data_sources.vci import VCIClient


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
            price = float(item.get("c") or item.get("ref") or 0)
            ref = float(item.get("ref") or 0)
            change = round(price - ref, 2) if ref > 0 else 0
            change_pct = round((change / ref) * 100, 2) if ref > 0 else 0
            result[sym] = {"price": price, "change": change, "changePercent": change_pct}

        return jsonify(result)
