from __future__ import annotations

import logging
import os
import sqlite3
import time
from typing import Any

from flask import Blueprint, jsonify, request

from backend.data_sources.vci import VCIClient
from backend.services.news_service import NewsService
from backend.services.vci_news_sqlite import default_news_db_path, query_market_news

from .valuation_chart import fetch_vci_index_valuation_payload
from .deps import cache_func
from .paths import screener_db_path


logger = logging.getLogger(__name__)

_PRICE_SYNC_SECONDS = max(1, int(os.getenv("OVERVIEW_PRICE_SYNC_SECONDS", "3")))
_HEATMAP_CACHE_SECONDS = _PRICE_SYNC_SECONDS
_NEWS_CACHE_SECONDS = max(5, int(os.getenv("OVERVIEW_NEWS_CACHE_SECONDS", "30")))
_PE_CACHE_SECONDS = max(30, int(os.getenv("OVERVIEW_PE_CACHE_SECONDS", "300")))

_SECTOR_SHORTNAMES: dict[str, str] = {
    "Ngân hàng": "Ngân hàng",
    "Bất động sản": "BĐS",
    "Thực phẩm và đồ uống": "Thực phẩm",
    "Dịch vụ tài chính": "Tài chính",
    "Điện, nước & xăng dầu khí đốt": "Điện & NL",
    "Du lịch và Giải trí": "Du lịch",
    "Dầu khí": "Dầu khí",
    "Hóa chất": "Hóa chất",
    "Tài nguyên Cơ bản": "Tài nguyên",
    "Hàng & Dịch vụ Công nghiệp": "Công nghiệp",
    "Xây dựng và Vật liệu": "Xây dựng",
    "Bán lẻ": "Bán lẻ",
    "Công nghệ Thông tin": "CNTT",
    "Bảo hiểm": "Bảo hiểm",
    "Hàng cá nhân & Gia dụng": "Tiêu dùng",
    "Viễn thông": "Viễn thông",
    "Y tế": "Y tế",
    "Tiện ích cộng đồng": "Tiện ích",
}


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


def _fetch_pe_chart() -> dict[str, Any]:
    return fetch_vci_index_valuation_payload(metric="both", com_group_code="VNINDEX", time_frame="ALL")


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


def _fetch_heatmap(exchange: str, limit: int) -> dict[str, Any]:
    db = screener_db_path()
    if not db or not os.path.exists(db):
        return {"sectors": []}

    with sqlite3.connect(db) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT ticker, viSector, marketCap, dailyPriceChangePercent, marketPrice "
            "FROM screening_data "
            "WHERE exchange = ? AND marketCap > 0 AND viSector IS NOT NULL "
            "ORDER BY marketCap DESC LIMIT ?",
            (exchange, limit),
        ).fetchall()

    VCIClient.ensure_background_refresh()
    realtime_cache = VCIClient.get_all_prices() or {}

    sector_map: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        ticker = str(row["ticker"] or "").upper()
        if not ticker:
            continue

        sector = row["viSector"] or "Khác"
        rt_item = realtime_cache.get(ticker, {})

        price = float(rt_item.get("c") or row["marketPrice"] or 0)
        ref = rt_item.get("ref")
        if ref and float(ref) > 0:
            change = round((price - float(ref)) / float(ref) * 100, 4)
        else:
            change = round(float(row["dailyPriceChangePercent"] or 0), 4)

        sector_map.setdefault(sector, []).append(
            {
                "ticker": ticker,
                "cap": float(row["marketCap"] or 0),
                "change": change,
                "price": price,
            }
        )

    sectors: list[dict[str, Any]] = []
    for name, stocks in sector_map.items():
        total_cap = sum(s["cap"] for s in stocks)
        avg_change = (
            sum(s["change"] * s["cap"] for s in stocks) / total_cap if total_cap > 0 else 0.0
        )
        sectors.append(
            {
                "name": name,
                "shortName": _SECTOR_SHORTNAMES.get(name, name[:6]),
                "totalCap": total_cap,
                "avgChange": round(avg_change, 4),
                "stocks": sorted(stocks, key=lambda x: x["cap"], reverse=True),
            }
        )

    sectors.sort(key=lambda x: x["totalCap"], reverse=True)
    return {"sectors": sectors}


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

        prices = _fetch_watchlist_prices(symbols)

        pe_chart, _ = cache_func()(
            "overview_refresh_pe_chart",
            _PE_CACHE_SECONDS,
            _fetch_pe_chart,
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
