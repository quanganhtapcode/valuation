from __future__ import annotations

import datetime as dt
import json
import os
import sqlite3
from typing import Any, Optional


def _project_root() -> str:
    # backend/ is at <root>/backend
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def default_news_db_path() -> str:
    root = _project_root()
    env_path = os.getenv("VCI_NEWS_DB_PATH", "").strip()
    candidates = []
    if env_path:
        candidates.append(env_path)

    candidates.extend(
        [
            os.path.join(root, "fetch_sqlite", "vci_ai_news.sqlite"),
            os.path.join(root, "fetch_sqlite", "vci_news.sqlite"),
            "/var/www/valuation/fetch_sqlite/vci_ai_news.sqlite",
            "/var/www/valuation/fetch_sqlite/vci_news.sqlite",
            "/var/www/store/fetch_sqlite/vci_ai_news.sqlite",
            "/var/www/store/fetch_sqlite/vci_news.sqlite",
        ]
    )

    for path in candidates:
        if path and os.path.exists(path):
            return path

    # Keep deterministic fallback for callers that may create/populate the DB later.
    return os.path.join(root, "fetch_sqlite", "vci_ai_news.sqlite")


def _connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def get_meta_value(db_path: str, key: str) -> Optional[str]:
    if not db_path or not os.path.exists(db_path):
        return None
    try:
        with _connect(db_path) as conn:
            row = conn.execute("SELECT value FROM news_meta WHERE key = ?", (key,)).fetchone()
            return row[0] if row else None
    except Exception:
        return None


def is_fresh(db_path: str, max_age_seconds: int = 600) -> bool:
    """Return True when cache exists and was updated recently."""
    v = get_meta_value(db_path, "last_fetch_utc")
    if not v:
        return False
    try:
        fetched_at = dt.datetime.fromisoformat(v.replace("Z", "+00:00"))
        if fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=dt.timezone.utc)
        age = dt.datetime.now(tz=dt.timezone.utc) - fetched_at
        return age.total_seconds() <= max_age_seconds
    except Exception:
        return False


def query_market_news(
    db_path: str,
    *,
    page: int = 1,
    page_size: int = 12,
) -> list[dict[str, Any]]:
    """Return latest market news (mixed tickers) ordered by update_date desc."""
    if not db_path or not os.path.exists(db_path):
        return []

    page = max(int(page or 1), 1)
    page_size = min(max(int(page_size or 12), 1), 50)
    offset = (page - 1) * page_size

    with _connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT raw_json
            FROM news_items
            ORDER BY update_date DESC
            LIMIT ? OFFSET ?
            """,
            (page_size, offset),
        ).fetchall()

    result: list[dict[str, Any]] = []
    for r in rows:
        raw = r[0]
        if not raw:
            continue
        try:
            result.append(normalize_news_item(json.loads(raw)))
        except Exception:
            # Fallback: expose minimal fields if raw_json is invalid
            continue
    return result


def normalize_news_item(item: dict[str, Any]) -> dict[str, Any]:
    """Normalize a news item to include both legacy and modern field names.

    SQLite stores raw upstream JSON (keys like news_title/news_source_link/update_date).
    Frontend components historically expect keys like Title/Link/PublishDate.
    """
    if not isinstance(item, dict):
        return {}

    title = item.get("Title") or item.get("title") or item.get("news_title") or ""
    link = item.get("Link") or item.get("NewsUrl") or item.get("url") or item.get("news_source_link") or ""
    source = item.get("Source") or item.get("source") or item.get("news_from_name") or item.get("news_from") or ""
    publish = item.get("PublishDate") or item.get("publish_date") or item.get("PostDate") or item.get("update_date") or ""
    image = item.get("ImageThumb") or item.get("Avatar") or item.get("image_url") or item.get("news_image_url") or ""
    sentiment = item.get("Sentiment") or item.get("sentiment") or item.get("sentiment") or ""
    score = item.get("Score") or item.get("score")
    symbol = item.get("Symbol") or item.get("symbol") or item.get("ticker") or ""

    out = dict(item)

    # Legacy (Title-case) fields
    out.setdefault("Title", title)
    out.setdefault("Link", link)
    out.setdefault("NewsUrl", link)
    out.setdefault("Source", source)
    out.setdefault("PublishDate", publish)
    out.setdefault("ImageThumb", image)
    out.setdefault("Avatar", image)
    if sentiment:
        out.setdefault("Sentiment", sentiment)
    if score is not None:
        out.setdefault("Score", score)
    if symbol:
        out.setdefault("Symbol", symbol)

    # Modern (snake/lower) fields
    out.setdefault("title", title)
    out.setdefault("url", link)
    out.setdefault("source", source)
    out.setdefault("publish_date", publish)
    out.setdefault("image_url", image)
    if sentiment:
        out.setdefault("sentiment", sentiment)
    if score is not None:
        out.setdefault("score", score)
    if symbol:
        out.setdefault("symbol", symbol)

    return out


def query_news_for_symbol(
    db_path: str,
    symbol: str,
    *,
    limit: int = 15,
) -> list[dict[str, Any]]:
    if not db_path or not os.path.exists(db_path):
        return []
    symbol = (symbol or "").strip().upper()
    if not symbol:
        return []
    limit = min(max(int(limit or 15), 1), 50)

    with _connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT raw_json
            FROM news_items
            WHERE ticker = ?
            ORDER BY update_date DESC
            LIMIT ?
            """,
            (symbol, limit),
        ).fetchall()

    result: list[dict[str, Any]] = []
    for r in rows:
        raw = r[0]
        if not raw:
            continue
        try:
            result.append(normalize_news_item(json.loads(raw)))
        except Exception:
            continue
    return result
