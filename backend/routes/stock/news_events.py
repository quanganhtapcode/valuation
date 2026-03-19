from __future__ import annotations

import logging

from flask import Blueprint, jsonify
from vnstock import Vnstock

from backend.services.news_service import NewsService
from backend.utils import validate_stock_symbol
from backend.services.vci_news_sqlite import query_news_for_symbol, default_news_db_path
from .cache import cache_get, cache_set


logger = logging.getLogger(__name__)


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/news/<symbol>")
    def api_news(symbol):
        """Get news for a symbol (prefer SQLite cache, fallback upstream)."""
        try:
            is_valid, clean_symbol = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"success": False, "error": clean_symbol}), 400

            cache_key = f"news_{clean_symbol}"

            # SQLite cache (VCI AI)
            try:
                items = query_news_for_symbol(default_news_db_path(), clean_symbol, limit=12)
                if items:
                    result = {"success": True, "data": items}
                    cache_set(cache_key, result)
                    return jsonify(result)
            except Exception as e:
                logger.warning(f"SQLite symbol news failed for {clean_symbol}: {e}")

            cached = cache_get(cache_key)
            if cached:
                return jsonify(cached)

            # Upstream fallback (kept for compatibility)
            news_data = NewsService.fetch_news(ticker=clean_symbol, page=1, page_size=12)
            result = {"success": True, "data": news_data}
            cache_set(cache_key, result)
            return jsonify(result)
        except Exception as exc:
            logger.error(f"Error fetching VCI AI news for {symbol}: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @stock_bp.route("/events/<symbol>")
    def api_events(symbol):
        """Get events for a symbol."""
        try:
            cache_key = f"events_{symbol}"
            cached = cache_get(cache_key)
            if cached:
                return jsonify(cached)

            stock = Vnstock().stock(symbol=symbol, source="VCI")
            events_df = stock.company.events()

            result = {"success": True, "data": []}
            if events_df is not None and not getattr(events_df, "empty", True):
                events_data = []
                for _, row in events_df.head(10).iterrows():
                    events_data.append(
                        {
                            "event_name": row.get("event_title", ""),
                            "event_code": row.get("event_list_name", "Event"),
                            "notify_date": str(row.get("public_date", "")).split(" ")[0],
                            "url": row.get("source_url", "#"),
                        }
                    )
                result = {"success": True, "data": events_data}

            cache_set(cache_key, result)
            return jsonify(result)
        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 500
