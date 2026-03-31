#!/usr/bin/env python3
"""Fetch Vietcap screening/paging data into SQLite."""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import random
import sqlite3
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.cookiejar import CookieJar
from typing import Any


API_URL = "https://iq.vietcap.com.vn/api/iq-insight-service/v1/screening/paging"


def utc_now_iso() -> str:
    return dt.datetime.now(tz=dt.timezone.utc).replace(microsecond=0).isoformat()


def random_device_id_hex(n_bytes: int = 12) -> str:
    return "".join(f"{random.randrange(256):02x}" for _ in range(n_bytes))


def build_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))


def default_headers(device_id: str) -> dict[str, str]:
    return {
        "accept": "application/json",
        "content-type": "application/json",
        "accept-language": "en-US,en;q=0.9,vi-VN;q=0.8,vi;q=0.7",
        "user-agent": (
            "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/145.0.0.0 Mobile Safari/537.36"
        ),
        "origin": "https://trading.vietcap.com.vn",
        "referer": "https://trading.vietcap.com.vn/",
        "device-id": device_id,
        "x-requested-with": "XMLHttpRequest",
        "accept-encoding": "gzip",
        "connection": "keep-alive",
    }


def read_json_response(resp: urllib.response.addinfourl) -> Any:
    raw = resp.read()
    if "gzip" in (resp.headers.get("Content-Encoding", "").lower()):
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8", errors="replace"))


def request_post_json(
    opener: urllib.request.OpenerDirector,
    url: str,
    headers: dict[str, str],
    body: dict[str, Any],
    *,
    timeout_s: int = 30,
    retries: int = 6,
    backoff_base_s: float = 0.8,
) -> Any:
    payload = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url=url, data=payload, headers=headers, method="POST")
            with opener.open(req, timeout=timeout_s) as resp:
                return read_json_response(resp)
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code not in (429, 500, 502, 503, 504) or attempt >= retries:
                raise
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_err = e
            if attempt >= retries:
                raise
        time.sleep(backoff_base_s * (2**attempt) + random.random() * 0.25)
    if last_err:
        raise last_err
    raise RuntimeError("request_post_json failed without exception")


def to_float(v: Any) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.strip().replace(",", "")
        if not s:
            return None
        try:
            return float(s)
        except ValueError:
            return None
    return None


def default_filter_payload() -> list[dict[str, Any]]:
    return [
        {"name": "sectorLv1"},
        {"name": "exchange"},
        {"name": "marketCap", "conditionOptions": [{"from": 0, "to": 2_000_000_000_000_000}]},
        {"name": "marketPrice", "conditionOptions": [{"from": 0, "to": 2_000_000}]},
        {"name": "dailyPriceChangePercent", "conditionOptions": [{"from": -15, "to": 15}]},
        {"name": "adtv", "extraName": "30Days", "conditionOptions": [{"from": 0, "to": 2_000_000_000_000}]},
        {"name": "avgVolume", "extraName": "30Days", "conditionOptions": [{"from": 0, "to": 200_000_000}]},
        {
            "name": "esVolumeVsAvgVolume",
            "extraName": "30Days",
            "conditionOptions": [{"from": -900, "to": 900}],
        },
        {"name": "ttmPe", "conditionOptions": [{"from": -10000, "to": 10000}]},
        {"name": "ttmPb", "conditionOptions": [{"from": -1000, "to": 10000}]},
        {"name": "ttmRoe", "conditionOptions": [{"from": -1000, "to": 1000}]},
        {
            "name": "npatmiGrowth",
            "extraName": "Yoy",
            "extraName2": "Qm1",
            "conditionOptions": [{"from": -10000, "to": 100000}],
        },
        {"name": "revenueGrowth", "extraName": "Yoy", "conditionOptions": [{"from": -10000, "to": 100000}]},
        {"name": "netMargin", "conditionOptions": [{"from": -1000, "to": 1000}]},
        {"name": "grossMargin", "conditionOptions": [{"from": -1000, "to": 1000}]},
    ]


def build_payload(page: int, page_size: int, filters: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "page": page,
        "pageSize": page_size,
        "sortFields": [],
        "sortOrders": [],
        "filter": filters,
    }


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS screening_data (
          ticker                    TEXT PRIMARY KEY,
          exchange                  TEXT,
          refPrice                  REAL,
          ceiling                   REAL,
          marketPrice               REAL,
          floor                     REAL,
          accumulatedValue          REAL,
          accumulatedVolume         REAL,
          marketCap                 REAL,
          dailyPriceChangePercent   REAL,
          adtv30Days                REAL,
          tradingValueAdtv10Days    REAL,
          avgVolume30Days           REAL,
          estVolume                 REAL,
          esVolumeVsAvgVolume30Days REAL,
          ttmPe                     REAL,
          ttmPb                     REAL,
          ttmRoe                    REAL,
          npatmiGrowthYoyQm1        REAL,
          revenueGrowthYoy          REAL,
          netMargin                 REAL,
          grossMargin               REAL,
          matchPriceTime            TEXT,
          emaTime                   TEXT,
          lastModifiedDate          TEXT,
          enOrganName               TEXT,
          enOrganShortName          TEXT,
          viOrganName               TEXT,
          viOrganShortName          TEXT,
          icbCodeLv2                TEXT,
          enSector                  TEXT,
          viSector                  TEXT,
          icbCodeLv4                TEXT,
          stockStrength             REAL,
          raw_json                  TEXT NOT NULL,
          fetched_at                TEXT NOT NULL
        );
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS meta (
          k TEXT PRIMARY KEY,
          v TEXT NOT NULL
        );
        """
    )
    _ensure_missing_columns(conn, "screening_data", {
        "adtv30Days": "REAL",
        "avgVolume30Days": "REAL",
        "esVolumeVsAvgVolume30Days": "REAL",
        "ttmPe": "REAL",
        "ttmPb": "REAL",
        "ttmRoe": "REAL",
        "npatmiGrowthYoyQm1": "REAL",
        "revenueGrowthYoy": "REAL",
        "netMargin": "REAL",
        "grossMargin": "REAL",
    })
    conn.commit()


def _ensure_missing_columns(conn: sqlite3.Connection, table: str, columns: dict[str, str]) -> None:
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    for name, col_type in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {col_type}")


def upsert_items(conn: sqlite3.Connection, items: list[dict[str, Any]], fetched_at: str) -> tuple[int, int]:
    cols = [
        "ticker",
        "exchange",
        "refPrice",
        "ceiling",
        "marketPrice",
        "floor",
        "accumulatedValue",
        "accumulatedVolume",
        "marketCap",
        "dailyPriceChangePercent",
        "adtv30Days",
        "tradingValueAdtv10Days",
        "avgVolume30Days",
        "estVolume",
        "esVolumeVsAvgVolume30Days",
        "ttmPe",
        "ttmPb",
        "ttmRoe",
        "npatmiGrowthYoyQm1",
        "revenueGrowthYoy",
        "netMargin",
        "grossMargin",
        "matchPriceTime",
        "emaTime",
        "lastModifiedDate",
        "enOrganName",
        "enOrganShortName",
        "viOrganName",
        "viOrganShortName",
        "icbCodeLv2",
        "enSector",
        "viSector",
        "icbCodeLv4",
        "stockStrength",
        "raw_json",
        "fetched_at",
    ]
    numeric_cols = {
        "refPrice",
        "ceiling",
        "marketPrice",
        "floor",
        "accumulatedValue",
        "accumulatedVolume",
        "marketCap",
        "dailyPriceChangePercent",
        "adtv30Days",
        "tradingValueAdtv10Days",
        "avgVolume30Days",
        "estVolume",
        "esVolumeVsAvgVolume30Days",
        "ttmPe",
        "ttmPb",
        "ttmRoe",
        "npatmiGrowthYoyQm1",
        "revenueGrowthYoy",
        "netMargin",
        "grossMargin",
        "stockStrength",
    }
    placeholders = ",".join(["?"] * len(cols))
    updates = ",".join([f"{c}=excluded.{c}" for c in cols if c != "ticker"])
    sql = f"INSERT INTO screening_data ({','.join(cols)}) VALUES ({placeholders}) ON CONFLICT(ticker) DO UPDATE SET {updates}"

    changed = 0
    skipped = 0
    cur = conn.cursor()

    for item in items:
        ticker = item.get("ticker")
        if not ticker:
            skipped += 1
            continue

        row: dict[str, Any] = {
            "ticker": str(ticker),
            "raw_json": json.dumps(item, ensure_ascii=False),
            "fetched_at": fetched_at,
        }
        for c in cols:
            if c in ("ticker", "raw_json", "fetched_at"):
                continue
            v = item.get(c)
            row[c] = to_float(v) if c in numeric_cols else (str(v) if v is not None else None)

        cur.execute(sql, tuple(row.get(c) for c in cols))
        changed += 1

    conn.commit()
    return changed, skipped


def fetch_to_sqlite(
    *,
    start_page: int,
    end_page: int | None,
    page_size: int,
    db_path: str,
    device_id: str | None,
    timeout_s: int,
    retries: int,
    backoff_base_s: float,
    sleep_between_pages_s: float,
    disable_filter: bool,
    workers: int = 1,
) -> None:
    if start_page < 0:
        raise ValueError("start_page must be >= 0")
    if page_size <= 0:
        raise ValueError("page_size must be > 0")
    if end_page is not None and end_page < start_page:
        raise ValueError("end_page must be >= start_page")

    base_opener = build_opener()
    headers = default_headers(device_id or random_device_id_hex())
    filters = [] if disable_filter else default_filter_payload()

    conn = sqlite3.connect(db_path)
    try:
        ensure_schema(conn)
        conn.execute(
            "INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
            ("last_run_utc", utc_now_iso()),
        )
        conn.commit()

        total_changed = 0
        total_skipped = 0

        def _fetch_single_page(p: int) -> tuple[int, list[dict[str, Any]], int | None]:
            # Use a new openener per thread to avoid state conflicts
            op = build_opener()
            body = build_payload(page=p, page_size=page_size, filters=filters)
            payload = request_post_json(
                opener=op,
                url=API_URL,
                headers=headers,
                body=body,
                timeout_s=timeout_s,
                retries=retries,
                backoff_base_s=backoff_base_s,
            )
            if not isinstance(payload, dict):
                raise RuntimeError(f"Unexpected response type: {type(payload)}")
            if payload.get("status") not in (200, None) or payload.get("successful") is False:
                raise RuntimeError(f"API returned failure: {payload.get('msg')!r}")

            data = payload.get("data") or {}
            content = data.get("content") or []
            return p, content, data.get("totalPages")

        # 1. Fetch start_page to get total pages
        page_num, content, total_pages = _fetch_single_page(start_page)
        fetched_at = utc_now_iso()
        changed, skipped = upsert_items(conn, content, fetched_at)
        total_changed += changed
        total_skipped += skipped
        print(f"Page {start_page}: {len(content)} rows | upserted {changed} | skipped {skipped} | totalPages={total_pages}")

        if not total_pages:
            total_pages = 1

        target_end_page = total_pages - 1
        if end_page is not None:
            target_end_page = min(end_page, target_end_page)

        pages_to_fetch = list(range(start_page + 1, target_end_page + 1))

        if not pages_to_fetch:
            # We already fetched everything needed
            pass
        elif workers <= 1:
            for p in pages_to_fetch:
                _, p_content, _ = _fetch_single_page(p)
                f_at = utc_now_iso()
                c, s = upsert_items(conn, p_content, f_at)
                total_changed += c
                total_skipped += s
                print(f"Page {p}: {len(p_content)} rows | upserted {c} | skipped {s}")
                if sleep_between_pages_s > 0:
                    time.sleep(sleep_between_pages_s)
        else:
            with ThreadPoolExecutor(max_workers=workers) as ex:
                future_map = {ex.submit(_fetch_single_page, p): p for p in pages_to_fetch}
                for fut in as_completed(future_map):
                    p, p_content, _ = fut.result()
                    f_at = utc_now_iso()
                    c, s = upsert_items(conn, p_content, f_at)
                    total_changed += c
                    total_skipped += s
                    print(f"Page {p}: {len(p_content)} rows | upserted {c} | skipped {s}")

        print(
            f"Done. upserted {total_changed} "
            f"| skipped {total_skipped} | db={db_path}"
        )
    finally:
        conn.close()


def sync_financial_metrics(db_path: str) -> None:
    """Populate NULL financial columns in screening_data from sibling SQLite files."""
    import os
    db_dir = os.path.dirname(os.path.abspath(db_path))

    sf_path = os.path.join(db_dir, "vci_stats_financial.sqlite")
    stocks_candidates = [
        os.path.join(os.path.dirname(db_dir), "vietnam_stocks.db"),
        "/var/www/valuation/vietnam_stocks.db",
        "/var/www/store/vietnam_stocks.db",
    ]
    stocks_path = next((p for p in stocks_candidates if os.path.exists(p)), None)

    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA journal_mode=WAL;")

        # --- PE, PB, ROE, margins from vci_stats_financial.sqlite ---
        if os.path.exists(sf_path):
            try:
                conn.execute(f"ATTACH DATABASE '{sf_path}' AS sf")
                conn.execute("""
                    UPDATE screening_data
                    SET
                        ttmPe      = (SELECT sf.pe               FROM sf.stats_financial sf WHERE UPPER(sf.ticker) = UPPER(screening_data.ticker)),
                        ttmPb      = (SELECT sf.pb               FROM sf.stats_financial sf WHERE UPPER(sf.ticker) = UPPER(screening_data.ticker)),
                        ttmRoe     = (SELECT sf.roe * 100.0      FROM sf.stats_financial sf WHERE UPPER(sf.ticker) = UPPER(screening_data.ticker)),
                        netMargin  = (SELECT sf.after_tax_margin * 100.0 FROM sf.stats_financial sf WHERE UPPER(sf.ticker) = UPPER(screening_data.ticker)),
                        grossMargin= (SELECT sf.gross_margin * 100.0     FROM sf.stats_financial sf WHERE UPPER(sf.ticker) = UPPER(screening_data.ticker))
                """)
                conn.execute("DETACH DATABASE sf")
                conn.commit()
                print(f"Synced PE/PB/ROE/margins from {sf_path}")
            except Exception as exc:
                print(f"Warning: could not sync from stats_financial: {exc}")

        # --- Revenue growth and NP growth from vietnam_stocks.db ---
        if stocks_path:
            try:
                conn.execute(f"ATTACH DATABASE '{stocks_path}' AS main_db")
                conn.execute("""
                    UPDATE screening_data
                    SET
                        revenueGrowthYoy = (
                            SELECT
                                CASE WHEN prev.revenue > 0
                                     THEN (curr.revenue - prev.revenue) * 100.0 / prev.revenue
                                     ELSE NULL END
                            FROM main_db.income_statement curr
                            JOIN main_db.income_statement prev
                              ON curr.symbol = prev.symbol
                             AND prev.year = curr.year - 1
                             AND curr.quarter IS NULL AND prev.quarter IS NULL
                            WHERE UPPER(curr.symbol) = UPPER(screening_data.ticker)
                            ORDER BY curr.year DESC
                            LIMIT 1
                        ),
                        npatmiGrowthYoyQm1 = (
                            SELECT
                                CASE WHEN prev.net_profit_parent_company > 0
                                     THEN (curr.net_profit_parent_company - prev.net_profit_parent_company) * 100.0 / prev.net_profit_parent_company
                                     ELSE NULL END
                            FROM main_db.income_statement curr
                            JOIN main_db.income_statement prev
                              ON curr.symbol = prev.symbol
                             AND prev.year = curr.year - 1
                             AND curr.quarter IS NULL AND prev.quarter IS NULL
                            WHERE UPPER(curr.symbol) = UPPER(screening_data.ticker)
                            ORDER BY curr.year DESC
                            LIMIT 1
                        )
                """)
                conn.execute("DETACH DATABASE main_db")
                conn.commit()
                print(f"Synced revenue/NP growth from {stocks_path}")
            except Exception as exc:
                print(f"Warning: could not sync growth from stocks db: {exc}")
    finally:
        conn.close()


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fetch VCI screening/paging and store into SQLite")
    p.add_argument("--start-page", type=int, default=0, help="Start page (inclusive)")
    p.add_argument(
        "--end-page",
        type=int,
        default=None,
        help="Optional end page (inclusive). If omitted, fetch until API returns last=true.",
    )
    p.add_argument("--page-size", type=int, default=50, help="Page size")
    p.add_argument("--db", default="vci_screening.sqlite", help="SQLite db file path")
    p.add_argument("--device-id", default=None, help="Optional device-id header")
    p.add_argument("--timeout", type=int, default=30, help="HTTP timeout in seconds")
    p.add_argument("--retries", type=int, default=6, help="Retry count for transient errors")
    p.add_argument("--backoff", type=float, default=0.8, help="Retry backoff base seconds")
    p.add_argument("--sleep", type=float, default=0.05, help="Sleep seconds between pages")
    p.add_argument(
        "--no-filter",
        action="store_true",
        help="Send empty filter list (filter: [])",
    )
    p.add_argument(
        "--workers",
        type=int,
        default=1,
        help="Number of threads to use for fetching",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    fetch_to_sqlite(
        start_page=args.start_page,
        end_page=args.end_page,
        page_size=args.page_size,
        db_path=args.db,
        device_id=args.device_id,
        timeout_s=args.timeout,
        retries=args.retries,
        backoff_base_s=args.backoff,
        sleep_between_pages_s=args.sleep,
        disable_filter=args.no_filter,
        workers=args.workers,
    )
    sync_financial_metrics(args.db)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
