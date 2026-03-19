from __future__ import annotations

import os
import sqlite3
from typing import Any, Callable


def standouts_join_with_screener(
    *,
    screener_db_path: str,
    ticker_info: list[dict[str, Any]],
    max_positive: int = 5,
) -> list[dict[str, Any]]:
    if not screener_db_path or not os.path.exists(screener_db_path):
        return []

    if not ticker_info:
        return []

    tickers = [item.get("ticker") for item in ticker_info if item.get("ticker")]
    if not tickers:
        return []

    placeholders = ",".join(["?"] * len(tickers))
    with sqlite3.connect(screener_db_path) as conn:
        conn.row_factory = sqlite3.Row
        query = f"SELECT * FROM screening_data WHERE ticker IN ({placeholders})"
        rows = conn.execute(query, tickers).fetchall()

    db_data = {r["ticker"]: dict(r) for r in rows}

    results: list[dict[str, Any]] = []
    for item in ticker_info:
        if item.get("sentiment") != "Positive":
            continue
        ticker = item.get("ticker")
        if not ticker:
            continue
        if ticker in db_data:
            entry = db_data[ticker]
            entry["stockStrength"] = item.get("score", 0)
            entry["sentiment"] = item.get("sentiment", "")
            entry["logo"] = item.get("logo", "")
            results.append(entry)
            if len(results) >= max_positive:
                break

    return results


def fetch_standouts_upstream(
    *,
    http_get: Callable[..., Any],
    timeout_s: int = 10,
) -> list[dict[str, Any]]:
    """Fetch ticker_info list from ai.vietcap.com.vn (best-effort)."""
    url = "https://ai.vietcap.com.vn/api/get_top_tickers?top_neg=5&top_pos=5&group=hose"
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://trading.vietcap.com.vn",
        "Referer": "https://trading.vietcap.com.vn/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }
    try:
        r = http_get(url, headers=headers, timeout=timeout_s)
        r.raise_for_status()
        return list((r.json() or {}).get("ticker_info", []) or [])
    except Exception:
        return []
