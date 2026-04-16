from __future__ import annotations

import json
import logging
import os
import sqlite3
from datetime import date

import requests
from flask import Blueprint, jsonify, request

from backend.db_path import resolve_vci_news_events_db_path
from backend.services.news_service import NewsService
from backend.utils import validate_stock_symbol
from backend.services.vci_news_sqlite import query_news_for_symbol, default_news_db_path
from backend.routes.market.http_headers import VCI_HEADERS
from backend.cache_utils import cache_get, cache_set


def _query_news_events_sqlite(symbol: str, tab: str, limit: int = 50) -> list:
    """Query vci_news_events.sqlite for a given symbol+tab. Returns list of dicts from raw_json."""
    db_path = resolve_vci_news_events_db_path()
    if not os.path.exists(db_path):
        return []
    try:
        conn = sqlite3.connect(db_path, timeout=5)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT raw_json FROM items WHERE symbol = ? AND tab = ? ORDER BY public_date DESC LIMIT ?",
            (symbol.upper(), tab, limit),
        ).fetchall()
        conn.close()
        result = []
        for r in rows:
            try:
                result.append(json.loads(r[0]))
            except Exception:
                continue
        return result
    except Exception as e:
        logger.warning("vci_news_events sqlite query failed for %s/%s: %s", symbol, tab, e)
        return []

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
    @stock_bp.route("/stock/<symbol>/news")
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
        """Get events for a symbol (dividend, insider, AGM, etc)."""
        try:
            is_valid, clean_symbol = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"success": False, "error": clean_symbol}), 400

            cache_key = f"events_{clean_symbol}"
            cached = cache_get(cache_key)
            if cached:
                return jsonify(cached)

            # Use VCI IQ API directly (same as vci-feed endpoint)
            today = date.today()
            from_date = "20100101"
            to_date = f"{today.year + 1}{today.month:02d}{today.day:02d}"

            all_events = []
            for event_code in ["DIV,ISS", "DDIND,DDINS,DDRP", "AGME,AGMR,EGME", "AIS,MA,MOVE,NLIS,OTHE,RETU,SUSP"]:
                try:
                    params = {
                        "ticker": clean_symbol,
                        "fromDate": from_date,
                        "toDate": to_date,
                        "page": "0",
                        "size": "50",
                        "eventCode": event_code,
                    }
                    url = f"{_VCI_IQ_BASE}/events"
                    resp = requests.get(url, params=params, headers=VCI_HEADERS, timeout=10)
                    resp.raise_for_status()
                    raw = resp.json()
                    items = (raw.get("data") or {}).get("content") or []
                    for item in items:
                        all_events.append({
                            "event_name": item.get("title", ""),
                            "event_code": item.get("eventCode", "Event"),
                            "notify_date": str(item.get("publicDate", "")).split(" ")[0] if item.get("publicDate") else "",
                            "url": "#",
                        })
                except Exception:
                    continue

            all_events.sort(key=lambda e: e["notify_date"] or "9999-12-31", reverse=True)
            result = {"success": True, "data": all_events[:10]}
            cache_set(cache_key, result)
            return jsonify(result)
        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 500

    @stock_bp.route("/vci-feed/<symbol>")
    @stock_bp.route("/stock/vci-feed/<symbol>")
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

            # Prefer SQLite cache (vci_news_events.sqlite) over live API
            sqlite_items = _query_news_events_sqlite(clean_symbol, tab, limit=50)
            if sqlite_items:
                result = {"success": True, "tab": tab, "data": sqlite_items}
                cache_set(cache_key, result)
                return jsonify(result)

            # Fallback: live VCI IQ API
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
