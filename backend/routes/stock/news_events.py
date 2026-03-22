from __future__ import annotations

import logging
from datetime import date

import requests
from flask import Blueprint, jsonify, request
from vnstock import Vnstock

from backend.services.news_service import NewsService
from backend.utils import validate_stock_symbol
from backend.services.vci_news_sqlite import query_news_for_symbol, default_news_db_path
from backend.routes.market.http_headers import VCI_HEADERS
from .cache import cache_get, cache_set

_VCI_IQ_BASE = "https://iq.vietcap.com.vn/api/iq-insight-service/v1"

_TAB_CONFIG: dict[str, dict] = {
    "news":     {"path": "news",   "extra_params": {"languageId": "1"}},
    "dividend": {"path": "events", "extra_params": {"eventCode": "DIV,ISS"}},
    "insider":  {"path": "events", "extra_params": {"eventCode": "DDIND,DDINS,DDRP"}},
    "agm":      {"path": "events", "extra_params": {"eventCode": "AGME,AGMR,EGME"}},
    "other":    {"path": "events", "extra_params": {"eventCode": "AIS,MA,MOVE,NLIS,OTHE,RETU,SUSP"}},
}


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

    @stock_bp.route("/vci-feed/<symbol>")
    def api_vci_feed(symbol):
        """Proxy VCI IQ news/events API for a given tab type."""
        try:
            is_valid, clean_symbol = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"success": False, "error": clean_symbol}), 400

            tab = (request.args.get("tab") or "news").strip().lower()
            if tab not in _TAB_CONFIG:
                return jsonify({"success": False, "error": f"Unknown tab: {tab}"}), 400

            cache_key = f"vci_feed_{clean_symbol}_{tab}"
            cached = cache_get(cache_key)
            if cached:
                return jsonify(cached)

            cfg = _TAB_CONFIG[tab]
            today = date.today()
            from_date = "20100101"
            to_date = f"{today.year + 1}{today.month:02d}{today.day:02d}"

            params: dict = {
                "ticker": clean_symbol,
                "fromDate": from_date,
                "toDate": to_date,
                "page": "0",
                "size": "50",
                **cfg["extra_params"],
            }

            url = f"{_VCI_IQ_BASE}/{cfg['path']}"
            resp = requests.get(url, params=params, headers=VCI_HEADERS, timeout=10)
            resp.raise_for_status()
            raw = resp.json()

            items = (raw.get("data") or {}).get("content") or []
            result = {"success": True, "tab": tab, "data": items}
            cache_set(cache_key, result)
            return jsonify(result)
        except Exception as exc:
            logger.error("vci_feed error %s %s: %s", symbol, tab, exc)
            return jsonify({"success": False, "error": str(exc)}), 500
