from __future__ import annotations

import logging
from typing import Any

import requests as http_requests
from flask import Blueprint, jsonify, request

from .deps import cache_func, cache_ttl
from .http_headers import VCI_HEADERS


logger = logging.getLogger(__name__)

_VCI_FOREIGN_NET_URL = (
    "https://trading.vietcap.com.vn/api/market-watch/v3/ForeignNetValue/top"
)
_VCI_FOREIGN_VOLUME_URL = (
    "https://trading.vietcap.com.vn/api/market-watch/v3/ForeignVolumeChart/getAll"
)


def _normalize_to_mover(item: dict[str, Any], *, is_buy: bool) -> dict[str, Any]:
    """Map a VCI ForeignNetValue item to the TopMoverItem shape the frontend expects."""
    # VCI field names — handle camelCase variants
    symbol = item.get("ticker") or item.get("symbol") or item.get("code") or ""
    name = item.get("companyName") or item.get("name") or item.get("stockName") or symbol
    price = float(item.get("price") or item.get("closePrice") or item.get("matchPrice") or 0)
    change_pct = float(
        item.get("changePercent") or item.get("changePct") or item.get("percentChange") or 0
    )
    # net buy value — positive for buy, flip sign for sell list
    net_value = float(
        item.get("netBuyValue") or item.get("netValue") or item.get("netBuySellValue") or 0
    )
    return {
        "Symbol": symbol.upper(),
        "CompanyName": name,
        "CurrentPrice": price,
        "ChangePricePercent": change_pct,
        "Exchange": item.get("exchange") or item.get("floorCode") or "HOSE",
        "Value": abs(net_value),
    }


def _fetch_foreign_net_raw() -> dict[str, Any]:
    r = http_requests.get(_VCI_FOREIGN_NET_URL, timeout=10, headers=VCI_HEADERS)
    r.raise_for_status()
    return r.json()


def _split_buy_sell(raw: Any) -> tuple[list[dict], list[dict]]:
    """
    Try every plausible shape VCI might return:
      { data: { BuyList: [...], SellList: [...] } }
      { data: { buyList: [...], sellList: [...] } }
      { data: [ { type: 'buy'|'sell', ... } ] }
      { BuyList: [...], SellList: [...] }
    """
    if not isinstance(raw, dict):
        return [], []

    data = raw.get("data") or raw

    if isinstance(data, dict):
        buy = data.get("BuyList") or data.get("buyList") or []
        sell = data.get("SellList") or data.get("sellList") or []
        if buy or sell:
            return buy, sell

    # flat list — split by net value sign
    items = data if isinstance(data, list) else []
    buy, sell = [], []
    for item in items:
        net = float(item.get("netBuyValue") or item.get("netValue") or item.get("netBuySellValue") or 0)
        if net >= 0:
            buy.append(item)
        else:
            sell.append(item)
    return buy, sell


def register(market_bp: Blueprint) -> None:

    # -----------------------------------------------------------------------
    # /foreign-flow?type=buy|sell  (backwards-compatible for sidebar)
    # Returns TopMoverItem[] so OverviewClient / MarketPulse need no changes.
    # -----------------------------------------------------------------------
    @market_bp.route("/foreign-flow")
    def api_market_foreign_flow():
        flow_type = request.args.get("type", "buy")
        cache_key = f"foreign_net_vci_{flow_type}"

        def fetch():
            raw = _fetch_foreign_net_raw()
            buy_raw, sell_raw = _split_buy_sell(raw)
            items = buy_raw if flow_type == "buy" else sell_raw
            is_buy = flow_type == "buy"
            normalized = [_normalize_to_mover(i, is_buy=is_buy) for i in items[:10]]
            return {"Data": normalized, "Success": True}

        try:
            data, is_cached = cache_func()(cache_key, cache_ttl().get("realtime", 45), fetch)
            resp = jsonify(data)
            resp.headers["X-Cache"] = "HIT" if is_cached else "MISS"
            return resp
        except Exception as exc:
            logger.error("Foreign flow proxy error: %s", exc)
            return jsonify({"Data": [], "Success": False})

    # -----------------------------------------------------------------------
    # /foreign-net-value  (full buy+sell lists for the /foreign page)
    # -----------------------------------------------------------------------
    @market_bp.route("/foreign-net-value")
    def api_market_foreign_net_value():
        def fetch():
            raw = _fetch_foreign_net_raw()
            buy_raw, sell_raw = _split_buy_sell(raw)
            return {
                "success": True,
                "buyList": [_normalize_to_mover(i, is_buy=True)  for i in buy_raw],
                "sellList": [_normalize_to_mover(i, is_buy=False) for i in sell_raw],
            }

        try:
            data, is_cached = cache_func()("foreign_net_value_full", cache_ttl().get("realtime", 45), fetch)
            resp = jsonify(data)
            resp.headers["X-Cache"] = "HIT" if is_cached else "MISS"
            return resp
        except Exception as exc:
            logger.error("Foreign net value error: %s", exc)
            return jsonify({"success": False, "buyList": [], "sellList": []})

    # -----------------------------------------------------------------------
    # /foreign-volume-chart  (minute-by-minute data for intraday charts)
    # Returns raw VCI rows — frontend accumulates and renders 9:00–15:00.
    # -----------------------------------------------------------------------
    @market_bp.route("/foreign-volume-chart")
    def api_market_foreign_volume_chart():
        def fetch():
            r = http_requests.get(_VCI_FOREIGN_VOLUME_URL, timeout=10, headers=VCI_HEADERS)
            r.raise_for_status()
            raw = r.json()
            # Unwrap common VCI envelopes
            points = (
                (raw or {}).get("data")
                or (raw or {}).get("Data")
                or (raw if isinstance(raw, list) else [])
            )
            if not isinstance(points, list):
                points = []
            return {"success": True, "data": points}

        try:
            data, is_cached = cache_func()(
                "foreign_volume_chart", cache_ttl().get("realtime", 45), fetch
            )
            resp = jsonify(data)
            resp.headers["X-Cache"] = "HIT" if is_cached else "MISS"
            return resp
        except Exception as exc:
            logger.error("Foreign volume chart error: %s", exc)
            return jsonify({"success": False, "data": []})
