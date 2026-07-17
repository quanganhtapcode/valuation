from __future__ import annotations

import json
import logging
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.db_path import resolve_valuation_cache_db_path
from backend.services.ai_providers import generate_openrouter
from backend.services.vci_news_sqlite import (
    compact_news_item,
    default_news_db_path,
    query_news_for_symbol,
    query_recent_market_news,
)

logger = logging.getLogger(__name__)

_CACHE_KEY = "market_ai_takeaways_v2"
_MOVE_LIMIT = 5
_NEWS_LIMIT_PER_SYMBOL = 3
_RECENT_NEWS_LIMIT = 30
_SCHEMA = """
CREATE TABLE IF NOT EXISTS market_ai_takeaways (
    cache_key TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    available INTEGER NOT NULL,
    model TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    refreshed_at TEXT NOT NULL
);
"""


def _safe_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _compact_mover(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "symbol": str(item.get("Symbol") or "").upper(),
        "company_name": item.get("CompanyName") or "",
        "price": _safe_float(item.get("CurrentPrice")),
        "change_pct": round(_safe_float(item.get("ChangePricePercent")), 2),
        "value": round(_safe_float(item.get("Value"))),
        "exchange": item.get("Exchange") or "",
    }


def _load_movers_with_news() -> list[dict[str, Any]]:
    # Keep route imports lazy: Flask loads this service while registering market routes.
    from backend.routes.handlers.vci_top_movers import top_movers_from_screener_sqlite
    from backend.routes.market.paths import screener_db_path

    movers: list[dict[str, Any]] = []
    news_db = default_news_db_path()
    for direction, move_type in (("up", "UP"), ("down", "DOWN")):
        rows = top_movers_from_screener_sqlite(
            db_path=screener_db_path(),
            move_type=move_type,
            exchange="HSX",
            limit=_MOVE_LIMIT,
        ).get("Data", [])
        for raw in rows:
            mover = _compact_mover(raw)
            if not mover["symbol"]:
                continue
            news = query_news_for_symbol(news_db, mover["symbol"], limit=_NEWS_LIMIT_PER_SYMBOL)
            movers.append({
                **mover,
                "direction": direction,
                "news": [compact_news_item(item) for item in news],
            })
    return movers


def _load_recent_market_news() -> list[dict[str, Any]]:
    """Load the shared market-news feed from the last 24 hours for the AI prompt."""
    now_local = datetime.now().astimezone()
    rows = query_recent_market_news(
        default_news_db_path(),
        since=now_local - timedelta(hours=24),
        limit=_RECENT_NEWS_LIMIT,
    )
    return [compact_news_item(item) for item in rows]


def _extract_json_object(text: str) -> dict[str, Any]:
    cleaned = re.sub(r"^```(?:json)?\s*", "", (text or "").strip())
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.S)
        if not match:
            raise
        return json.loads(match.group(0))


def _fallback_takeaways(
    movers: list[dict[str, Any]], recent_news: list[dict[str, Any]]
) -> dict[str, Any]:
    up = [m for m in movers if m.get("direction") == "up"][:3]
    down = [m for m in movers if m.get("direction") == "down"][:2]
    market_summary_vi: list[str] = []
    market_summary: list[str] = []
    if up:
        market_summary_vi.append("Nhóm tăng mạnh trong phiên: " + ", ".join(
            f"{m['symbol']} +{m['change_pct']:.2f}%" for m in up
        ) + ".")
        market_summary.append("Largest gains today: " + ", ".join(
            f"{m['symbol']} +{m['change_pct']:.2f}%" for m in up
        ) + ".")
    if down:
        market_summary_vi.append("Nhóm giảm mạnh trong phiên: " + ", ".join(
            f"{m['symbol']} {m['change_pct']:.2f}%" for m in down
        ) + ".")
        market_summary.append("Largest declines today: " + ", ".join(
            f"{m['symbol']} {m['change_pct']:.2f}%" for m in down
        ) + ".")

    news_summary_vi: list[str] = []
    news_summary: list[str] = []
    for item in recent_news[:3]:
        title = str(item.get("title") or "").strip()
        if title:
            symbol = str(item.get("symbol") or "").upper()
            source = str(item.get("source") or "").strip()
            prefix = f"{symbol}: " if symbol else ""
            suffix = f" — {source}" if source else ""
            news_summary_vi.append(f"{prefix}{title}{suffix}")
            # The upstream coverage is Vietnamese. Keep its original title instead
            # of inventing an English translation in deterministic mode.
            news_summary.append(f"{prefix}{title}{suffix}")

    flat_vi = (market_summary_vi + news_summary_vi)[:5]
    flat_en = (market_summary + news_summary)[:5]
    return {
        "headline": "Vietnam market moves today",
        "headline_vi": "Biến động thị trường trong ngày",
        "market_summary": market_summary,
        "market_summary_vi": market_summary_vi,
        "news_summary": news_summary,
        "news_summary_vi": news_summary_vi,
        # Keep the combined fields for API consumers that have not adopted the
        # separated market/news presentation yet.
        "summary_vi": flat_vi,
        "summary": flat_en or ["No material market move was detected in the latest update."],
        "watchlist": [],
        "movers": movers,
        "recent_news": recent_news,
        "model": "deterministic-fallback",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "available": False,
    }


def _build_prompt(movers: list[dict[str, Any]], recent_news: list[dict[str, Any]]) -> str:
    payload = {
        "market_scope": "Vietnam listed stocks, market snapshot and news published in the last 24 hours",
        "movers": movers,
        "recent_news_24h": recent_news,
    }
    return (
        "Summarize notable Vietnam-stock news and market moves from the past 24 hours.\n"
        "Dua CHI tren JSON dau vao. Uu tien ma co phieu xuat hien trong tin noi bat, "
        "hoac co bien dong gia lon; co the chon ma khong nam trong danh sach movers neu tin dang chu y. "
        "When news and price moves are not clearly related, state each fact separately and do not imply causation. "
        "Do not make buy/sell recommendations. Write neutral, plain language.\n\n"
        "Return valid JSON only, using this exact bilingual schema. headline, summary, and takeaway must be English; "
        "the *_vi fields must be their Vietnamese equivalents:\n"
        "{\"headline\":\"English string, max 90 characters\",\"headline_vi\":\"Vietnamese string, max 90 characters\","
        "\"market_summary\":[\"1-2 English bullets about the largest price moves\"],\"market_summary_vi\":[\"matching Vietnamese bullets\"],"
        "\"news_summary\":[\"2-3 English bullets that summarize the provided news only\"],\"news_summary_vi\":[\"matching Vietnamese bullets\"],"
        "\"watchlist\":[{\"symbol\":\"AAA\",\"takeaway\":\"English string, max 140 characters\",\"takeaway_vi\":\"Vietnamese equivalent\","
        "\"direction\":\"up|down|neutral\"}]}\n\n"
        f"INPUT_JSON:\n{json.dumps(payload, ensure_ascii=False)}"
    )


def compute_ai_takeaways() -> dict[str, Any]:
    movers = _load_movers_with_news()
    recent_news = _load_recent_market_news()
    if not movers and not recent_news:
        return _fallback_takeaways(movers, recent_news)
    try:
        text, model = generate_openrouter(_build_prompt(movers, recent_news))
        parsed = _extract_json_object(text)
        def bullets(key: str) -> list[str]:
            return [str(item).strip() for item in parsed.get(key, []) if str(item).strip()]

        market_summary = bullets("market_summary")
        market_summary_vi = bullets("market_summary_vi")
        news_summary = bullets("news_summary")
        news_summary_vi = bullets("news_summary_vi")
        # Compatibility with snapshots generated before the separated schema.
        summary = bullets("summary") or (market_summary + news_summary)
        summary_vi = bullets("summary_vi") or (market_summary_vi + news_summary_vi)
        if not summary:
            raise ValueError("AI response did not include summary bullets")
        raw_watchlist = parsed.get("watchlist") if isinstance(parsed.get("watchlist"), list) else []
        watchlist = [item for item in raw_watchlist if isinstance(item, dict)]
        return {
            "headline": str(parsed.get("headline") or "Vietnam market moves today").strip()[:120],
            "headline_vi": str(parsed.get("headline_vi") or "Biến động thị trường trong ngày").strip()[:120],
            "summary": summary[:5],
            "summary_vi": summary_vi[:5],
            "market_summary": market_summary[:2],
            "market_summary_vi": market_summary_vi[:2],
            "news_summary": news_summary[:3],
            "news_summary_vi": news_summary_vi[:3],
            "watchlist": watchlist[:5],
            "movers": movers,
            "recent_news": recent_news,
            "model": model,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "available": True,
        }
    except Exception as exc:
        logger.warning("AI market takeaways fallback: %s", exc)
        return _fallback_takeaways(movers, recent_news)


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(_SCHEMA)


def read_market_ai_takeaways() -> dict[str, Any] | None:
    """Read the latest persisted snapshot. This path never calls an AI provider."""
    db_path = resolve_valuation_cache_db_path()
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'market_ai_takeaways'"
        ).fetchone()
        if table is None:
            conn.close()
            return None
        row = conn.execute(
            "SELECT payload_json FROM market_ai_takeaways WHERE cache_key = ?", (_CACHE_KEY,)
        ).fetchone()
        conn.close()
        return json.loads(row[0]) if row else None
    except (OSError, sqlite3.Error, json.JSONDecodeError) as exc:
        logger.warning("Unable to read market AI takeaways cache: %s", exc)
        return None


def refresh_market_ai_takeaways() -> dict[str, Any]:
    """Generate one shared snapshot and persist it for every API consumer."""
    data = compute_ai_takeaways()
    now = datetime.now(timezone.utc).isoformat()
    db_path = resolve_valuation_cache_db_path()
    conn = sqlite3.connect(db_path, timeout=30)
    try:
        _ensure_schema(conn)
        conn.execute(
            """
            INSERT INTO market_ai_takeaways
                (cache_key, payload_json, available, model, generated_at, refreshed_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
                payload_json = excluded.payload_json,
                available = excluded.available,
                model = excluded.model,
                generated_at = excluded.generated_at,
                refreshed_at = excluded.refreshed_at
            """,
            (
                _CACHE_KEY,
                json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                int(bool(data.get("available"))),
                str(data.get("model") or "unknown"),
                str(data.get("generated_at") or now),
                now,
            ),
        )
        conn.commit()
    finally:
        conn.close()
    logger.info("Refreshed market AI takeaways (%s)", data.get("model"))
    return data
