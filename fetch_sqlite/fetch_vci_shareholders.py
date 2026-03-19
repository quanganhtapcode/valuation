#!/usr/bin/env python3
"""Fetch VCI per-symbol shareholder data into SQLite.

Calls https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/{SYMBOL}/shareholder
for each listed symbol and upserts all holders into vci_shareholders.sqlite.

Run daily (shareholding changes quarterly but the API reflects the latest filings):
    python fetch_sqlite/fetch_vci_shareholders.py

Field notes from API:
  - percentage: decimal form (0.954 = 95.4%)
  - ownerType: CORPORATE | INDIVIDUAL
  - positionName/positionNameEn: non-null only for directors/officers
  - publicDate: disclosure date (when the holding was publicly filed)
  - updateDate: when VCI last updated the record
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import logging
import os
import random
import sqlite3
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

API_BASE = "https://iq.vietcap.com.vn/api/iq-insight-service/v1/company"
API_PATH = "shareholder"

_DEVICE_ID = "".join(f"{random.randrange(256):02x}" for _ in range(12))


def _headers() -> dict[str, str]:
    return {
        "accept": "application/json",
        "accept-language": "en-US,en;q=0.9,vi-VN;q=0.8,vi;q=0.7",
        "accept-encoding": "gzip",
        "user-agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "origin": "https://trading.vietcap.com.vn",
        "referer": "https://trading.vietcap.com.vn/",
        "device-id": _DEVICE_ID,
        "connection": "keep-alive",
    }


def _build_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))


def fetch_shareholders(
    opener: urllib.request.OpenerDirector,
    symbol: str,
    *,
    timeout_s: int = 15,
    retries: int = 3,
    backoff_base_s: float = 1.0,
) -> list[dict[str, Any]] | None:
    url = f"{API_BASE}/{symbol.upper()}/{API_PATH}"
    headers = _headers()
    last_err: Exception | None = None

    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url=url, headers=headers, method="GET")
            with opener.open(req, timeout=timeout_s) as resp:
                raw = resp.read()
                if "gzip" in resp.headers.get("Content-Encoding", "").lower():
                    raw = gzip.decompress(raw)
                body = json.loads(raw.decode("utf-8", errors="replace"))

                # Response: { "data": [...], "status": 200, ... }
                if isinstance(body, list):
                    return body
                if isinstance(body, dict):
                    data = body.get("data")
                    if isinstance(data, list):
                        return data
                    if body.get("status") == 200 and data is None:
                        return []   # symbol exists but no shareholders on file
                return None
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 404:
                return None
            if e.code not in (429, 500, 502, 503, 504) or attempt >= retries:
                raise
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_err = e
            if attempt >= retries:
                raise
        time.sleep(backoff_base_s * (2 ** attempt) + random.random() * 0.3)

    if last_err:
        raise last_err
    return None


# ---------------------------------------------------------------------------
# SQLite
# ---------------------------------------------------------------------------

def _default_db_path() -> str:
    return str(Path(__file__).resolve().parent / "vci_shareholders.sqlite")


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS shareholders (
          ticker           TEXT NOT NULL,
          owner_code       TEXT NOT NULL,
          owner_name       TEXT,
          owner_name_en    TEXT,
          position_name    TEXT,
          position_name_en TEXT,
          quantity         INTEGER,
          percentage       REAL,     -- decimal: 0.954 = 95.4%
          owner_type       TEXT,     -- CORPORATE | INDIVIDUAL
          update_date      TEXT,
          public_date      TEXT,
          fetched_at       TEXT NOT NULL,
          PRIMARY KEY (ticker, owner_code)
        );
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_shareholders_ticker
        ON shareholders (ticker);
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS meta (
          k TEXT PRIMARY KEY,
          v TEXT NOT NULL
        );
    """)
    conn.commit()


def upsert_shareholders(
    conn: sqlite3.Connection,
    symbol: str,
    holders: list[dict[str, Any]],
    fetched_at: str,
) -> int:
    """Delete old rows for symbol then insert fresh ones. Returns count inserted."""
    conn.execute("DELETE FROM shareholders WHERE ticker = ?", (symbol.upper(),))
    count = 0
    for h in holders:
        owner_code = str(h.get("ownerCode") or "").strip()
        if not owner_code:
            # Use name as fallback key if ownerCode missing
            owner_code = str(h.get("ownerName") or h.get("ownerNameEn") or "").strip()[:50]
        if not owner_code:
            continue
        conn.execute("""
            INSERT OR REPLACE INTO shareholders (
              ticker, owner_code, owner_name, owner_name_en,
              position_name, position_name_en,
              quantity, percentage, owner_type,
              update_date, public_date, fetched_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            symbol.upper(),
            owner_code,
            str(h.get("ownerName") or "").strip() or None,
            str(h.get("ownerNameEn") or "").strip() or None,
            str(h.get("positionName") or "").strip() or None,
            str(h.get("positionNameEn") or "").strip() or None,
            int(h["quantity"]) if h.get("quantity") is not None else None,
            float(h["percentage"]) if h.get("percentage") is not None else None,
            str(h.get("ownerType") or "").strip() or None,
            str(h.get("updateDate") or "")[:10] or None,
            str(h.get("publicDate") or "")[:10] or None,
            fetched_at,
        ))
        count += 1
    return count


# ---------------------------------------------------------------------------
# Symbol discovery
# ---------------------------------------------------------------------------

def _symbols_from_screening(db: str) -> list[str]:
    if not os.path.exists(db):
        return []
    try:
        conn = sqlite3.connect(db)
        rows = conn.execute(
            "SELECT UPPER(ticker) FROM screening_data WHERE ticker IS NOT NULL"
        ).fetchall()
        conn.close()
        return [r[0] for r in rows if r[0]]
    except Exception as e:
        log.warning(f"Cannot read screening DB: {e}")
        return []


def _symbols_from_stocks_db(db: str) -> list[str]:
    if not os.path.exists(db):
        return []
    try:
        conn = sqlite3.connect(db)
        for table in ("stocks", "company_overview", "company"):
            try:
                rows = conn.execute(
                    f"SELECT UPPER(ticker) FROM {table} WHERE ticker IS NOT NULL LIMIT 5000"
                ).fetchall()
                if rows:
                    conn.close()
                    return [r[0] for r in rows if r[0]]
            except Exception:
                continue
        conn.close()
    except Exception as e:
        log.warning(f"Cannot read stocks DB: {e}")
    return []


def collect_symbols(args: argparse.Namespace) -> list[str]:
    if getattr(args, "symbols", None):
        return [s.strip().upper() for s in args.symbols.split(",") if s.strip()]

    here = Path(__file__).resolve().parent
    screening_db = getattr(args, "screening_db", None) or str(here / "vci_screening.sqlite")
    symbols = _symbols_from_screening(screening_db)

    if not symbols:
        root = here.parent
        for candidate in [
            root / "vietnam_stocks.db",
            root / "stocks.db",
            Path("/var/www/valuation/vietnam_stocks.db"),
            Path("/var/www/valuation/stocks.db"),
        ]:
            symbols = _symbols_from_stocks_db(str(candidate))
            if symbols:
                break

    if not symbols:
        log.error("No symbols found — pass --symbols A,B,C or ensure screening DB exists.")
    return sorted(set(symbols))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fetch VCI shareholder data per symbol into SQLite")
    p.add_argument("--db", default=None, help="Output SQLite path (default: fetch_sqlite/vci_shareholders.sqlite)")
    p.add_argument("--screening-db", default=None, help="Path to vci_screening.sqlite for symbol list")
    p.add_argument("--symbols", default=None, help="Comma-separated symbol list (overrides auto-discovery)")
    p.add_argument("--workers", type=int, default=10, help="Concurrent HTTP workers (default: 10)")
    p.add_argument("--timeout", type=int, default=15, help="Per-request timeout seconds (default: 15)")
    p.add_argument("--retries", type=int, default=3, help="Retries per symbol (default: 3)")
    p.add_argument("--delay", type=float, default=0.05, help="Extra delay between requests (default: 0.05)")
    p.add_argument("--batch-commit", type=int, default=100, help="Commit every N symbols (default: 100)")
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    db_path = args.db or _default_db_path()
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)

    symbols = collect_symbols(args)
    if not symbols:
        return

    log.info(f"Fetching shareholders for {len(symbols)} symbols → {db_path}")

    conn = sqlite3.connect(db_path)
    ensure_schema(conn)
    fetched_at = dt.datetime.now(tz=dt.timezone.utc).replace(microsecond=0).isoformat()
    conn.execute("INSERT OR REPLACE INTO meta VALUES ('last_run_started', ?)", (fetched_at,))
    conn.commit()

    ok_count = 0
    skip_count = 0
    err_count = 0
    pending = 0

    def _worker(symbol: str) -> tuple[str, list[dict] | None, Exception | None]:
        opener = _build_opener()
        try:
            if args.delay > 0:
                time.sleep(args.delay + random.random() * 0.05)
            data = fetch_shareholders(opener, symbol, timeout_s=args.timeout, retries=args.retries)
            return symbol, data, None
        except Exception as exc:
            return symbol, None, exc

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(_worker, sym): sym for sym in symbols}
        for future in as_completed(futures):
            symbol, holders, exc = future.result()
            if exc is not None:
                log.debug(f"  {symbol}: error — {exc}")
                err_count += 1
                continue
            if holders is None:
                skip_count += 1
                continue
            if not holders:
                # Symbol exists but no shareholders filed
                skip_count += 1
                continue

            try:
                inserted = upsert_shareholders(conn, symbol, holders, fetched_at)
                ok_count += 1
                pending += 1
                if args.verbose:
                    log.debug(f"  {symbol}: {inserted} holders")
            except Exception as upsert_exc:
                log.warning(f"  {symbol}: upsert failed — {upsert_exc}")
                err_count += 1

            if pending >= args.batch_commit:
                conn.commit()
                pending = 0

    conn.commit()
    finished_at = dt.datetime.now(tz=dt.timezone.utc).replace(microsecond=0).isoformat()
    conn.execute("INSERT OR REPLACE INTO meta VALUES ('last_run_finished', ?)", (finished_at,))
    conn.execute("INSERT OR REPLACE INTO meta VALUES ('last_run_ok_count', ?)", (str(ok_count),))
    conn.commit()
    conn.close()

    log.info(f"Done: {ok_count} symbols upserted, {skip_count} skipped (no data), {err_count} errors")


if __name__ == "__main__":
    main()
