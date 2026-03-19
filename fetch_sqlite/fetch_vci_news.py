#!/usr/bin/env python3
"""Fetch VCI AI news into SQLite for fast API reads.

This script is designed to be run periodically (e.g. every 5 minutes) and
upsert the latest news items into a local SQLite database.

It complements the API endpoint /api/market/news by making it read from SQLite
instead of calling the upstream VCI API on every request.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import random
import sqlite3
import time
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Iterable

import requests


NEWS_API_URL = "https://ai.vietcap.com.vn/api/v3/news_info"


def utc_now_iso() -> str:
    return dt.datetime.now(tz=dt.timezone.utc).replace(microsecond=0).isoformat()


def _headers() -> dict[str, str]:
    # Mirrors headers used in backend/services/news_service.py
    return {
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://trading.vietcap.com.vn",
        "Referer": "https://trading.vietcap.com.vn/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }


def _request_json(
    url: str,
    *,
    params: dict[str, Any],
    timeout_s: int,
    retries: int,
    backoff_base_s: float,
    verify_ssl: bool,
) -> Any:
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            r = requests.get(
                url,
                params=params,
                headers=_headers(),
                timeout=timeout_s,
                verify=verify_ssl,
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001 - keep CLI resilient
            last_err = e
            if attempt >= retries:
                break
            sleep_s = backoff_base_s * (2**attempt) + random.random() * 0.25
            time.sleep(sleep_s)
    if last_err is not None:
        raise last_err
    raise RuntimeError("request_json failed without exception")


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS news_items (
            id TEXT PRIMARY KEY,
            ticker TEXT,
            industry TEXT,
            news_title TEXT,
            news_short_content TEXT,
            news_source_link TEXT,
            news_image_url TEXT,
            update_date TEXT,
            news_from TEXT,
            news_from_name TEXT,
            sentiment TEXT,
            score REAL,
            slug TEXT,
            male_audio_duration REAL,
            female_audio_duration REAL,
            raw_json TEXT,
            fetched_at_utc TEXT
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_news_items_ticker_date ON news_items (ticker, update_date)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_news_items_date ON news_items (update_date)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS news_meta (
            key TEXT PRIMARY KEY,
            value TEXT
        )
        """
    )


def _get_first(item: dict[str, Any], keys: Iterable[str]) -> Any:
    for k in keys:
        if k in item and item[k] is not None:
            return item[k]
    return None


def upsert_items(conn: sqlite3.Connection, items: list[dict[str, Any]], fetched_at_utc: str) -> tuple[int, int]:
    """Return (upserted, skipped)."""
    changed = 0
    skipped = 0

    sql = (
        """
        INSERT INTO news_items (
            id, ticker, industry, news_title, news_short_content,
            news_source_link, news_image_url, update_date,
            news_from, news_from_name, sentiment, score, slug,
            male_audio_duration, female_audio_duration, raw_json, fetched_at_utc
        ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?
        )
        ON CONFLICT(id) DO UPDATE SET
            ticker=excluded.ticker,
            industry=excluded.industry,
            news_title=excluded.news_title,
            news_short_content=excluded.news_short_content,
            news_source_link=excluded.news_source_link,
            news_image_url=excluded.news_image_url,
            update_date=excluded.update_date,
            news_from=excluded.news_from,
            news_from_name=excluded.news_from_name,
            sentiment=excluded.sentiment,
            score=excluded.score,
            slug=excluded.slug,
            male_audio_duration=excluded.male_audio_duration,
            female_audio_duration=excluded.female_audio_duration,
            raw_json=excluded.raw_json,
            fetched_at_utc=excluded.fetched_at_utc
        """
    )

    for item in items:
        news_id = _get_first(item, ["id", "news_id", "_id"])  # API uses `id` today
        if not news_id:
            skipped += 1
            continue

        row = (
            str(news_id),
            (item.get("ticker") or "").upper(),
            item.get("industry") or "",
            item.get("news_title") or item.get("title") or "",
            item.get("news_short_content") or "",
            item.get("news_source_link") or item.get("url") or "",
            item.get("news_image_url") or item.get("image_url") or "",
            item.get("update_date") or item.get("publish_date") or "",
            item.get("news_from") or "",
            item.get("news_from_name") or item.get("source") or "",
            item.get("sentiment") or "",
            item.get("score") if item.get("score") is not None else None,
            item.get("slug") or "",
            item.get("male_audio_duration") if item.get("male_audio_duration") is not None else None,
            item.get("female_audio_duration") if item.get("female_audio_duration") is not None else None,
            json.dumps(item, ensure_ascii=False),
            fetched_at_utc,
        )
        conn.execute(sql, row)
        changed += 1

    return changed, skipped


def fetch_news_page(
    *,
    ticker: str,
    page: int,
    page_size: int,
    days_back: int,
    timeout_s: int,
    retries: int,
    backoff_base_s: float,
    verify_ssl: bool,
) -> list[dict[str, Any]]:
    end_date = dt.datetime.now()
    start_date = end_date - dt.timedelta(days=days_back)
    params = {
        "page": page,
        "ticker": ticker,
        "industry": "",
        "update_from": start_date.strftime("%Y-%m-%d"),
        "update_to": end_date.strftime("%Y-%m-%d"),
        "sentiment": "",
        "newsfrom": "",
        "language": "vi",
        "page_size": page_size,
    }
    data = _request_json(
        NEWS_API_URL,
        params=params,
        timeout_s=timeout_s,
        retries=retries,
        backoff_base_s=backoff_base_s,
        verify_ssl=verify_ssl,
    )
    return list(data.get("news_info", []) or [])


def fetch_to_sqlite(
    *,
    db_path: str,
    ticker: str,
    pages: int,
    page_size: int,
    days_back: int,
    timeout_s: int,
    retries: int,
    backoff_base_s: float,
    verify_ssl: bool,
    workers: int,
    prune_days: int,
) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(db_path)) or ".", exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=30)
    try:
        ensure_schema(conn)
        fetched_at = utc_now_iso()

        total_changed = 0
        total_skipped = 0

        pages = max(1, int(pages or 1))
        workers = max(1, int(workers or 1))
        page_size = min(max(int(page_size or 50), 1), 50)
        tasks = list(range(1, pages + 1))

        def _fetch(p: int) -> tuple[int, list[dict[str, Any]]]:
            items = fetch_news_page(
                ticker=ticker,
                page=p,
                page_size=page_size,
                days_back=days_back,
                timeout_s=timeout_s,
                retries=retries,
                backoff_base_s=backoff_base_s,
                verify_ssl=verify_ssl,
            )
            return p, items

        if workers <= 1:
            for p in tasks:
                _, items = _fetch(p)
                changed, skipped = upsert_items(conn, items, fetched_at)
                total_changed += changed
                total_skipped += skipped
                print(f"Page {p}: {len(items)} items | upserted {changed} | skipped {skipped}")
        else:
            with ThreadPoolExecutor(max_workers=workers) as ex:
                fut_map = {ex.submit(_fetch, p): p for p in tasks}
                for fut in as_completed(fut_map):
                    p, items = fut.result()
                    changed, skipped = upsert_items(conn, items, fetched_at)
                    total_changed += changed
                    total_skipped += skipped
                    print(f"Page {p}: {len(items)} items | upserted {changed} | skipped {skipped}")

        conn.execute(
            "INSERT INTO news_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            ("last_fetch_utc", fetched_at),
        )
        conn.execute(
            "INSERT INTO news_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            ("last_fetch_ticker", ticker.upper()),
        )

        prune_days = int(prune_days or 0)
        if prune_days > 0:
            threshold = (dt.datetime.now(tz=dt.timezone.utc) - dt.timedelta(days=prune_days)).replace(microsecond=0).isoformat()
            cur = conn.execute("DELETE FROM news_items WHERE fetched_at_utc < ?", (threshold,))
            conn.execute(
                "INSERT INTO news_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                ("prune_threshold_utc", threshold),
            )
            print(f"Prune: deleted {cur.rowcount} rows older than {threshold}")

        conn.commit()

        print(f"Done. upserted {total_changed} | skipped {total_skipped} | db={db_path} | workers={workers}")
    finally:
        conn.close()


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fetch VCI AI news and store into SQLite")
    p.add_argument("--db", default="fetch_sqlite/vci_ai_news.sqlite", help="SQLite db file path")
    p.add_argument("--ticker", default="", help="Ticker symbol (empty for general market news)")
    p.add_argument("--pages", type=int, default=5, help="Number of pages to fetch (starting from page=1)")
    p.add_argument("--page-size", type=int, default=50, help="Page size")
    p.add_argument("--days-back", type=int, default=30, help="How many days back to query")
    p.add_argument(
        "--prune-days",
        type=int,
        default=0,
        help="Delete rows whose fetched_at_utc is older than N days (0 disables pruning)",
    )
    p.add_argument("--workers", type=int, default=1, help="Number of threads for fetching pages")
    p.add_argument("--timeout", type=int, default=15, help="HTTP timeout in seconds")
    p.add_argument("--retries", type=int, default=4, help="Retry count for transient errors")
    p.add_argument("--backoff", type=float, default=0.8, help="Retry backoff base seconds")
    p.add_argument(
        "--insecure",
        action="store_true",
        help="Disable SSL verification (matches backend NewsService behavior)",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    fetch_to_sqlite(
        db_path=args.db,
        ticker=(args.ticker or "").strip().upper(),
        pages=args.pages,
        page_size=args.page_size,
        days_back=args.days_back,
        timeout_s=args.timeout,
        retries=args.retries,
        backoff_base_s=args.backoff,
        verify_ssl=not args.insecure,
        workers=args.workers,
        prune_days=args.prune_days,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
