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

from backend.services.gemma_client import build_financial_prompt, generate

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


def count_new_news(news_conn: sqlite3.Connection, ticker: str, since_iso: str) -> int:
    """Count market news items for ticker published after since_iso date."""
    row = news_conn.execute(
        "SELECT COUNT(*) FROM news_items WHERE ticker=? AND update_date > ?",
        (ticker, since_iso[:10]),
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
    cache: sqlite3.Connection, ticker: str, year: int, q: int, raw: str, model: str
) -> None:
    summary, analysis_json = parse_analysis(raw)
    cache.execute(
        """
        INSERT OR REPLACE INTO ai_financial_analysis
            (ticker, year_report, quarter_report, analysis_vi, analysis_json, model, generated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (ticker, year, q, summary, analysis_json, model, datetime.now(timezone.utc).isoformat()),
    )
    cache.commit()


def run(tickers_override: list[str] | None, limit: int, dry_run: bool) -> None:
    fin = sqlite3.connect(f"file:{FINANCIALS_DB}?mode=ro", uri=True)
    scr = sqlite3.connect(f"file:{SCREENING_DB}?mode=ro", uri=True)
    cmp = sqlite3.connect(f"file:{COMPANY_DB}?mode=ro", uri=True)
    cache = sqlite3.connect(CACHE_DB)
    news_conn = sqlite3.connect(f"file:{MARKET_NEWS_DB}?mode=ro", uri=True) if MARKET_NEWS_DB else None

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

    # Separate into new (never analyzed) and refresh (news threshold exceeded)
    new_tickers = []
    refresh_tickers = []
    for t in candidates:
        last_at = get_last_analysis(cache, t, year, q)
        if last_at is None:
            new_tickers.append(t)
        elif news_conn and count_new_news(news_conn, t, last_at) >= NEWS_REFRESH_THRESHOLD:
            refresh_tickers.append(t)

    pending = new_tickers + refresh_tickers
    print(
        f"Pending: {len(new_tickers)} new + {len(refresh_tickers)} news-refresh "
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
        recent_news = fetch_recent_news(news_conn, ticker) if news_conn else []
        prompt = build_financial_prompt(
            ticker=ticker,
            name=name,
            quarter=quarter_label,
            news=recent_news,
            **data,
        )

        if dry_run:
            print(f"  [{ticker}] DRY RUN — would generate analysis (news={len(recent_news)})")
            continue

        try:
            analysis, model = generate(prompt)
            save_analysis(cache, ticker, year, q, analysis, model)
            print(f"  [{ticker}] {name} [{model}]: {analysis[:80]}...")
            done += 1
            time.sleep(RATE_LIMIT_DELAY)
        except Exception as e:
            print(f"  [{ticker}] ERROR: {e}")

    print(f"\nDone: {done} analyses generated for {quarter_label}")
    fin.close(); scr.close(); cmp.close(); cache.close()
    if news_conn:
        news_conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ticker", nargs="+", help="Specific tickers to analyze")
    parser.add_argument("--limit", type=int, default=0, help="Max tickers to process")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(args.ticker, args.limit, args.dry_run)
