#!/usr/bin/env python3
"""
Generate Gemma 4 AI analysis for new quarterly financial reports.

Run after fetch_vci_financial_statement.py to analyze newly added tickers.

Usage:
    python fetch_sqlite/generate_ai_analysis.py
    python fetch_sqlite/generate_ai_analysis.py --ticker VNM
    python fetch_sqlite/generate_ai_analysis.py --limit 20 --dry-run
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

from backend.services.gemma_client import build_financial_prompt, build_combined_prompt, generate
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

HOSE_HNX_EXCHANGES = ("HSX", "HNX")
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


def get_hose_hnx_tickers(scr: sqlite3.Connection) -> set[str]:
    rows = scr.execute(
        "SELECT ticker FROM screening_data WHERE exchange IN ('HSX','HNX')"
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


def count_new_news(news_conn: sqlite3.Connection, ticker: str, _since_iso: str = "") -> int:
    """Count news items for ticker in the last 14 days (rolling window)."""
    row = news_conn.execute(
        "SELECT COUNT(*) FROM news_items WHERE ticker=? AND update_date >= date('now', '-14 days')",
        (ticker,),
    ).fetchone()
    return int(row[0]) if row else 0


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
) -> None:
    """Parse combined JSON {valuation: ..., news_thesis: ...} and save to DB."""
    import json as _json, re as _re

    valuation_json = None
    news_json = None
    summary = combined_raw[:200]  # fallback

    text = _re.sub(r"```(?:json)?", "", combined_raw).strip().rstrip("`").strip()
    match = _re.search(r"\{.*\}", text, _re.DOTALL)
    if match:
        try:
            data = _json.loads(match.group())
            val_part = data.get("valuation")
            news_part = data.get("news_thesis")
            if val_part:
                valuation_json = _json.dumps(val_part, ensure_ascii=False)
                summary = val_part.get("valuation_summary", summary)
            if news_part:
                news_json = _json.dumps(news_part, ensure_ascii=False)
        except _json.JSONDecodeError:
            pass

    cache.execute(
        """
        INSERT OR REPLACE INTO ai_financial_analysis
            (ticker, year_report, quarter_report, analysis_vi, analysis_json, news_json, model, generated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (ticker, year, q, summary, valuation_json, news_json, model, datetime.now(timezone.utc).isoformat()),
    )
    cache.commit()


def run(tickers_override: list[str] | None, limit: int, dry_run: bool, regen_missing: bool = False) -> None:
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

    hose_hnx = get_hose_hnx_tickers(scr)
    names = get_company_names(cmp)

    if tickers_override:
        candidates = [t for t in tickers_override if t in hose_hnx]
    else:
        rows = fin.execute(
            "SELECT DISTINCT ticker FROM income_statement WHERE year_report=? AND quarter_report=?",
            (year, q),
        ).fetchall()
        candidates = [r[0] for r in rows if r[0] in hose_hnx]

    # Separate into new (never analyzed), refresh (news threshold), and regen (missing news_json)
    new_tickers = []
    refresh_tickers = []
    regen_tickers = []
    for t in candidates:
        last_at = get_last_analysis(cache, t, year, q)
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

    pending = new_tickers + refresh_tickers + regen_tickers
    print(
        f"Pending: {len(new_tickers)} new + {len(refresh_tickers)} news-refresh "
        f"+ {len(regen_tickers)} regen-missing "
        f"(skipping {len(candidates) - len(pending)} already done)"
    )

    if limit:
        pending = pending[:limit]

    done = 0
    for ticker in pending:
        data = fetch_stock_data(fin, ticker, year, q)
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
        valuation_models = fetch_valuation_models(ticker)

        sector_row = scr.execute(
            "SELECT viSector FROM screening_data WHERE ticker=?", (ticker,)
        ).fetchone()
        sector = sector_row[0] if sector_row and sector_row[0] else "Chứng khoán"

        pe_pb_valuation_keys = ("pe_2yr_avg", "pb_2yr_avg", "pe_5yr_avg", "pb_5yr_avg")
        combined_prompt = build_combined_prompt(
            ticker=ticker,
            name=name,
            sector=sector,
            quarter=quarter_label,
            forecast_years=forecast_years,
            technical=tech,
            valuation_models=valuation_models,
            news=recent_news or [],
            **{k: v for k, v in pe_pb_avgs.items() if k in pe_pb_valuation_keys},
            **sector_avgs,
            **market_ctx,
            **{k: v for k, v in data.items() if k in (
                "revenue", "revenue_yoy", "profit_yoy", "gross_margin"
            )},
        )

        if dry_run:
            print(f"  [{ticker}] DRY RUN — combined prompt {len(combined_prompt)} chars, news={len(recent_news)}, models={bool(valuation_models)}")
            continue

        for attempt in range(3):
            try:
                combined_raw, model_used = generate(combined_prompt)
                save_analysis(cache, ticker, year, q, combined_raw, model_used)
                print(f"  [{ticker}] {name} [{model_used}]: saved")
                done += 1
                time.sleep(RATE_LIMIT_DELAY)
                break
            except Exception as e:
                if attempt < 2:
                    wait = 60 * (attempt + 1)
                    print(f"  [{ticker}] ERROR (attempt {attempt+1}): {e} — retrying in {wait}s")
                    time.sleep(wait)
                else:
                    print(f"  [{ticker}] SKIP after 3 attempts: {e}")

    print(f"\nDone: {done} analyses generated for {quarter_label}")
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
    args = parser.parse_args()
    run(args.ticker, args.limit, args.dry_run, regen_missing=args.regen_missing)
