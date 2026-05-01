#!/usr/bin/env python3
"""Fetch VCI per-symbol daily PE/PB TTM ratios into SQLite.

Calls https://iq.vietcap.com.vn/api/iq-insight-service/v1/company-ratio-daily/{SYMBOL}?lengthReport=10
for each listed symbol and stores the latest entry plus recent history into vci_ratio_daily.sqlite.

Run daily (PE/PB is computed against closing price each trading day):
    python fetch_sqlite/fetch_vci_ratio_daily.py

Field notes from API:
  - pe: TTM P/E ratio (price / trailing-12-month EPS)
  - pb: P/B ratio (price / book value per share)
  - tradingDate: the trading date of the latest price used for calculation
  - lengthReport=1 returns the single most-recent trading day entry
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

API_BASE = "https://iq.vietcap.com.vn/api/iq-insight-service/v1/company-ratio-daily"

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


def fetch_ratio_daily_history(
    opener: urllib.request.OpenerDirector,
    symbol: str,
    *,
    length_report: int = 10,
    timeout_s: int = 15,
    retries: int = 3,
    backoff_base_s: float = 1.0,
) -> list[dict[str, Any]]:
    """Fetch recent PE/PB entries for symbol. Returns newest-first normalized rows."""
    safe_length = max(1, min(int(length_report or 1), 250))
    url = f"{API_BASE}/{symbol.upper()}?lengthReport={safe_length}"
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

                # Response is an array of {pe, pb, tradingDate}; take the last (most recent) entry
                entries: list[dict] = []
                if isinstance(body, list):
                    entries = body
                elif isinstance(body, dict):
                    data = body.get("data")
                    if isinstance(data, list):
                        entries = data

                if not entries:
                    return []

                # Sort by tradingDate descending and cap locally because upstream can return
                # more rows than requested for some symbols.
                entries.sort(key=lambda x: str(x.get("tradingDate") or ""), reverse=True)
                entries = entries[:safe_length]

                out: list[dict[str, Any]] = []
                seen_dates: set[str] = set()
                for entry in entries:
                    pe = entry.get("pe")
                    pb = entry.get("pb")
                    trading_date = str(entry.get("tradingDate") or "")[:10]

                    if pe is None and pb is None:
                        continue
                    if trading_date and trading_date in seen_dates:
                        continue
                    if trading_date:
                        seen_dates.add(trading_date)

                    out.append({
                        "pe": float(pe) if pe is not None else None,
                        "pb": float(pb) if pb is not None else None,
                        "trading_date": trading_date or None,
                    })

                return out

        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 404:
                return []
            if e.code not in (429, 500, 502, 503, 504) or attempt >= retries:
                raise
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_err = e
            if attempt >= retries:
                raise
        time.sleep(backoff_base_s * (2 ** attempt) + random.random() * 0.3)

    if last_err:
        raise last_err
    return []


def fetch_ratio_daily(
    opener: urllib.request.OpenerDirector,
    symbol: str,
    *,
    timeout_s: int = 15,
    retries: int = 3,
    backoff_base_s: float = 1.0,
) -> dict[str, Any] | None:
    """Fetch the latest PE/PB entry for symbol. Returns dict with pe, pb, trading_date or None."""
    rows = fetch_ratio_daily_history(
        opener,
        symbol,
        length_report=1,
        timeout_s=timeout_s,
        retries=retries,
        backoff_base_s=backoff_base_s,
    )
    return rows[0] if rows else None


# ---------------------------------------------------------------------------
# SQLite
# ---------------------------------------------------------------------------

def _default_db_path() -> str:
    return str(Path(__file__).resolve().parent / "vci_ratio_daily.sqlite")


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ratio_daily (
          ticker        TEXT PRIMARY KEY,
          pe            REAL,
          pb            REAL,
          trading_date  TEXT,
          fetched_at    TEXT NOT NULL
        );
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ratio_daily_history (
          ticker        TEXT NOT NULL,
          trading_date  TEXT NOT NULL,
          pe            REAL,
          pb            REAL,
          fetched_at    TEXT NOT NULL,
          PRIMARY KEY (ticker, trading_date)
        );
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ratio_daily_history_ticker_date
        ON ratio_daily_history (ticker, trading_date DESC);
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS meta (
          k TEXT PRIMARY KEY,
          v TEXT NOT NULL
        );
    """)
    conn.commit()


def upsert_ratio(
    conn: sqlite3.Connection,
    symbol: str,
    entry: dict[str, Any],
    fetched_at: str,
) -> None:
    conn.execute("""
        INSERT OR REPLACE INTO ratio_daily (ticker, pe, pb, trading_date, fetched_at)
        VALUES (?, ?, ?, ?, ?)
    """, (
        symbol.upper(),
        entry.get("pe"),
        entry.get("pb"),
        entry.get("trading_date"),
        fetched_at,
    ))


def upsert_ratio_history(
    conn: sqlite3.Connection,
    symbol: str,
    entries: list[dict[str, Any]],
    fetched_at: str,
) -> int:
    rows = [
        (
            symbol.upper(),
            entry.get("trading_date"),
            entry.get("pe"),
            entry.get("pb"),
            fetched_at,
        )
        for entry in entries
        if entry.get("trading_date")
    ]
    if not rows:
        return 0

    conn.executemany("""
        INSERT OR REPLACE INTO ratio_daily_history (ticker, trading_date, pe, pb, fetched_at)
        VALUES (?, ?, ?, ?, ?)
    """, rows)
    return len(rows)


# ---------------------------------------------------------------------------
# Symbol discovery (same pattern as other fetchers)
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
    p = argparse.ArgumentParser(description="Fetch VCI daily PE/PB TTM per symbol into SQLite")
    p.add_argument("--db", default=None, help="Output SQLite path (default: fetch_sqlite/vci_ratio_daily.sqlite)")
    p.add_argument("--screening-db", default=None, help="Path to vci_screening.sqlite for symbol list")
    p.add_argument("--symbols", default=None, help="Comma-separated symbol list (overrides auto-discovery)")
    p.add_argument("--workers", type=int, default=10, help="Concurrent HTTP workers (default: 10)")
    p.add_argument("--timeout", type=int, default=15, help="Per-request timeout seconds (default: 15)")
    p.add_argument("--retries", type=int, default=3, help="Retries per symbol (default: 3)")
    p.add_argument("--length-report", type=int, default=10, help="Recent daily entries per symbol (default: 10)")
    p.add_argument("--delay", type=float, default=0.05, help="Extra delay between requests (default: 0.05)")
    p.add_argument("--batch-commit", type=int, default=200, help="Commit every N symbols (default: 200)")
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

    log.info(f"Fetching daily PE/PB for {len(symbols)} symbols → {db_path}")

    conn = sqlite3.connect(db_path)
    ensure_schema(conn)
    fetched_at = dt.datetime.now(tz=dt.timezone.utc).replace(microsecond=0).isoformat()
    conn.execute("INSERT OR REPLACE INTO meta VALUES ('last_run_started', ?)", (fetched_at,))
    conn.commit()

    ok_count = 0
    history_count = 0
    skip_count = 0
    err_count = 0
    pending = 0

    def _worker(symbol: str) -> tuple[str, list[dict[str, Any]], Exception | None]:
        opener = _build_opener()
        try:
            if args.delay > 0:
                time.sleep(args.delay + random.random() * 0.05)
            data = fetch_ratio_daily_history(
                opener,
                symbol,
                length_report=args.length_report,
                timeout_s=args.timeout,
                retries=args.retries,
            )
            return symbol, data, None
        except Exception as exc:
            return symbol, [], exc

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(_worker, sym): sym for sym in symbols}
        for future in as_completed(futures):
            symbol, entries, exc = future.result()
            if exc is not None:
                log.debug(f"  {symbol}: error — {exc}")
                err_count += 1
                continue
            if not entries:
                skip_count += 1
                continue

            try:
                entry = entries[0]
                upsert_ratio(conn, symbol, entry, fetched_at)
                history_count += upsert_ratio_history(conn, symbol, entries, fetched_at)
                ok_count += 1
                pending += 1
                if args.verbose:
                    log.debug(
                        f"  {symbol}: pe={entry.get('pe')} pb={entry.get('pb')} "
                        f"date={entry.get('trading_date')} history={len(entries)}"
                    )
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
    conn.execute("INSERT OR REPLACE INTO meta VALUES ('last_run_history_count', ?)", (str(history_count),))
    conn.commit()
    conn.close()

    log.info(
        f"Done: {ok_count} symbols upserted, {history_count} history rows, "
        f"{skip_count} skipped (no data), {err_count} errors"
    )


if __name__ == "__main__":
    main()
