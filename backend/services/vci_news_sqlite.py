from __future__ import annotations

import datetime as dt
import json
import math
import os
import sqlite3
from typing import Any, Optional


def _project_root() -> str:
    # backend/ is at <root>/backend
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def default_news_db_path() -> str:
    root = _project_root()
    env_path = os.getenv("VCI_MARKET_NEWS_DB_PATH", "").strip() or os.getenv("VCI_NEWS_DB_PATH", "").strip()
    candidates = []
    if env_path:
        candidates.append(env_path)

    candidates.extend(
        [
            os.path.join(root, "fetch_sqlite", "vci_market_news.sqlite"),
            "/var/www/valuation/fetch_sqlite/vci_market_news.sqlite",
            "/var/www/store/fetch_sqlite/vci_market_news.sqlite",
        ]
    )

    for path in candidates:
        if path and os.path.exists(path):
            return path

    # Keep deterministic fallback for callers that may create/populate the DB later.
    return os.path.join(root, "fetch_sqlite", "vci_market_news.sqlite")


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


def query_recent_market_news(
    db_path: str,
    *,
    since: dt.datetime,
    limit: int = 30,
) -> list[dict[str, Any]]:
    """Return market news published since a local timestamp, newest first."""
    if not db_path or not os.path.exists(db_path):
        return []

    limit = min(max(int(limit or 30), 1), 100)
    cutoff = since.replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S")
    with _connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT raw_json
            FROM news_items
            WHERE update_date >= ?
            ORDER BY update_date DESC
            LIMIT ?
            """,
            (cutoff, limit),
        ).fetchall()

    result: list[dict[str, Any]] = []
    for row in rows:
        try:
            result.append(normalize_news_item(json.loads(row[0])))
        except (TypeError, json.JSONDecodeError):
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


def compact_news_item(item: dict[str, Any]) -> dict[str, Any]:
    """Return only fields used by the web UI news cards."""
    normalized = normalize_news_item(item)
    return {
        "id": normalized.get("id") or normalized.get("news_id") or normalized.get("newsId"),
        "title": normalized.get("title") or normalized.get("Title") or "",
        "url": normalized.get("url") or normalized.get("Link") or normalized.get("NewsUrl") or "",
        "source": normalized.get("source") or normalized.get("Source") or "",
        "publish_date": normalized.get("publish_date") or normalized.get("PublishDate") or normalized.get("PostDate") or "",
        "image_url": normalized.get("image_url") or normalized.get("ImageThumb") or normalized.get("Avatar") or "",
        "sentiment": normalized.get("sentiment") or normalized.get("Sentiment") or "",
        "score": normalized.get("score") if normalized.get("score") is not None else normalized.get("Score"),
        "symbol": normalized.get("symbol") or normalized.get("Symbol") or "",
    }


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


def summarize_symbol_news_signal(
    db_path: str,
    symbol: str,
    *,
    window_days: int = 21,
    half_life_days: float = 7.0,
    max_adjustment_pct: float = 0.15,
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    """Build a bounded, time-decayed news catalyst/risk overlay.

    VCI's score is a 0-10 sentiment score, so 5 is neutral. This intentionally
    does *not* create an intrinsic value: it is a separately disclosed context
    overlay uses a sensitivity curve, is capped at +/-15%, and needs at least
    two recent articles. Fundamental
    DCF, earnings forecasts and peer multiples remain the primary valuation.
    """
    now = now or dt.datetime.now(tz=dt.timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=dt.timezone.utc)
    window_days = max(1, int(window_days))
    half_life_days = max(1.0, float(half_life_days))
    max_adjustment_pct = max(0.0, min(0.15, float(max_adjustment_pct)))

    def parse_date(value: Any) -> dt.datetime | None:
        if not value:
            return None
        try:
            parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            return parsed.replace(tzinfo=dt.timezone.utc) if parsed.tzinfo is None else parsed.astimezone(dt.timezone.utc)
        except (TypeError, ValueError):
            return None

    prepared: list[dict[str, Any]] = []
    for item in query_news_for_symbol(db_path, symbol, limit=30):
        published_at = parse_date(item.get("publish_date") or item.get("PublishDate"))
        try:
            score = float(item.get("score") if item.get("score") is not None else item.get("Score"))
        except (TypeError, ValueError):
            continue
        if published_at is None or not 0.0 <= score <= 10.0:
            continue
        age_days = max(0.0, (now - published_at).total_seconds() / 86400.0)
        if age_days > window_days:
            continue
        prepared.append({
            "score": score,
            "age_days": age_days,
            "weight": math.exp(-age_days / half_life_days),
            "item": compact_news_item(item),
        })

    if not prepared:
        return {
            "available": False, "applicable": False, "reason": "no_scored_news_in_window",
            "article_count": 0, "effective_article_count": 0.0, "adjustment_pct": 0.0,
            "window_days": window_days, "half_life_days": half_life_days, "items": [],
        }

    total_weight = sum(row["weight"] for row in prepared)
    weighted_score = sum(row["score"] * row["weight"] for row in prepared) / total_weight
    effective_count = (total_weight ** 2) / sum(row["weight"] ** 2 for row in prepared)
    sentiment = max(-1.0, min(1.0, (weighted_score - 5.0) / 5.0))
    applicable = len(prepared) >= 2 and effective_count >= 1.5
    confidence = min(1.0, effective_count / 5.0) if applicable else 0.0
    # Scores rarely reach 0 or 10. Amplify deviations around neutral (5) with
    # a smooth curve so a sustained 3-4/10 or 6-7/10 signal is meaningful,
    # while the cap still prevents news from replacing intrinsic valuation.
    amplified_sentiment = math.tanh(sentiment * 2.5)
    adjustment_pct = amplified_sentiment * max_adjustment_pct * confidence if applicable else 0.0
    adjustment_pct = max(-max_adjustment_pct, min(max_adjustment_pct, adjustment_pct))
    direction = "positive" if sentiment >= 0.10 else "negative" if sentiment <= -0.10 else "neutral"
    return {
        "available": True,
        "applicable": applicable,
        "reason": "time_decayed_vci_news_score" if applicable else "insufficient_recent_news_coverage",
        "article_count": len(prepared),
        "effective_article_count": round(effective_count, 2),
        "weighted_score": round(weighted_score, 2),
        "sentiment": round(sentiment, 4),
        "amplified_sentiment": round(amplified_sentiment, 4),
        "direction": direction,
        "confidence": round(confidence, 4),
        "adjustment_pct": round(adjustment_pct, 5),
        "max_adjustment_pct": max_adjustment_pct,
        "window_days": window_days,
        "half_life_days": half_life_days,
        "items": [row["item"] for row in prepared[:8]],
    }
