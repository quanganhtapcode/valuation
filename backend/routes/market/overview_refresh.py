from __future__ import annotations

import logging
import os
import time
from typing import Any


from flask import Blueprint, jsonify, request

from backend.data_sources.vci import VCIClient
from backend.services.news_service import NewsService
from backend.services.vci_news_sqlite import default_news_db_path, query_market_news

from .valuation_chart import fetch_vci_index_valuation_payload
from .deps import cache_func
from .heatmap import fetch_heatmap as _fetch_heatmap


logger = logging.getLogger(__name__)

_PRICE_SYNC_SECONDS = max(1, int(os.getenv("OVERVIEW_PRICE_SYNC_SECONDS", "3")))
_HEATMAP_CACHE_SECONDS = _PRICE_SYNC_SECONDS
_NEWS_CACHE_SECONDS = max(5, int(os.getenv("OVERVIEW_NEWS_CACHE_SECONDS", "30")))
_PE_CACHE_SECONDS = max(30, int(os.getenv("OVERVIEW_PE_CACHE_SECONDS", "300")))

def _fetch_watchlist_prices(symbols: list[str]) -> dict[str, dict[str, float]]:
    if not symbols:
        return {}

    VCIClient.ensure_background_refresh()
    price_cache = VCIClient.get_all_prices() or {}

    out: dict[str, dict[str, float]] = {}
    for sym in symbols:
        item = price_cache.get(sym)
        if not item:
            continue

        price = float(item.get("c") or item.get("ref") or 0)
        ref = float(item.get("ref") or 0)
        change = round(price - ref, 2) if ref > 0 else 0.0
        change_percent = round((change / ref) * 100, 4) if ref > 0 else 0.0

        out[sym] = {
            "price": price,
            "refPrice": ref,
            "change": change,
            "changePercent": change_percent,
            "volume": float(item.get("vo") or 0),
        }

    return out


def _fetch_pe_chart(time_frame: str = "6M") -> dict[str, Any]:
    return fetch_vci_index_valuation_payload(metric="both", com_group_code="VNINDEX", time_frame=time_frame)


def _fetch_news(news_size: int) -> list[dict[str, Any]]:
    try:
        news_db = default_news_db_path()
        if os.path.exists(news_db):
            cached_news = query_market_news(news_db, page=1, page_size=news_size)
            if isinstance(cached_news, list):
                return cached_news
    except Exception as exc:
        logger.warning(f"overview-refresh sqlite news read failed: {exc}")

    try:
        data = NewsService.fetch_news(ticker="", page=1, page_size=news_size)
        if isinstance(data, list):
            return data
    except Exception as exc:
        logger.error(f"overview-refresh upstream news fetch failed: {exc}")

    return []


def register(market_bp: Blueprint) -> None:
    @market_bp.route("/overview-refresh", methods=["GET"])
    def api_overview_refresh():
        symbols_raw = request.args.get("symbols", "")
        symbols = [
            token.strip().upper()
            for token in symbols_raw.split(",")
            if token and token.strip()
        ]
        symbols = symbols[:50]

        try:
            news_size = int(request.args.get("news_size", "30"))
        except Exception:
            news_size = 30
        news_size = max(1, min(news_size, 50))

        try:
            heatmap_limit = int(request.args.get("heatmap_limit", "200"))
        except Exception:
            heatmap_limit = 200
        heatmap_limit = max(50, min(heatmap_limit, 300))

        exchange = (request.args.get("heatmap_exchange", "HSX") or "HSX").upper()
        pe_time_frame = (request.args.get("pe_time_frame", "6M") or "6M").upper()

        prices = _fetch_watchlist_prices(symbols)

        pe_chart, _ = cache_func()(
            f"overview_refresh_pe_chart_{pe_time_frame}",
            _PE_CACHE_SECONDS,
            lambda: _fetch_pe_chart(pe_time_frame),
        )

        news, _ = cache_func()(
            f"overview_refresh_news_{news_size}",
            _NEWS_CACHE_SECONDS,
            lambda: _fetch_news(news_size),
        )

        heatmap, _ = cache_func()(
            f"overview_refresh_heatmap_{exchange}_{heatmap_limit}",
            _HEATMAP_CACHE_SECONDS,
            lambda: _fetch_heatmap(exchange, heatmap_limit),
        )

        return jsonify(
            {
                "success": True,
                "serverTs": time.time(),
                "watchlistPrices": prices,
                "peChart": pe_chart,
                "indexValuationChart": pe_chart,
                "news": news,
                "heatmap": heatmap,
            }
        )
