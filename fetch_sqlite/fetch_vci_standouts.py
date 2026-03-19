#!/usr/bin/env python3
"""Fetch VCI AI standouts (top tickers) into SQLite.

Purpose: /api/market/standouts should not call upstream ai.vietcap.com.vn every
request. Instead, run this script periodically (e.g. hourly) to cache the
`ticker_info` payload and let the API join it with local vci_screening.sqlite.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import random
import sqlite3
import time
from typing import Any

import requests


API_URL = "https://ai.vietcap.com.vn/api/get_top_tickers"


def utc_now_iso() -> str:
    return dt.datetime.now(tz=dt.timezone.utc).replace(microsecond=0).isoformat()


def _headers() -> dict[str, str]:
    return {
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://trading.vietcap.com.vn",
        "Referer": "https://trading.vietcap.com.vn/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }


def request_json(
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
                API_URL,
                params=params,
                headers=_headers(),
                timeout=timeout_s,
                verify=verify_ssl,
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt >= retries:
                break
            time.sleep(backoff_base_s * (2**attempt) + random.random() * 0.25)
    if last_err is not None:
        raise last_err
    raise RuntimeError("request_json failed without exception")


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS standouts_snapshot (
            key TEXT PRIMARY KEY,
            group_name TEXT,
            raw_json TEXT,
            fetched_at_utc TEXT
        )
        """
    )


def write_snapshot(
    conn: sqlite3.Connection,
    *,
    key: str,
    group_name: str,
    payload: dict[str, Any],
    fetched_at_utc: str,
) -> None:
    conn.execute(
        """
        INSERT INTO standouts_snapshot(key, group_name, raw_json, fetched_at_utc)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            group_name=excluded.group_name,
            raw_json=excluded.raw_json,
            fetched_at_utc=excluded.fetched_at_utc
        """,
        (key, group_name, json.dumps(payload, ensure_ascii=False), fetched_at_utc),
    )


def fetch_to_sqlite(
    *,
    db_path: str,
    group_name: str,
    top_pos: int,
    top_neg: int,
    timeout_s: int,
    retries: int,
    backoff_base_s: float,
    verify_ssl: bool,
) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(db_path)) or ".", exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=30)
    try:
        ensure_schema(conn)
        fetched_at = utc_now_iso()

        params = {"top_neg": top_neg, "top_pos": top_pos, "group": group_name}
        payload = request_json(
            params=params,
            timeout_s=timeout_s,
            retries=retries,
            backoff_base_s=backoff_base_s,
            verify_ssl=verify_ssl,
        )
        write_snapshot(
            conn,
            key="vci_ai_standouts",
            group_name=group_name,
            payload=payload,
            fetched_at_utc=fetched_at,
        )
        conn.commit()

        ticker_count = len((payload or {}).get("ticker_info", []) or [])
        print(f"Done. tickers={ticker_count} | db={db_path} | group={group_name} | fetched_at={fetched_at}")
    finally:
        conn.close()


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fetch VCI AI standouts and store into SQLite")
    p.add_argument("--db", default="fetch_sqlite/vci_ai_standouts.sqlite", help="SQLite db file path")
    p.add_argument("--group", default="hose", help="Group name (e.g. hose)")
    p.add_argument("--top-pos", type=int, default=5, help="Number of positive tickers")
    p.add_argument("--top-neg", type=int, default=5, help="Number of negative tickers")
    p.add_argument("--timeout", type=int, default=15, help="HTTP timeout in seconds")
    p.add_argument("--retries", type=int, default=4, help="Retry count")
    p.add_argument("--backoff", type=float, default=0.8, help="Retry backoff base seconds")
    p.add_argument(
        "--insecure",
        action="store_true",
        help="Disable SSL verification",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    fetch_to_sqlite(
        db_path=args.db,
        group_name=(args.group or "hose").strip(),
        top_pos=args.top_pos,
        top_neg=args.top_neg,
        timeout_s=args.timeout,
        retries=args.retries,
        backoff_base_s=args.backoff,
        verify_ssl=not args.insecure,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
