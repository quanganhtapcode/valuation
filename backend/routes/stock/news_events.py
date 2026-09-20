from __future__ import annotations

import fcntl
import json
import logging
import sqlite3
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from threading import BoundedSemaphore, Lock
import time
from pathlib import Path

from backend.sqlite_utils import read_connection

from flask import Blueprint, jsonify, request

from backend.db_path import resolve_vci_news_events_db_path
from backend.services.news_service import NewsService
from backend.utils import validate_stock_symbol
from backend.services.vci_news_sqlite import compact_news_item, query_news_for_symbol, default_news_db_path
from backend.cache_utils import cache_get, cache_set


logger = logging.getLogger(__name__)
_EVENT_TABS = ("dividend", "insider", "agm", "other")
_TABS = ("news", *_EVENT_TABS)
_REFRESH_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="news-refresh")
_REFRESH_LOCK = Lock()
_REFRESH_SLOTS = BoundedSemaphore(16)
_REFRESH_PENDING: set[str] = set()
_REFRESH_ATTEMPTS: dict[str, float] = {}


def _snapshot(symbol: str, tabs: tuple[str, ...]) -> dict:
    """A successful empty fetch is different from missing/unreadable data."""
    data = []
    timestamps = []
    missing = []
    stale = False
    with read_connection(resolve_vci_news_events_db_path(), timeout=0.25) as conn:
        # Keep rows and their fetch metadata in the same read snapshot.
        conn.execute("BEGIN")
        for tab in tabs:
            meta = conn.execute(
                "SELECT last_fetched, item_count FROM fetch_meta WHERE symbol=? AND tab=?",
                (symbol, tab),
            ).fetchone()
            rows = conn.execute(
                "SELECT raw_json, fetched_at FROM items WHERE symbol=? AND tab=? ORDER BY public_date DESC LIMIT 50",
                (symbol, tab),
            ).fetchall()
            decoded = []
            for row in rows:
                try:
                    item = json.loads(row[0])
                    if isinstance(item, dict):
                        decoded.append(item)
                except (TypeError, ValueError):
                    continue
            known_empty = meta is not None and meta[0] and meta[1] == 0 and not rows
            if (not decoded and not known_empty) or len(decoded) < len(rows):
                missing.append(tab)
            data.extend(decoded)
            stamp = meta[0] if meta else None
            if not stamp:
                stale = True
                stamp = max((row[1] for row in rows if row[1]), default=None)
            if stamp:
                timestamps.append(stamp)
            try:
                updated = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
                # Historical date-only metadata refers to the server's local day.
                if updated.tzinfo is None:
                    updated = updated.astimezone()
                stale |= (datetime.now(timezone.utc) - updated).total_seconds() > 86400
            except (AttributeError, TypeError, ValueError):
                stale = True
    return {"data": data, "data_as_of": min(timestamps) if timestamps else None,
            "stale": stale or bool(missing), "partial": bool(missing),
            "available": bool(data) or not missing}


def _refresh_symbol(symbol: str) -> None:
    from backend.updater.batch_news import _fetch_tab, _init_db, _store_result

    try:
        db_path = Path(resolve_vci_news_events_db_path())
        for tab in _TABS:
            try:
                # Fetch outside SQLite and the maintenance lock.
                items = _fetch_tab(symbol, tab)
                with Path(str(db_path) + ".safe-run.lock").open("a") as lock:
                    try:
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    except BlockingIOError:
                        return  # Cron/maintenance owns the database; keep its snapshot.
                    with closing(sqlite3.connect(db_path, timeout=5)) as conn:
                        _init_db(conn)
                        _store_result(conn, symbol, tab, items)
            except Exception:
                logger.warning("Background news refresh failed for %s/%s", symbol, tab, exc_info=True)

    except Exception:
        logger.warning("Could not refresh news database for %s", symbol, exc_info=True)
    finally:
        with _REFRESH_LOCK:
            _REFRESH_PENDING.discard(symbol)
            _REFRESH_ATTEMPTS[symbol] = time.monotonic()
        _REFRESH_SLOTS.release()


def _schedule_refresh(symbol: str) -> bool:
    """Bound work and suppress repeated refreshes for the same symbol per worker."""
    with _REFRESH_LOCK:
        now = time.monotonic()
        for key, attempted in list(_REFRESH_ATTEMPTS.items()):
            if now - attempted >= 60:
                del _REFRESH_ATTEMPTS[key]
        if symbol in _REFRESH_PENDING:
            return True
        if symbol in _REFRESH_ATTEMPTS or not _REFRESH_SLOTS.acquire(blocking=False):
            return False
        _REFRESH_PENDING.add(symbol)
        try:
            _REFRESH_POOL.submit(_refresh_symbol, symbol)
        except Exception:
            _REFRESH_PENDING.discard(symbol)
            _REFRESH_SLOTS.release()
            logger.exception("Could not schedule news refresh")
            return False
        return True


def _load_snapshot(symbol: str, tabs: tuple[str, ...]) -> dict:
    try:
        snapshot = _snapshot(symbol, tabs)
    except (OSError, sqlite3.Error):
        logger.warning("News snapshot unavailable for %s", symbol, exc_info=True)
        snapshot = {"data": [], "data_as_of": None, "stale": True,
                    "partial": True, "available": False}
    snapshot["refresh_pending"] = _schedule_refresh(symbol) if snapshot["stale"] else False
    return snapshot


def _snapshot_response(snapshot: dict, **extra):
    available = snapshot["available"]
    payload = {"success": available, **extra,
               **{k: v for k, v in snapshot.items() if k != "available"}}
    if not available:
        payload["error"] = "News/events snapshot is not available yet; retry shortly."
    response = jsonify(payload)
    if not available:
        response.status_code = 503
        response.headers["Retry-After"] = "10"
    return response


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/news/<symbol>")
    @stock_bp.route("/stock/<symbol>/news")
    def api_news(symbol):
        """Get news for a symbol (prefer SQLite cache, fallback upstream)."""
        try:
            is_valid, clean_symbol = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"success": False, "error": clean_symbol}), 400

            compact = request.args.get("compact") == "1"
            cache_key = f"news_{clean_symbol}_{'compact' if compact else 'full'}"

            cached = cache_get(cache_key)
            if cached:
                return jsonify(cached)

            # SQLite cache (VCI AI)
            try:
                items = query_news_for_symbol(default_news_db_path(), clean_symbol, limit=12)
                if items:
                    if compact:
                        items = [compact_news_item(item) for item in items]
                    result = {"success": True, "data": items}
                    cache_set(cache_key, result)
                    return jsonify(result)
            except Exception as e:
                logger.warning(f"SQLite symbol news failed for {clean_symbol}: {e}")

            # Upstream fallback (kept for compatibility)
            news_data = NewsService.fetch_news(ticker=clean_symbol, page=1, page_size=12)
            if compact:
                news_data = [compact_news_item(item) for item in news_data]
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

            snapshot = _load_snapshot(clean_symbol, _EVENT_TABS)
            events = [{
                "event_name": item.get("title") or item.get("eventTitleVi") or item.get("eventTitleEn") or item.get("eventNameEn") or "",
                "event_code": item.get("eventCode", "Event"),
                "notify_date": str(item.get("publicDate") or "")[:10],
                "url": "#",
            } for item in snapshot["data"]]
            events.sort(key=lambda item: item["notify_date"], reverse=True)
            snapshot["data"] = events[:10]
            return _snapshot_response(snapshot)

        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 500

    @stock_bp.route("/vci-feed/<symbol>")
    @stock_bp.route("/stock/vci-feed/<symbol>")
    def api_vci_feed(symbol):
        """Serve saved news/events and refresh stale snapshots off the request path."""
        try:
            is_valid, clean_symbol = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"success": False, "error": clean_symbol}), 400

            tab = (request.args.get("tab") or "news").strip().lower()
            if tab not in _TABS:
                return jsonify({"success": False, "error": f"Unknown tab: {tab}"}), 400

            snapshot = _load_snapshot(clean_symbol, (tab,))
            return _snapshot_response(snapshot, tab=tab)

        except Exception as exc:
            logger.error("vci_feed error %s: %s", symbol, exc)
            return jsonify({"success": False, "error": str(exc)}), 500
