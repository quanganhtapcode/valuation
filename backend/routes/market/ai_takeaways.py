from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

from flask import Blueprint, jsonify

from backend.routes.handlers.vci_top_movers import top_movers_from_screener_sqlite
from backend.services.ai_providers import generate_openrouter
from backend.services.vci_news_sqlite import compact_news_item, default_news_db_path, query_news_for_symbol

from .deps import cache_func
from .earnings_season import compute_earnings_season
from .paths import screener_db_path

logger = logging.getLogger(__name__)

_CACHE_SECONDS = 900
_MOVE_LIMIT = 5
_NEWS_LIMIT_PER_SYMBOL = 3


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
    up = top_movers_from_screener_sqlite(
        db_path=screener_db_path(),
        move_type="UP",
        exchange="HSX",
        limit=_MOVE_LIMIT,
    ).get("Data", [])
    down = top_movers_from_screener_sqlite(
        db_path=screener_db_path(),
        move_type="DOWN",
        exchange="HSX",
        limit=_MOVE_LIMIT,
    ).get("Data", [])

    news_db = default_news_db_path()
    movers: list[dict[str, Any]] = []
    for direction, rows in (("up", up), ("down", down)):
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
    cleaned = (text or "").strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
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
    bullets: list[str] = []

    if up:
        symbols = ", ".join(f"{m['symbol']} +{m['change_pct']:.2f}%" for m in up)
        bullets.append(f"Nhóm tăng mạnh hôm nay nổi bật: {symbols}.")
    if down:
        symbols = ", ".join(f"{m['symbol']} {m['change_pct']:.2f}%" for m in down)
        bullets.append(f"Chiều giảm đáng chú ý: {symbols}.")
    for mover in up:
        first_news = (mover.get("news") or [{}])[0]
        title = first_news.get("title")
        if title:
            bullets.append(f"{mover['symbol']}: tin mới nhất là \"{title}\".")
            break
    bullets.append(
        f"Mùa BCTC {earnings.get('quarter')}: {earnings.get('reported_count')}/{earnings.get('total_count')} "
        f"công ty HOSE/HNX đã có báo cáo, bao phủ {earnings.get('market_cap_pct')}% vốn hóa."
    )

    return {
        "headline": "Biến động thị trường trong ngày",
        "summary": bullets[:4],
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
            "quarter": earnings.get("quarter"),
            "reported_count": earnings.get("reported_count"),
            "total_count": earnings.get("total_count"),
            "reported_pct": earnings.get("reported_pct"),
            "market_cap_pct": earnings.get("market_cap_pct"),
            "top_revenue_yoy": earnings.get("top_revenue_yoy", [])[:3],
            "top_profit_yoy": earnings.get("top_profit_yoy", [])[:3],
        },
    }
    return (
        "Tom tat nhanh cac bien dong lon trong ngay cho nha dau tu chung khoan Viet Nam.\n"
        "Dua CHI tren JSON dau vao. Khong bia nguyen nhan neu tin khong noi ro. "
        "Neu co phieu tang/giam manh co tin lien quan, neu takeaway ngan gon tu tieu de tin. "
        "Moi bullet nen bam vao ma co phieu, % tang/giam, va tieu de tin neu co. "
        "Khong noi ve khoi luong, dong tien, nen tang tai chinh, ap luc ban, ho tro, ky vong, "
        "hay nguyen nhan neu cac y nay khong nam ro trong tieu de tin dau vao. "
        "Viet tieng Viet co dau, trung lap, khong khuyen nghi mua ban.\n\n"
        "Tra ve JSON hop le dung schema:\n"
        "{"
        "\"headline\":\"string toi da 90 ky tu\","
        "\"summary\":[\"3-5 bullet, moi bullet toi da 170 ky tu\"],"
        "\"watchlist\":[{\"symbol\":\"AAA\",\"takeaway\":\"string toi da 140 ky tu\",\"direction\":\"up|down\"}]"
        "}\n\n"
        f"INPUT_JSON:\n{json.dumps(payload, ensure_ascii=False)}"
    )


def compute_ai_takeaways() -> dict[str, Any]:
    movers = _load_movers_with_news()
    earnings = compute_earnings_season()

    if not movers:
        return _fallback_takeaways(movers, earnings)

    try:
        text, model = generate_openrouter(_build_prompt(movers, earnings))
        parsed = _extract_json_object(text)
        headline = str(parsed.get("headline") or "Biến động thị trường trong ngày").strip()
        summary = [str(x).strip() for x in parsed.get("summary", []) if str(x).strip()]
        watchlist = parsed.get("watchlist") if isinstance(parsed.get("watchlist"), list) else []
        if not summary:
            raise ValueError("AI response did not include summary bullets")
        return {
            "headline": headline[:120],
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


def register(market_bp: Blueprint) -> None:
    @market_bp.route("/ai-takeaways")
    def api_market_ai_takeaways():
        cache_key = "market_ai_takeaways_v1"

        try:
            data, is_cached = cache_func()(cache_key, _CACHE_SECONDS, compute_ai_takeaways)
            resp = jsonify(data)
            resp.headers["X-Cache"] = "HIT" if is_cached else "MISS"
            return resp
        except Exception as e:
            logger.error("AI takeaways error: %s", e)
            return jsonify({"available": False, "error": str(e)}), 500
