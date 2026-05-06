from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone
from typing import Any

from flask import Blueprint, jsonify

from .deps import cache_func
from .paths import company_db_path, financials_db_path, screener_db_path

logger = logging.getLogger(__name__)

_CACHE_SECONDS = 1800  # 30 minutes
_MIN_BASE_VALUE = 1e10  # 10 billion VND — filter tiny companies from top-growers


def _detect_current_quarter(fin_conn: sqlite3.Connection) -> tuple[int, int]:
    """Return the most recent (year, quarter) that has data, excluding annual (quarter=0)."""
    row = fin_conn.execute(
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
    if row is None:
        now = datetime.now(timezone.utc)
        return now.year, (now.month - 1) // 3 or 1
    return int(row[0]), int(row[1])


def _prev_year_quarter(year: int, q: int) -> tuple[int, int]:
    return year - 1, q


def _prev_quarter(year: int, q: int) -> tuple[int, int]:
    if q == 1:
        return year - 1, 4
    return year, q - 1


def _load_company_names(company_db: str) -> dict[str, str]:
    try:
        conn = sqlite3.connect(f"file:{company_db}?mode=ro", uri=True)
        rows = conn.execute("SELECT ticker, short_name FROM companies").fetchall()
        conn.close()
        return {r[0]: r[1] for r in rows}
    except Exception:
        return {}


def _load_hose_hnx_tickers(screener_db: str) -> dict[str, float]:
    """Return {ticker: marketCap} for HOSE+HNX only."""
    conn = sqlite3.connect(f"file:{screener_db}?mode=ro", uri=True)
    rows = conn.execute(
        "SELECT ticker, marketCap FROM screening_data WHERE exchange IN ('HSX', 'HNX')"
    ).fetchall()
    conn.close()
    return {r[0]: float(r[1] or 0) for r in rows}


def _top_growers(
    fin_conn: sqlite3.Connection,
    column: str,
    cur_year: int,
    cur_q: int,
    prev_year: int,
    prev_q: int,
    allowed_tickers: set[str],
    names: dict[str, str],
    limit: int = 5,
) -> list[dict[str, Any]]:
    rows = fin_conn.execute(
        f"""
        SELECT cur.ticker, cur.{column} AS cur_val, prv.{column} AS prv_val
        FROM income_statement cur
        JOIN income_statement prv
          ON cur.ticker = prv.ticker
         AND prv.year_report = ?
         AND prv.quarter_report = ?
        WHERE cur.year_report = ?
          AND cur.quarter_report = ?
          AND prv.{column} > ?
          AND cur.{column} IS NOT NULL
        """,
        (prev_year, prev_q, cur_year, cur_q, _MIN_BASE_VALUE),
    ).fetchall()

    results = []
    for ticker, cur_val, prv_val in rows:
        if ticker not in allowed_tickers:
            continue
        if not prv_val or prv_val == 0:
            continue
        growth_pct = (cur_val - prv_val) / abs(prv_val) * 100
        results.append(
            {
                "ticker": ticker,
                "name": names.get(ticker, ticker),
                "growth_pct": round(growth_pct, 1),
                "base_value": round(prv_val),
                "current_value": round(cur_val),
            }
        )

    results.sort(key=lambda x: x["growth_pct"], reverse=True)
    return results[:limit]


def compute_earnings_season() -> dict[str, Any]:
    fin_db = financials_db_path()
    scr_db = screener_db_path()
    cmp_db = company_db_path()

    fin_conn = sqlite3.connect(f"file:{fin_db}?mode=ro", uri=True)

    try:
        cur_year, cur_q = _detect_current_quarter(fin_conn)
        hose_hnx = _load_hose_hnx_tickers(scr_db)
        names = _load_company_names(cmp_db)
        allowed = set(hose_hnx.keys())
        total_market_cap = sum(hose_hnx.values())

        # Reported tickers in current quarter that are in HOSE/HNX
        reported_rows = fin_conn.execute(
            "SELECT DISTINCT ticker FROM income_statement WHERE year_report=? AND quarter_report=?",
            (cur_year, cur_q),
        ).fetchall()
        reported_tickers = {r[0] for r in reported_rows} & allowed

        reported_count = len(reported_tickers)
        total_count = len(allowed)
        reported_pct = round(reported_count / total_count * 100, 1) if total_count else 0

        reported_cap = sum(hose_hnx.get(t, 0) for t in reported_tickers)
        market_cap_pct = round(reported_cap / total_market_cap * 100, 1) if total_market_cap else 0

        py_year, py_q = _prev_year_quarter(cur_year, cur_q)
        pq_year, pq_q = _prev_quarter(cur_year, cur_q)

        return {
            "quarter": f"Q{cur_q}.{cur_year}",
            "year": cur_year,
            "q": cur_q,
            "reported_count": reported_count,
            "total_count": total_count,
            "reported_pct": reported_pct,
            "market_cap_pct": market_cap_pct,
            "top_revenue_yoy": _top_growers(fin_conn, "isa1", cur_year, cur_q, py_year, py_q, allowed, names),
            "top_revenue_qoq": _top_growers(fin_conn, "isa1", cur_year, cur_q, pq_year, pq_q, allowed, names),
            "top_profit_yoy": _top_growers(fin_conn, "isa22", cur_year, cur_q, py_year, py_q, allowed, names),
            "top_profit_qoq": _top_growers(fin_conn, "isa22", cur_year, cur_q, pq_year, pq_q, allowed, names),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    finally:
        fin_conn.close()


def register(market_bp: Blueprint) -> None:
    @market_bp.route("/earnings-season")
    def api_earnings_season():
        cache_key = "earnings_season_v1"

        def fetch():
            return compute_earnings_season()

        try:
            data, is_cached = cache_func()(cache_key, _CACHE_SECONDS, fetch)
            resp = jsonify(data)
            resp.headers["X-Cache"] = "HIT" if is_cached else "MISS"
            return resp
        except Exception as e:
            logger.error(f"Earnings season error: {e}")
            return jsonify({"error": str(e)}), 500
