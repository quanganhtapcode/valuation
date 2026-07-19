#!/usr/bin/env python3
"""
Generate AI analysis for new quarterly financial reports.

Run after fetch_vci_financial_statement.py to analyze newly added tickers.

Usage:
    python fetch_sqlite/generate_ai_analysis.py
    python fetch_sqlite/generate_ai_analysis.py --ticker VNM
    python fetch_sqlite/generate_ai_analysis.py --limit 20 --dry-run
"""
from __future__ import annotations

import argparse
import logging
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
logger = logging.getLogger(__name__)

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

from backend.services.gemma_client import build_combined_prompt, generate
from backend.db_path import (
    resolve_vci_technical_db_path,
)
from backend.services.vci_technical_sqlite import query_technical_snapshot
from backend.services.valuation_service import calculate_valuation

FINANCIALS_DB = os.environ.get(
    "VCI_FINANCIAL_STATEMENT_DB_PATH",
    str(ROOT / "fetch_sqlite" / "vci_financials.sqlite"),
)
SCREENING_DB = str(ROOT / "fetch_sqlite" / "vci_screening.sqlite")
COMPANY_DB = os.environ.get(
    "VCI_COMPANY_DB_PATH",
    str(ROOT / "fetch_sqlite" / "vci_company.sqlite"),
)
CACHE_DB = os.environ.get(
    "VALUATION_CACHE_DB_PATH",
    str(ROOT / "fetch_sqlite" / "valuation_cache.sqlite"),
)

MARKET_NEWS_DB = os.environ.get(
    "VCI_MARKET_NEWS_DB_PATH",
    str(ROOT / "fetch_sqlite" / "vci_market_news.sqlite"),
)
STATS_FINANCIAL_DB = os.environ.get(
    "VCI_STATS_FINANCIAL_DB_PATH",
    str(ROOT / "fetch_sqlite" / "vci_stats_financial.sqlite"),
)

LISTED_EXCHANGES = ("HSX", "HNX", "UPCOM")
RATE_LIMIT_DELAY = 4.0  # seconds between API calls — respects ~15 RPM limit
NEWS_REFRESH_THRESHOLD = 3  # re-analyze if this many new news items since last analysis


def detect_current_quarter(fin: sqlite3.Connection) -> tuple[int, int]:
    row = fin.execute(
        """
        SELECT year_report, quarter_report
        FROM income_statement
        WHERE quarter_report != 0
        GROUP BY year_report, quarter_report
        HAVING COUNT(DISTINCT ticker) > 10
        ORDER BY year_report DESC, quarter_report DESC
        LIMIT 1
        """
    ).fetchone()
    if not row:
        raise RuntimeError("No quarterly data found in income_statement")
    return int(row[0]), int(row[1])


def detect_latest_ticker_period(fin: sqlite3.Connection, ticker: str) -> tuple[int, int] | None:
    """Use the latest reported quarter for a targeted ticker refresh."""
    row = fin.execute(
        """SELECT year_report, quarter_report FROM income_statement
           WHERE ticker=? AND quarter_report != 0
           GROUP BY year_report, quarter_report
           ORDER BY year_report DESC, quarter_report DESC LIMIT 1""",
        (ticker,),
    ).fetchone()
    return (int(row[0]), int(row[1])) if row else None


def get_listed_tickers(scr: sqlite3.Connection) -> set[str]:
    rows = scr.execute(
        "SELECT ticker FROM screening_data WHERE exchange IN ('HSX', 'HNX', 'UPCOM')"
    ).fetchall()
    return {r[0] for r in rows}


def get_company_names(cmp: sqlite3.Connection) -> dict[str, str]:
    rows = cmp.execute("SELECT ticker, short_name FROM companies").fetchall()
    return {r[0]: r[1] for r in rows}


def get_last_analysis(cache: sqlite3.Connection, ticker: str, year: int, q: int) -> str | None:
    """Return generated_at ISO string if analysis exists, else None."""
    row = cache.execute(
        "SELECT generated_at FROM ai_financial_analysis WHERE ticker=? AND year_report=? AND quarter_report=?",
        (ticker, year, q),
    ).fetchone()
    return row[0] if row else None


def count_new_news(news_conn: sqlite3.Connection, ticker: str, since_iso: str = "") -> int:
    """Count recent news that arrived after this ticker's last analysis.

    The news source currently exposes dates rather than timestamps. Comparing
    calendar dates prevents a stock with the same three headlines from being
    re-analysed every day while still picking it up after genuinely newer news.
    """
    if since_iso:
        row = news_conn.execute(
            """SELECT COUNT(*) FROM news_items
               WHERE ticker=?
                 AND update_date >= date('now', '-14 days')
                 AND date(update_date) > date(?)""",
            (ticker, since_iso),
        ).fetchone()
    else:
        row = news_conn.execute(
            "SELECT COUNT(*) FROM news_items WHERE ticker=? AND update_date >= date('now', '-14 days')",
            (ticker,),
        ).fetchone()
    return int(row[0]) if row else 0


def has_any_company_news(news_conn: sqlite3.Connection, ticker: str) -> bool:
    """Return whether the local news store has at least one company item."""
    row = news_conn.execute(
        "SELECT 1 FROM news_items WHERE ticker=? LIMIT 1", (ticker,)
    ).fetchone()
    return row is not None


def fetch_recent_news(news_conn: sqlite3.Connection, ticker: str, limit: int = 8) -> list[dict]:
    """Return list of recent news dicts {id, title, summary, sentiment, date, source} for ticker."""
    rows = news_conn.execute(
        """SELECT news_title, news_short_content, sentiment, update_date, news_from_name
           FROM news_items WHERE ticker=? ORDER BY update_date DESC LIMIT ?""",
        (ticker, limit),
    ).fetchall()
    return [
        {
            "id": i,
            "title": r[0] or "",
            "summary": r[1] or "",
            "sentiment": r[2] or "",
            "date": (r[3] or "")[:10],
            "source": r[4] or "",
        }
        for i, r in enumerate(rows)
        if r[0]
    ]


def fetch_stock_data(
    fin: sqlite3.Connection, ticker: str, year: int, q: int
) -> dict | None:
    """Return key financial metrics for a ticker in the given quarter."""
    cur = fin.execute(
        "SELECT isa1, isa22, isa5 FROM income_statement WHERE ticker=? AND year_report=? AND quarter_report=?",
        (ticker, year, q),
    ).fetchone()
    if not cur or cur[0] is None:
        return None

    revenue, net_profit, gross_profit = cur[0], cur[1], cur[2]

    # YoY (same quarter last year)
    yoy = fin.execute(
        "SELECT isa1, isa22 FROM income_statement WHERE ticker=? AND year_report=? AND quarter_report=?",
        (ticker, year - 1, q),
    ).fetchone()

    # QoQ (previous quarter)
    pq_year, pq_q = (year - 1, 4) if q == 1 else (year, q - 1)
    qoq = fin.execute(
        "SELECT isa1, isa22 FROM income_statement WHERE ticker=? AND year_report=? AND quarter_report=?",
        (ticker, pq_year, pq_q),
    ).fetchone()

    def growth(cur_val: float, prev_val: float | None) -> float:
        if not prev_val or prev_val == 0:
            return 0.0
        return (cur_val - prev_val) / abs(prev_val) * 100

    gross_margin = (gross_profit / revenue * 100) if revenue and gross_profit else None

    return {
        "revenue": revenue,
        "net_profit": net_profit,
        "revenue_yoy": growth(revenue, yoy[0] if yoy else None),
        "revenue_qoq": growth(revenue, qoq[0] if qoq else None),
        "profit_yoy": growth(net_profit, yoy[1] if yoy else None),
        "profit_qoq": growth(net_profit, qoq[1] if qoq else None),
        "gross_margin": gross_margin,
    }


def fetch_pe_pb_averages(stats_conn: sqlite3.Connection, ticker: str) -> dict:
    """Return PE/PB 2-year and 5-year averages + ROE avg + dividend yield avg from stats_financial_history."""
    rows_2yr = stats_conn.execute(
        """SELECT pe, pb FROM (
               SELECT pe, pb FROM stats_financial_history
               WHERE ticker=? AND pe>0 AND pb>0
               ORDER BY year_report DESC, quarter_report DESC LIMIT 8
           )""",
        (ticker,),
    ).fetchall()
    rows_5yr = stats_conn.execute(
        """SELECT pe, pb, roe, dividend_yield FROM (
               SELECT pe, pb, roe, dividend_yield FROM stats_financial_history
               WHERE ticker=? AND pe>0 AND pb>0
               ORDER BY year_report DESC, quarter_report DESC LIMIT 20
           )""",
        (ticker,),
    ).fetchall()

    def avg(vals):
        vs = [v for v in vals if v is not None]
        return round(sum(vs) / len(vs), 2) if vs else None

    pe_2yr = avg([r[0] for r in rows_2yr])
    pb_2yr = avg([r[1] for r in rows_2yr])
    pe_5yr = avg([r[0] for r in rows_5yr])
    pb_5yr = avg([r[1] for r in rows_5yr])
    roe_raw = avg([r[2] for r in rows_5yr if r[2]])
    div_raw = avg([r[3] for r in rows_5yr if r[3]])
    # DB stores as decimals (0.23 = 23%) — convert to %
    roe_avg = round(roe_raw * 100, 1) if roe_raw else None
    div_avg = round(div_raw * 100, 1) if div_raw else None

    return {
        "pe_2yr_avg": pe_2yr,
        "pb_2yr_avg": pb_2yr,
        "pe_5yr_avg": pe_5yr,
        "pb_5yr_avg": pb_5yr,
        "roe_avg": roe_avg,
        "dividend_yield_avg": div_avg,
    }


def fetch_sector_averages(scr_conn: sqlite3.Connection, stats_conn: sqlite3.Connection, ticker: str) -> dict:
    """Return sector-median PE/PB for the ticker's ICB Level-2 sector."""
    row = scr_conn.execute(
        "SELECT icbCodeLv2 FROM screening_data WHERE ticker=?", (ticker,)
    ).fetchone()
    if not row or not row[0]:
        return {"pe_sector": None, "pb_sector": None}
    icb2 = str(row[0])

    peers = scr_conn.execute(
        "SELECT ticker FROM screening_data WHERE icbCodeLv2=? AND ticker!=?",
        (icb2, ticker),
    ).fetchall()
    peer_tickers = [r[0] for r in peers]
    if not peer_tickers:
        return {"pe_sector": None, "pb_sector": None}

    placeholders = ",".join("?" * len(peer_tickers))
    agg = stats_conn.execute(
        f"""SELECT AVG(pe), AVG(pb) FROM (
                SELECT ticker, pe, pb, MAX(year_report*10+quarter_report) AS latest
                FROM stats_financial_history
                WHERE ticker IN ({placeholders}) AND pe>0 AND pe<50 AND pb>0
                GROUP BY ticker
            )""",
        peer_tickers,
    ).fetchone()
    if not agg:
        return {"pe_sector": None, "pb_sector": None}
    return {
        "pe_sector": round(agg[0], 2) if agg[0] else None,
        "pb_sector": round(agg[1], 2) if agg[1] else None,
    }


def fetch_market_context(scr_conn: sqlite3.Connection, cmp_conn: sqlite3.Connection, ticker: str) -> dict:
    """Return current_price, target_price, pe_ttm, pb_ttm from screening + company DBs."""
    scr = scr_conn.execute(
        "SELECT marketPrice, ttmPe, ttmPb, ttmRoe FROM screening_data WHERE ticker=?",
        (ticker,),
    ).fetchone()
    cmp = cmp_conn.execute(
        "SELECT target_price FROM companies WHERE ticker=?", (ticker,)
    ).fetchone()

    current_price = scr[0] if scr else None
    pe_ttm = scr[1] if scr else None
    pb_ttm = scr[2] if scr else None
    roe_ttm = scr[3] if scr else None
    target_price = cmp[0] if cmp else None

    action = None
    upside_pct = None
    if target_price and current_price and current_price > 0:
        upside_pct = round((target_price - current_price) / current_price * 100, 1)
        if upside_pct >= 20:
            action = "Mua"
        elif upside_pct >= 10:
            action = "Tích lũy"
        elif upside_pct >= 0:
            action = "Theo dõi"
        else:
            action = "Giảm tỷ trọng"

    return {
        "current_price": current_price,
        "target_price": target_price,
        "pe_ttm": round(pe_ttm, 2) if pe_ttm else None,
        "pb_ttm": round(pb_ttm, 2) if pb_ttm else None,
        "roe_ttm": round(roe_ttm, 1) if roe_ttm else None,
        "recommendation_action": action,
        "upside_pct": upside_pct,
    }


def fetch_technical_summary(ticker: str) -> dict:
    """Return MA rating, oscillator rating, and top MA values for support/resistance context."""
    tech_db = resolve_vci_technical_db_path()
    snapshot = query_technical_snapshot(tech_db, ticker, "ONE_DAY")
    if not snapshot or not snapshot.get("success"):
        return {}

    data = snapshot.get("data") or {}

    ma_gauge = (data.get("gaugeMovingAverage") or {}).get("rating", "")
    osc_gauge = (data.get("gaugeOscillator") or {}).get("rating", "")

    ma_values: dict[str, float] = {}
    for item in data.get("movingAverages") or []:
        if item.get("name") in ("sma50", "sma100", "sma200", "ema50", "ema200"):
            if item.get("value"):
                ma_values[item["name"]] = round(float(item["value"]), 0)

    rating_map = {
        "VERY_BAD": "Bán mạnh", "BAD": "Bán", "NEUTRAL": "Trung tính",
        "GOOD": "Mua", "VERY_GOOD": "Mua mạnh",
    }

    return {
        "ma_rating": rating_map.get(ma_gauge, ma_gauge),
        "osc_rating": rating_map.get(osc_gauge, osc_gauge),
        "ma_values": ma_values,
    }


def fetch_forecast_years(cache_conn: sqlite3.Connection, ticker: str) -> list[dict]:
    """Return year rows from vci_financial_data_years, newest 6 rows (actuals + forecasts)."""
    try:
        rows = cache_conn.execute(
            """SELECT year, is_forecast, revenue_growth, profit_growth, pe, pb, roe, eps, dividend_yield
               FROM vci_financial_data_years WHERE ticker=?
               ORDER BY year DESC LIMIT 6""",
            (ticker,),
        ).fetchall()
    except sqlite3.OperationalError:
        return []  # Table not yet created
    return [
        {
            "year": r[0],
            "is_forecast": bool(r[1]),
            "revenue_growth": r[2],
            "profit_growth": r[3],
            "pe": r[4],
            "pb": r[5],
            "roe": r[6],
            "eps": r[7],
            "dividend_yield": r[8],
        }
        for r in reversed(rows)  # chronological order
    ]


def fetch_valuation_models(ticker: str) -> dict | None:
    """Call ValuationService and return valuation model outputs."""
    try:
        result = calculate_valuation(ticker, {})
        if not result.get("success"):
            return None
        return {
            "fcfe": result.get("valuations", {}).get("fcfe"),
            "fcff": result.get("valuations", {}).get("fcff"),
            "justified_pe": result.get("valuations", {}).get("justified_pe"),
            "justified_pb": result.get("valuations", {}).get("justified_pb"),
            "graham": result.get("valuations", {}).get("graham"),
            "weighted_average": result.get("valuations", {}).get("weighted_average"),
            "fair_value_range": result.get("fair_value_range"),
        }
    except Exception as e:
        logger.warning(f"ValuationService failed for {ticker}: {e}")
        return None


def build_rule_based_analysis(
    ticker: str,
    name: str,
    sector: str,
    market_ctx: dict,
    pe_pb_avgs: dict,
    sector_avgs: dict,
    tech: dict,
    valuation_models: dict | None,
    forecast_years: list[dict],
) -> tuple[str, str]:
    """Generate analysis_json + news_json deterministically — no LLM call.

    Returns (analysis_json_str, news_json_str) using the same schema as AI output.
    news_json is the empty-news sentinel so AiInsightCard hides the news zone.
    """
    import json as _json

    pe_ttm = market_ctx.get("pe_ttm")
    pb_ttm = market_ctx.get("pb_ttm")
    roe_ttm = market_ctx.get("roe_ttm")
    current_price = market_ctx.get("current_price")
    target_price = market_ctx.get("target_price")
    upside_pct = market_ctx.get("upside_pct")
    recommendation = market_ctx.get("recommendation_action") or "Theo dõi"

    pe_2yr = pe_pb_avgs.get("pe_2yr_avg")
    pe_5yr = pe_pb_avgs.get("pe_5yr_avg")
    pb_2yr = pe_pb_avgs.get("pb_2yr_avg")
    pb_5yr = pe_pb_avgs.get("pb_5yr_avg")
    pe_sector = sector_avgs.get("pe_sector")
    pb_sector = sector_avgs.get("pb_sector")

    def _assess(ttm: float | None, hist: float | None, sect: float | None) -> str:
        if ttm is None:
            return "hợp lý"
        refs = [r for r in (hist, sect) if r]
        if not refs:
            return "hợp lý"
        avg_ref = sum(refs) / len(refs)
        if ttm < avg_ref * 0.85:
            return "rẻ"
        if ttm > avg_ref * 1.15:
            return "đắt"
        return "hợp lý"

    pe_assessment = _assess(pe_ttm, pe_2yr, pe_sector)
    pb_assessment = _assess(pb_ttm, pb_2yr, pb_sector)

    pe_str = f"P/E {pe_ttm:.1f}x" if pe_ttm else "P/E N/A"
    hist_str = f"TB2yr {pe_2yr:.1f}x" if pe_2yr else ""
    sect_str = f"ngành {pe_sector:.1f}x" if pe_sector else ""
    refs_str = " và ".join(filter(None, [hist_str, sect_str])) or "mức tham chiếu"
    roe_str = f" ROE đạt {roe_ttm:.1f}%." if roe_ttm else "."
    valuation_summary = (
        f"{name} giao dịch ở {pe_str}, {pe_assessment} so với {refs_str}.{roe_str}"
    )

    if valuation_models and target_price and current_price and current_price > 0:
        if upside_pct is not None:
            model_consensus = (
                f"Các mô hình định giá hội tụ quanh {target_price:,.0f}đ "
                f"(upside {upside_pct:+.1f}%)."
            )
        else:
            model_consensus = f"Target price {target_price:,.0f}đ từ tổng hợp các mô hình."
    else:
        model_consensus = "Chưa đủ dữ liệu để tổng hợp mô hình định giá."

    buy_ratings = {"Mua mạnh", "Mua"}
    sell_ratings = {"Bán mạnh", "Bán"}
    ma_r = tech.get("ma_rating", "")
    osc_r = tech.get("osc_rating", "")
    if ma_r in buy_ratings and osc_r in buy_ratings:
        signal = "Tích cực"
    elif ma_r in sell_ratings and osc_r in sell_ratings:
        signal = "Tiêu cực"
    elif ma_r in buy_ratings or osc_r in buy_ratings:
        signal = "Tích cực"
    elif ma_r in sell_ratings or osc_r in sell_ratings:
        signal = "Tiêu cực"
    else:
        signal = "Trung tính"

    trend_map = {
        "Tích cực": "Xu hướng tăng, chỉ báo kỹ thuật tích cực.",
        "Tiêu cực": "Xu hướng giảm, chỉ báo kỹ thuật tiêu cực.",
        "Trung tính": "Xu hướng trung tính, chưa rõ chiều.",
    }
    trend = trend_map[signal]

    ma_vals = tech.get("ma_values") or {}
    support: float | None = None
    resistance: float | None = None
    if current_price and ma_vals:
        below = [v for v in ma_vals.values() if v < current_price]
        above = [v for v in ma_vals.values() if v >= current_price]
        support = round(max(below)) if below else None
        resistance = round(min(above)) if above else None

    if signal == "Tích cực" and pe_assessment in ("rẻ", "hợp lý"):
        timing = "Ngay bây giờ"
    elif pe_assessment == "rẻ":
        timing = "Chờ xác nhận"
    else:
        timing = "Chờ pullback"

    valuation_obj = {
        "valuation_summary": valuation_summary,
        "pe_assessment": pe_assessment,
        "pb_assessment": pb_assessment,
        "model_consensus": model_consensus,
        "target_price": int(target_price) if target_price else None,
        "target_rationale": "Tổng hợp các mô hình FCFE/FCFF/PE/PB/Graham.",
        "recommendation": recommendation,
        "upside_pct": upside_pct,
        "timing": timing,
        "technical": {
            "trend": trend,
            "support": int(support) if support else None,
            "resistance": int(resistance) if resistance else None,
            "signal": signal,
        },
        "valuation_table": {
            "pe_ttm": pe_ttm,
            "pe_2yr_avg": pe_2yr,
            "pe_5yr_avg": pe_5yr,
            "pe_sector": pe_sector,
            "pb_ttm": pb_ttm,
            "pb_2yr_avg": pb_2yr,
            "pb_5yr_avg": pb_5yr,
            "pb_sector": pb_sector,
            "pe_commentary": f"P/E TTM {pe_assessment} so với lịch sử và ngành.",
            "pb_commentary": f"P/B TTM {pb_assessment} so với lịch sử và ngành.",
        },
    }

    news_obj = {
        "overall_sentiment": "mixed",
        "summary": "Chưa có tin tức gần đây.",
        "bull_case": [],
        "bear_case": [],
        "key_events": [],
        "watch_out": "Chờ cập nhật thêm tin tức.",
    }

    return (
        _json.dumps(valuation_obj, ensure_ascii=False),
        _json.dumps(news_obj, ensure_ascii=False),
    )


def parse_json_response(raw: str) -> str | None:
    """Extract and validate JSON from AI response. Returns JSON string or None."""
    import json, re
    text = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group())
            return json.dumps(data, ensure_ascii=False)
        except json.JSONDecodeError:
            pass
    return None


def parse_analysis(raw: str) -> tuple[str, str | None]:
    """Return (analysis_vi_summary, analysis_json_str | None).

    Tries to extract JSON from the response. Falls back to storing raw text.
    """
    import json, re
    # Strip markdown code fences if present
    text = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
    # Find first { ... } block
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group())
            summary = data.get("summary", "")
            return summary, json.dumps(data, ensure_ascii=False)
        except json.JSONDecodeError:
            pass
    return raw, None


def save_analysis(
    cache: sqlite3.Connection,
    ticker: str,
    year: int,
    q: int,
    combined_raw: str,
    model: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Parse and save a news-only AI thesis; valuation is never AI-generated."""
    import json as _json, re as _re

    valuation_json = "{}"
    news_json = None
    summary = combined_raw[:200]  # fallback
    news_part: dict[str, Any] | None = None

    text = _re.sub(r"```(?:json)?", "", combined_raw).strip().rstrip("`").strip()
    match = _re.search(r"\{.*\}", text, _re.DOTALL)
    if match:
        try:
            data = _json.loads(match.group())
            candidate = data.get("news_thesis")
            # Some providers correctly return the requested thesis fields at
            # the root level instead of nesting them under "news_thesis".
            # Both forms are valid for this news-only analysis payload.
            if not isinstance(candidate, dict) and isinstance(data, dict) and any(
                key in data for key in ("overall_sentiment", "bull_case", "bear_case", "key_events", "watch_out")
            ):
                candidate = data
            if isinstance(candidate, dict):
                news_part = candidate
                news_json = _json.dumps(news_part, ensure_ascii=False)
                summary = str(news_part.get("summary") or summary)
        except _json.JSONDecodeError:
            pass

    if not news_json or news_part is None:
        raise ValueError("AI response did not contain valid news_thesis JSON")

    cache.execute(
        """
        INSERT OR REPLACE INTO ai_financial_analysis
            (ticker, year_report, quarter_report, analysis_vi, analysis_json, news_json, model, generated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (ticker, year, q, summary, valuation_json, news_json, model, datetime.now(timezone.utc).isoformat()),
    )
    cache.commit()
    return {}, news_part


def build_telegram_message(
    ticker: str,
    name: str,
    quarter_label: str,
    news_thesis: dict[str, Any],
) -> str:
    """Build a Telegram notification for AI news analysis only."""
    sentiment = {
        "bullish": "Tích cực",
        "bearish": "Tiêu cực",
        "mixed": "Trung lập",
    }.get(str(news_thesis.get("overall_sentiment") or "mixed"), "Trung lập")
    news_summary = str(news_thesis.get("summary") or "")
    bullish = news_thesis.get("bull_case") or []
    bearish = news_thesis.get("bear_case") or []

    lines = [
        "📰 Phân tích tin tức AI hoàn tất",
        f"{ticker} — {name}",
        f"Kỳ dữ liệu: {quarter_label}",
        f"Tâm lý tin tức: {sentiment}",
    ]
    if news_summary:
        lines.append(f"Luận điểm: {news_summary}")
    if isinstance(bullish, list) and bullish:
        first_bull = bullish[0].get("point") if isinstance(bullish[0], dict) else None
        if first_bull:
            lines.append(f"Tích cực: {first_bull}")
    if isinstance(bearish, list) and bearish:
        first_bear = bearish[0].get("point") if isinstance(bearish[0], dict) else None
        if first_bear:
            lines.append(f"Rủi ro: {first_bear}")
    lines.extend([
        f"Xem chi tiết: https://stock.quanganh.org/stock/{ticker}",
    ])
    return "\n".join(lines)


def notify_telegram(message: str) -> None:
    """Send through the existing Telegram sender without exposing credentials."""
    sender = ROOT / "scripts" / "send_telegram_message.sh"
    if not sender.is_file():
        print("  [telegram] sender script not found; skipped")
        return
    try:
        result = subprocess.run(
            [str(sender), "--message", message],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        if result.returncode == 0:
            print("  [telegram] AI result sent")
        else:
            detail = (result.stderr or result.stdout).strip()
            print(f"  [telegram] notification failed: {detail or 'unknown error'}")
    except (OSError, subprocess.SubprocessError) as exc:
        print(f"  [telegram] notification failed: {exc}")


def run(
    tickers_override: list[str] | None,
    limit: int,
    dry_run: bool,
    regen_missing: bool = False,
    force_news_refresh: bool = False,
    notify_telegram_results: bool | None = None,
) -> None:
    fin = sqlite3.connect(f"file:{FINANCIALS_DB}?mode=ro", uri=True)
    scr = sqlite3.connect(f"file:{SCREENING_DB}?mode=ro", uri=True)
    cmp = sqlite3.connect(f"file:{COMPANY_DB}?mode=ro", uri=True)
    cache = sqlite3.connect(CACHE_DB)
    news_conn = sqlite3.connect(f"file:{MARKET_NEWS_DB}?mode=ro", uri=True) if MARKET_NEWS_DB else None
    stats_conn = sqlite3.connect(f"file:{STATS_FINANCIAL_DB}?mode=ro", uri=True)
    cmp_conn = sqlite3.connect(f"file:{COMPANY_DB}?mode=ro", uri=True)

    year, q = detect_current_quarter(fin)
    quarter_label = f"Q{q}.{year}"
    print(f"Current quarter: {quarter_label}")

    # A targeted run (for example, --ticker PNJ) is a deliberate request for
    # one result, so notify by default. Batch refreshes stay quiet unless the
    # caller explicitly opts in, preventing hundreds of Telegram messages.
    if notify_telegram_results is None:
        notify_telegram_results = bool(tickers_override)

    listed_tickers = get_listed_tickers(scr)
    names = get_company_names(cmp)

    if tickers_override:
        candidates = [t for t in tickers_override if t in listed_tickers]
    elif force_news_refresh:
        # A news refresh must cover every listed stock, not only the subset
        # that has already reported the latest market-wide quarter.
        candidates = sorted(listed_tickers)
    else:
        rows = fin.execute(
            "SELECT DISTINCT ticker FROM income_statement WHERE year_report=? AND quarter_report=?",
            (year, q),
        ).fetchall()
        candidates = sorted(r[0] for r in rows if r[0] in listed_tickers)

    # Separate into new (never analyzed), refresh (news threshold), and regen (missing news_json)
    new_tickers = []
    refresh_tickers = []
    regen_tickers = []
    for t in candidates:
        last_at = get_last_analysis(cache, t, year, q)
        # Only analyze companies for which the platform has actual news; this
        # prevents an LLM from fabricating an investment thesis for no-news names.
        if force_news_refresh:
            if news_conn and has_any_company_news(news_conn, t):
                refresh_tickers.append(t)
            continue
        if last_at is None:
            new_tickers.append(t)
        else:
            # Check if this ticker needs the new split format (missing news_json)
            has_news_json = cache.execute(
                "SELECT news_json FROM ai_financial_analysis WHERE ticker=? AND year_report=? AND quarter_report=?",
                (t, year, q),
            ).fetchone()
            if regen_missing and (not has_news_json or not has_news_json[0]):
                regen_tickers.append(t)
            elif news_conn and count_new_news(news_conn, t, last_at) >= NEWS_REFRESH_THRESHOLD:
                refresh_tickers.append(t)

    pending = sorted(new_tickers) + sorted(refresh_tickers) + sorted(regen_tickers)
    print(
        f"Pending: {len(new_tickers)} new + {len(refresh_tickers)} news-refresh "
        f"+ {len(regen_tickers)} regen-missing "
        f"(skipping {len(candidates) - len(pending)} already done)"
    )

    if limit:
        pending = pending[:limit]

    done_ai = 0
    done_rule = 0
    pe_pb_valuation_keys = ("pe_2yr_avg", "pb_2yr_avg", "pe_5yr_avg", "pb_5yr_avg")

    for ticker in pending:
        analysis_year, analysis_q = year, q
        if tickers_override or force_news_refresh:
            ticker_period = detect_latest_ticker_period(fin, ticker)
            if ticker_period:
                analysis_year, analysis_q = ticker_period
        ticker_quarter_label = f"Q{analysis_q}.{analysis_year}"
        data = fetch_stock_data(fin, ticker, analysis_year, analysis_q)
        if not data:
            print(f"  [{ticker}] No data, skip")
            continue

        name = names.get(ticker, ticker)
        recent_news = fetch_recent_news(news_conn, ticker, limit=12) if news_conn else []
        pe_pb_avgs = fetch_pe_pb_averages(stats_conn, ticker)
        sector_avgs = fetch_sector_averages(scr, stats_conn, ticker)
        market_ctx = fetch_market_context(scr, cmp_conn, ticker)
        tech = fetch_technical_summary(ticker)
        forecast_years = fetch_forecast_years(cache, ticker)
        # Valuation stays in the deterministic Valuation tab. AI receives only
        # news and is never asked to calculate or interpret a target price.
        valuation_models = None

        sector_row = scr.execute(
            "SELECT viSector FROM screening_data WHERE ticker=?", (ticker,)
        ).fetchone()
        sector = sector_row[0] if sector_row and sector_row[0] else "Chứng khoán"

        has_news = len(recent_news) > 0

        if dry_run:
            path = "AI" if has_news else "rule-based"
            if has_news:
                combined_prompt = build_combined_prompt(
                    ticker=ticker, name=name, sector=sector, quarter=ticker_quarter_label,
                    forecast_years=forecast_years, technical=tech,
                    valuation_models=valuation_models, news=recent_news,
                    **{k: v for k, v in pe_pb_avgs.items() if k in pe_pb_valuation_keys},
                    **sector_avgs, **market_ctx,
                    **{k: v for k, v in data.items() if k in (
                        "revenue", "revenue_yoy", "profit_yoy", "gross_margin"
                    )},
                )
                print(f"  [{ticker}] DRY RUN [{path}] — prompt {len(combined_prompt)} chars, news={len(recent_news)}")
            else:
                print(f"  [{ticker}] DRY RUN [{path}] — news=0, skipping LLM")
            continue

        if has_news:
            # ── AI path: LLM call ──────────────────────────────────────
            combined_prompt = build_combined_prompt(
                ticker=ticker, name=name, sector=sector, quarter=ticker_quarter_label,
                forecast_years=forecast_years, technical=tech,
                valuation_models=valuation_models, news=recent_news,
                **{k: v for k, v in pe_pb_avgs.items() if k in pe_pb_valuation_keys},
                **sector_avgs, **market_ctx,
                **{k: v for k, v in data.items() if k in (
                    "revenue", "revenue_yoy", "profit_yoy", "gross_margin"
                )},
            )
            ai_ok = False
            for attempt in range(2):
                try:
                    combined_raw, model_used = generate(combined_prompt)
                    valuation, news_thesis = save_analysis(
                        cache, ticker, analysis_year, analysis_q, combined_raw, model_used
                    )
                    print(f"  [{ticker}] {name} [AI/{model_used}]: saved")
                    done_ai += 1
                    if notify_telegram_results:
                        notify_telegram(
                            build_telegram_message(
                                ticker, name, ticker_quarter_label, news_thesis,
                            )
                        )
                    time.sleep(RATE_LIMIT_DELAY)
                    ai_ok = True
                    break
                except Exception as e:
                    if attempt == 0:
                        print(f"  [{ticker}] AI error (attempt 1): {e} — retrying in 30s")
                        time.sleep(30)
                    else:
                        print(f"  [{ticker}] AI exhausted after 2 attempts: {e} — falling back to rule-based")

            if not ai_ok:
                try:
                    analysis_json, news_json = build_rule_based_analysis(
                        ticker=ticker, name=name, sector=sector,
                        market_ctx=market_ctx, pe_pb_avgs=pe_pb_avgs,
                        sector_avgs=sector_avgs, tech=tech,
                        valuation_models=valuation_models,
                        forecast_years=forecast_years,
                    )
                    cache.execute(
                        """
                        INSERT OR REPLACE INTO ai_financial_analysis
                            (ticker, year_report, quarter_report, analysis_vi,
                             analysis_json, news_json, model, generated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (ticker, analysis_year, analysis_q, name, analysis_json, news_json,
                         "rule-based-fallback", datetime.now(timezone.utc).isoformat()),
                    )
                    cache.commit()
                    print(f"  [{ticker}] {name} [rule-based-fallback]: saved")
                    done_rule += 1
                except Exception as e2:
                    print(f"  [{ticker}] fallback also failed: {e2}")
        else:
            # ── Rule-based path: no LLM call ───────────────────────────
            try:
                analysis_json, news_json = build_rule_based_analysis(
                    ticker=ticker, name=name, sector=sector,
                    market_ctx=market_ctx, pe_pb_avgs=pe_pb_avgs,
                    sector_avgs=sector_avgs, tech=tech,
                    valuation_models=valuation_models,
                    forecast_years=forecast_years,
                )
                cache.execute(
                    """
                    INSERT OR REPLACE INTO ai_financial_analysis
                        (ticker, year_report, quarter_report, analysis_vi,
                         analysis_json, news_json, model, generated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (ticker, analysis_year, analysis_q, name, analysis_json, news_json,
                     "rule-based", datetime.now(timezone.utc).isoformat()),
                )
                cache.commit()
                print(f"  [{ticker}] {name} [rule-based]: saved")
                done_rule += 1
            except Exception as e:
                print(f"  [{ticker}] rule-based ERROR: {e}")

    print(f"\nDone: {done_ai} AI + {done_rule} rule-based analyses for {quarter_label}")
    fin.close(); scr.close(); cmp.close(); cache.close()
    stats_conn.close()
    cmp_conn.close()
    if news_conn:
        news_conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ticker", nargs="+", help="Specific tickers to analyze")
    parser.add_argument("--limit", type=int, default=0, help="Max tickers to process")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--regen-missing", action="store_true",
                        help="Re-generate tickers that have analysis_vi but missing news_json (old format)")
    parser.add_argument("--force-news-refresh", action="store_true",
                        help="Re-run AI news analysis for every ticker with news in the last 14 days")
    notification_group = parser.add_mutually_exclusive_group()
    notification_group.add_argument(
        "--notify-telegram",
        dest="notify_telegram",
        action="store_true",
        help="Send one Telegram result for every successful AI analysis",
    )
    notification_group.add_argument(
        "--no-notify-telegram",
        dest="notify_telegram",
        action="store_false",
        help="Do not send Telegram AI-result notifications",
    )
    parser.set_defaults(notify_telegram=None)
    args = parser.parse_args()
    run(
        args.ticker,
        args.limit,
        args.dry_run,
        regen_missing=args.regen_missing,
        force_news_refresh=args.force_news_refresh,
        notify_telegram_results=args.notify_telegram,
    )
