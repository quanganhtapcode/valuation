from __future__ import annotations

import json
import logging
import re
import sqlite3
from datetime import datetime, timezone
from typing import Any

from backend.db_path import resolve_valuation_cache_db_path
from backend.services.ai_providers import generate_openrouter
from backend.services.vci_news_sqlite import compact_news_item, default_news_db_path, query_news_for_symbol

logger = logging.getLogger(__name__)

_CACHE_KEY = "market_ai_takeaways_v1"
_MOVE_LIMIT = 5
_NEWS_LIMIT_PER_SYMBOL = 3
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


def _fallback_takeaways(movers: list[dict[str, Any]], earnings: dict[str, Any]) -> dict[str, Any]:
    up = [m for m in movers if m.get("direction") == "up"][:3]
    down = [m for m in movers if m.get("direction") == "down"][:2]
    summary: list[str] = []
    if up:
        summary.append("Nhóm tăng mạnh hôm nay nổi bật: " + ", ".join(
            f"{m['symbol']} +{m['change_pct']:.2f}%" for m in up
        ) + ".")
    if down:
        summary.append("Chiều giảm đáng chú ý: " + ", ".join(
            f"{m['symbol']} {m['change_pct']:.2f}%" for m in down
        ) + ".")
    for mover in up:
        title = (mover.get("news") or [{}])[0].get("title")
        if title:
            summary.append(f"{mover['symbol']}: tin mới nhất là \"{title}\".")
            break
    summary.append(
        f"Mùa BCTC {earnings.get('quarter')}: {earnings.get('reported_count')}/{earnings.get('total_count')} "
        f"công ty HOSE/HNX đã có báo cáo, bao phủ {earnings.get('market_cap_pct')}% vốn hóa."
    )
    return {
        "headline": "Biến động thị trường trong ngày",
        "summary": summary[:4],
        "watchlist": [],
        "movers": movers,
        "earnings": earnings,
        "model": "deterministic-fallback",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "available": False,
    }


def _build_prompt(movers: list[dict[str, Any]], earnings: dict[str, Any]) -> str:
    payload = {
        "market_scope": "Vietnam listed stocks, HSX top movers snapshot",
        "movers": movers,
        "earnings_season": {
            key: earnings.get(key)
            for key in ("quarter", "reported_count", "total_count", "reported_pct", "market_cap_pct")
        } | {
            "top_revenue_yoy": earnings.get("top_revenue_yoy", [])[:3],
            "top_profit_yoy": earnings.get("top_profit_yoy", [])[:3],
        },
    }
    return (
        "Tom tat nhanh cac bien dong lon trong ngay cho nha dau tu chung khoan Viet Nam.\n"
        "Dua CHI tren JSON dau vao. Khong bia nguyen nhan neu tin khong noi ro. "
        "Neu co phieu tang/giam manh co tin lien quan, neu takeaway ngan gon tu tieu de tin. "
        "Khong khuyen nghi mua ban. Viet tieng Viet co dau, trung lap.\n\n"
        "Tra ve JSON hop le dung schema:\n"
        "{\"headline\":\"string toi da 90 ky tu\",\"summary\":[\"3-5 bullet, moi bullet toi da 170 ky tu\"],"
        "\"watchlist\":[{\"symbol\":\"AAA\",\"takeaway\":\"string toi da 140 ky tu\",\"direction\":\"up|down\"}]}\n\n"
        f"INPUT_JSON:\n{json.dumps(payload, ensure_ascii=False)}"
    )


def compute_ai_takeaways() -> dict[str, Any]:
    from backend.routes.market.earnings_season import compute_earnings_season

    movers = _load_movers_with_news()
    earnings = compute_earnings_season()
    if not movers:
        return _fallback_takeaways(movers, earnings)
    try:
        text, model = generate_openrouter(_build_prompt(movers, earnings))
        parsed = _extract_json_object(text)
        summary = [str(item).strip() for item in parsed.get("summary", []) if str(item).strip()]
        if not summary:
            raise ValueError("AI response did not include summary bullets")
        watchlist = parsed.get("watchlist") if isinstance(parsed.get("watchlist"), list) else []
        return {
            "headline": str(parsed.get("headline") or "Biến động thị trường trong ngày").strip()[:120],
            "summary": summary[:5],
            "watchlist": watchlist[:5],
            "movers": movers,
            "earnings": earnings,
            "model": model,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "available": True,
        }
    except Exception as exc:
        logger.warning("AI market takeaways fallback: %s", exc)
        return _fallback_takeaways(movers, earnings)


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
