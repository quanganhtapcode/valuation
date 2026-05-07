#!/usr/bin/env python3
"""Fetch Vietcap technical indicators into SQLite.

Source:
  https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/{SYMBOL}/technical/{TIMEFRAME}

The script is designed to run periodically and keep a local SQLite cache that
the web app can serve without hitting Vietcap on every page load.

Default behavior:
  - Discover symbols from vci_company.sqlite (fallback: symbols.txt)
  - Fetch ONE_HOUR, ONE_DAY, ONE_WEEK for each symbol
  - Upsert the raw upstream JSON into vci_technical.sqlite

Usage:
  python fetch_sqlite/fetch_vci_technical.py
  python fetch_sqlite/fetch_vci_technical.py --symbols FPT,VCB,SSI
  python fetch_sqlite/fetch_vci_technical.py --timeframes ONE_DAY
  python fetch_sqlite/fetch_vci_technical.py --db /path/to/vci_technical.sqlite
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import logging
import random
import sqlite3
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any, Iterable

from backend.db_path import resolve_vci_company_db_path


log = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)

API_BASE = "https://iq.vietcap.com.vn/api/iq-insight-service/v1/company"
DEFAULT_TIMEFRAMES = ("ONE_HOUR", "ONE_DAY", "ONE_WEEK")


def _device_id() -> str:
    return "".join(f"{random.randrange(256):02x}" for _ in range(12))


def _headers() -> dict[str, str]:
    return {
        "accept": "application/json",
        "accept-language": "en-US,en;q=0.9,vi;q=0.8",
        "accept-encoding": "gzip",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "origin": "https://trading.vietcap.com.vn",
        "referer": "https://trading.vietcap.com.vn/",
        "user-agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/145.0.0.0 Safari/537.36"
        ),
        "sec-ch-ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "device-id": _device_id(),
        "connection": "keep-alive",
    }


def _build_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))


def _request_json(
    opener: urllib.request.OpenerDirector,
    url: str,
    *,
    timeout_s: int,
    retries: int,
    backoff_base_s: float,
) -> Any:
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url=url, headers=_headers(), method="GET")
            with opener.open(req, timeout=timeout_s) as resp:
                raw = resp.read()
                if "gzip" in (resp.headers.get("Content-Encoding") or "").lower():
                    raw = gzip.decompress(raw)
            return json.loads(raw.decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 404:
                return None
            if e.code not in (429, 500, 502, 503, 504) or attempt >= retries:
                raise
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
            last_err = e
            if attempt >= retries:
                raise
        sleep_s = backoff_base_s * (2**attempt) + random.random() * 0.3
        time.sleep(sleep_s)
    if last_err is not None:
        raise last_err
    return None


def _normalize_symbols(symbols: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for symbol in symbols:
        clean = (symbol or "").strip().upper()
        if not clean or clean in seen:
            continue
        seen.add(clean)
        out.append(clean)
    return out


def _load_symbols_from_company_db() -> list[str]:
    db_path = resolve_vci_company_db_path()
    try:
        with sqlite3.connect(db_path) as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT UPPER(ticker) AS ticker
                FROM companies
                WHERE ticker IS NOT NULL AND TRIM(ticker) != ''
                ORDER BY ticker
                """
            ).fetchall()
        return _normalize_symbols(r[0] for r in rows if r and r[0])
    except Exception as exc:
        log.warning("Could not load symbols from company DB %s: %s", db_path, exc)
        return []


def _load_symbols_from_file(path: Path) -> list[str]:
    if not path.exists():
        return []
    try:
        return _normalize_symbols(
            line.strip()
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.strip().startswith("#")
        )
    except Exception as exc:
        log.warning("Could not load symbols from %s: %s", path, exc)
        return []


def discover_symbols(explicit: str | None = None) -> list[str]:
    if explicit:
        return _normalize_symbols(explicit.split(","))

    symbols = _load_symbols_from_company_db()
    if symbols:
        return symbols

    fallback = _load_symbols_from_file(Path(__file__).resolve().parents[1] / "symbols.txt")
    return fallback


def _default_db_path() -> str:
    return str(Path(__file__).resolve().parent / "vci_technical.sqlite")


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS technical_snapshots (
            ticker TEXT NOT NULL,
            timeframe TEXT NOT NULL,
            server_date_time TEXT,
            trace_id TEXT,
            api_status INTEGER,
            api_code INTEGER,
            api_msg TEXT,
            successful INTEGER,
            raw_json TEXT NOT NULL,
            fetched_at_utc TEXT NOT NULL,
            PRIMARY KEY (ticker, timeframe)
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_technical_snapshots_timeframe
        ON technical_snapshots (timeframe, ticker)
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS technical_meta (
            key TEXT PRIMARY KEY,
            value TEXT
        )
        """
    )
    conn.commit()


def _now_utc_iso() -> str:
    return dt.datetime.now(tz=dt.timezone.utc).replace(microsecond=0).isoformat()


def fetch_technical_snapshot(
    opener: urllib.request.OpenerDirector,
    symbol: str,
    timeframe: str,
    *,
    timeout_s: int,
    retries: int,
    backoff_base_s: float,
) -> dict[str, Any] | None:
    url = f"{API_BASE}/{symbol.upper()}/technical/{timeframe.upper()}"
    body = _request_json(
        opener,
        url,
        timeout_s=timeout_s,
        retries=retries,
        backoff_base_s=backoff_base_s,
    )
    if not isinstance(body, dict):
        return None
    return body


def upsert_snapshot(
    conn: sqlite3.Connection,
    symbol: str,
    timeframe: str,
    payload: dict[str, Any],
    fetched_at_utc: str,
) -> None:
    conn.execute(
        """
        INSERT INTO technical_snapshots (
            ticker, timeframe, server_date_time, trace_id,
            api_status, api_code, api_msg, successful,
            raw_json, fetched_at_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ticker, timeframe) DO UPDATE SET
            server_date_time=excluded.server_date_time,
            trace_id=excluded.trace_id,
            api_status=excluded.api_status,
            api_code=excluded.api_code,
            api_msg=excluded.api_msg,
            successful=excluded.successful,
            raw_json=excluded.raw_json,
            fetched_at_utc=excluded.fetched_at_utc
        """,
        (
            symbol.upper(),
            timeframe.upper(),
            payload.get("serverDateTime"),
            payload.get("traceId"),
            payload.get("status"),
            payload.get("code"),
            payload.get("msg"),
            1 if payload.get("successful") else 0,
            json.dumps(payload, ensure_ascii=False),
            fetched_at_utc,
        ),
    )


def fetch_and_store(
    db_path: Path,
    *,
    symbols: list[str],
    timeframes: list[str],
    workers: int,
    timeout_s: int,
    retries: int,
    backoff_base_s: float,
) -> tuple[int, int]:
    fetched_at_utc = _now_utc_iso()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    tasks = [(symbol, timeframe) for symbol in symbols for timeframe in timeframes]
    if not tasks:
        return 0, 0

    ok = 0
    skipped = 0

    conn = sqlite3.connect(str(db_path))
    try:
        ensure_schema(conn)

        def _run(task: tuple[str, str]) -> tuple[str, str, dict[str, Any] | None]:
            symbol, timeframe = task
            try:
                opener = _build_opener()
                payload = fetch_technical_snapshot(
                    opener,
                    symbol,
                    timeframe,
                    timeout_s=timeout_s,
                    retries=retries,
                    backoff_base_s=backoff_base_s,
                )
                return symbol, timeframe, payload
            except Exception as exc:
                log.warning("Fetch failed for %s %s: %s", symbol, timeframe, exc)
                return symbol, timeframe, None

        with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
            futures = [executor.submit(_run, task) for task in tasks]
            for future in as_completed(futures):
                symbol, timeframe, payload = future.result()
                if not payload:
                    skipped += 1
                    continue
                upsert_snapshot(conn, symbol, timeframe, payload, fetched_at_utc)
                ok += 1

        conn.execute(
            "INSERT OR REPLACE INTO technical_meta (key, value) VALUES (?, ?)",
            ("last_fetch_utc", fetched_at_utc),
        )
        conn.execute(
            "INSERT OR REPLACE INTO technical_meta (key, value) VALUES (?, ?)",
            ("last_fetch_count", str(ok)),
        )
        conn.commit()
    finally:
        conn.close()

    return ok, skipped


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch Vietcap technical indicators to SQLite")
    parser.add_argument("--db", type=Path, default=Path(_default_db_path()), help="Output SQLite path")
    parser.add_argument("--symbols", type=str, default="", help="Comma-separated ticker list. Defaults to all from company DB.")
    parser.add_argument("--timeframes", type=str, default=",".join(DEFAULT_TIMEFRAMES), help="Comma-separated timeframe list.")
    parser.add_argument("--workers", type=int, default=8, help="Concurrent workers.")
    parser.add_argument("--timeout", type=int, default=20, help="Per-request timeout in seconds.")
    parser.add_argument("--retries", type=int, default=3, help="Retry count per request.")
    parser.add_argument("--backoff", type=float, default=1.0, help="Backoff base seconds.")
    args = parser.parse_args()

    symbols = discover_symbols(args.symbols or None)
    if not symbols:
        log.error("No symbols found. Populate vci_company.sqlite or pass --symbols.")
        raise SystemExit(1)

    timeframes = _normalize_symbols(args.timeframes.split(","))
    if not timeframes:
        timeframes = list(DEFAULT_TIMEFRAMES)

    try:
        ok, skipped = fetch_and_store(
            args.db,
            symbols=symbols,
            timeframes=timeframes,
            workers=args.workers,
            timeout_s=args.timeout,
            retries=args.retries,
            backoff_base_s=args.backoff,
        )
        log.info(
            "Done. Upserted %d snapshots, skipped %d. DB: %s",
            ok,
            skipped,
            args.db,
        )
    except urllib.error.HTTPError as e:
        if e.code in (403, 503):
            log.error(
                "HTTP %d from iq.vietcap.com.vn. If the VPS is blocked, run the fetcher from your local machine and copy the SQLite file back.",
                e.code,
            )
        raise SystemExit(1)
    except Exception as exc:
        log.error("Fatal: %s", exc)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
