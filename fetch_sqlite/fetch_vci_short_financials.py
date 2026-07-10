#!/usr/bin/env python3
"""Fetch VCI short-financial history for HOSE stocks into SQLite.

Source endpoint:
  GET https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/{SYMBOL}/short-financial?lengthReport=N

Default output:
  fetch_sqlite/vci_short_financials.sqlite
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import logging
import os
import random
import re
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
API_PATH = "short-financial"
_DEVICE_ID = "".join(f"{random.randrange(256):02x}" for _ in range(12))


def _headers() -> dict[str, str]:
    return {
        "accept": "application/json",
        "accept-language": "en-US,en;q=0.9,vi-VN;q=0.8,vi;q=0.7",
        "accept-encoding": "gzip",
        "user-agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/147.0.0.0 Safari/537.36"
        ),
        "origin": "https://trading.vietcap.com.vn",
        "referer": "https://trading.vietcap.com.vn/",
        "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "device-id": _DEVICE_ID,
        "connection": "keep-alive",
    }


def _build_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))


def _to_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        import math

        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _to_int(v: Any) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _quarter_no(quarter_label: Any) -> int | None:
    s = str(quarter_label or "").strip().upper()
    m = re.search(r"Q\s*([1-4])", s)
    if not m:
        return None
    return int(m.group(1))


def _iso_date_from_epoch(epoch_seconds: Any) -> str | None:
    ts = _to_int(epoch_seconds)
    if ts is None:
        return None
    try:
        return dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc).date().isoformat()
    except (ValueError, OSError):
        return None


def _extract_entries(body: Any) -> list[dict[str, Any]]:
    if isinstance(body, list):
        return [x for x in body if isinstance(x, dict)]
    if isinstance(body, dict):
        arr = body.get("data")
        if isinstance(arr, list):
            return [x for x in arr if isinstance(x, dict)]
    return []


def _fetch_symbol(
    opener: urllib.request.OpenerDirector,
    symbol: str,
    *,
    length_report: int,
    timeout_s: int = 20,
    retries: int = 3,
    backoff_base_s: float = 1.0,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    safe_len = max(1, min(int(length_report), 1000))
    url = f"{API_BASE}/{symbol.upper()}/{API_PATH}?lengthReport={safe_len}"
    last_err: Exception | None = None

    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url=url, headers=_headers(), method="GET")
            with opener.open(req, timeout=timeout_s) as resp:
                raw = resp.read()
                if "gzip" in resp.headers.get("Content-Encoding", "").lower() or raw[:2] == b"\x1f\x8b":
                    raw = gzip.decompress(raw)
                body = json.loads(raw.decode("utf-8", errors="replace"))

            entries = _extract_entries(body)
            envelope = body if isinstance(body, dict) else None
            return entries, envelope
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 404:
                return [], None
            if e.code not in (429, 500, 502, 503, 504) or attempt >= retries:
                raise
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
            last_err = e
            if attempt >= retries:
                raise
        time.sleep(backoff_base_s * (2**attempt) + random.random() * 0.3)

    if last_err:
        raise last_err
    return [], None


def _default_db_path() -> str:
    return str(Path(__file__).resolve().parent / "vci_short_financials.sqlite")


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS short_financial_history (
          ticker               TEXT NOT NULL,
          year_report          INTEGER NOT NULL,
          quarter_no           INTEGER,
          quarter_label        TEXT,
          trading_time         INTEGER,
          trading_date         TEXT,
          update_date          TEXT,
          length_report        INTEGER,
          closing_price        REAL,
          revenue              REAL,
          revenue_growth       REAL,
          npat_mi              REAL,
          npat_mi_growth       REAL,
          npat_mi_margin       REAL,
          roe                  REAL,
          roa                  REAL,
          gross_margin         REAL,
          debt_per_equity      REAL,
          current_ratio        REAL,
          quick_ratio          REAL,
          total_asset          REAL,
          total_equity         REAL,
          total_debts          REAL,
          raw_json             TEXT NOT NULL,
          fetched_at           TEXT NOT NULL,
          PRIMARY KEY (ticker, year_report, quarter_label)
        );
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_short_financial_history_ticker_year
        ON short_financial_history(ticker, year_report DESC);
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS short_financial_latest (
          ticker               TEXT PRIMARY KEY,
          year_report          INTEGER,
          quarter_no           INTEGER,
          quarter_label        TEXT,
          trading_time         INTEGER,
          trading_date         TEXT,
          update_date          TEXT,
          length_report        INTEGER,
          closing_price        REAL,
          revenue              REAL,
          revenue_growth       REAL,
          npat_mi              REAL,
          npat_mi_growth       REAL,
          npat_mi_margin       REAL,
          roe                  REAL,
          roa                  REAL,
          gross_margin         REAL,
          debt_per_equity      REAL,
          current_ratio        REAL,
          quick_ratio          REAL,
          total_asset          REAL,
          total_equity         REAL,
          total_debts          REAL,
          raw_json             TEXT NOT NULL,
          fetched_at           TEXT NOT NULL
        );
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS short_financial_payload (
          ticker               TEXT PRIMARY KEY,
          row_count            INTEGER NOT NULL,
          response_successful  INTEGER,
          response_status      INTEGER,
          server_datetime      TEXT,
          trace_id             TEXT,
          raw_json             TEXT NOT NULL,
          fetched_at           TEXT NOT NULL
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
    conn.commit()


def _entry_sort_key(entry: dict[str, Any]) -> tuple[int, int, int]:
    year = _to_int(entry.get("yearReport")) or 0
    q_no = _quarter_no(entry.get("quarter")) or 0
    ts = _to_int(entry.get("tradingTime")) or 0
    return year, q_no, ts


def upsert_history(
    conn: sqlite3.Connection,
    symbol: str,
    entries: list[dict[str, Any]],
    fetched_at: str,
) -> int:
    rows = []
    for e in entries:
        year_report = _to_int(e.get("yearReport"))
        quarter_label = str(e.get("quarter") or "").strip()
        if year_report is None or not quarter_label:
            continue
        trading_time = _to_int(e.get("tradingTime"))
        rows.append(
            (
                symbol.upper(),
                year_report,
                _quarter_no(quarter_label),
                quarter_label,
                trading_time,
                _iso_date_from_epoch(trading_time),
                str(e.get("updateDate") or "") or None,
                _to_int(e.get("lengthReport")),
                _to_float(e.get("closingPrice")),
                _to_float(e.get("revenue")),
                _to_float(e.get("revenueGrowth")),
                _to_float(e.get("npatMi")),
                _to_float(e.get("npatMiGrowth")),
                _to_float(e.get("npatMiMargin")),
                _to_float(e.get("roe")),
                _to_float(e.get("roa")),
                _to_float(e.get("grossMargin")),
                _to_float(e.get("debtPerEquity")),
                _to_float(e.get("currentRatio")),
                _to_float(e.get("quickRatio")),
                _to_float(e.get("totalAsset")),
                _to_float(e.get("totalEquity")),
                _to_float(e.get("totalDebts")),
                json.dumps(e, ensure_ascii=False),
                fetched_at,
            )
        )
    if not rows:
        return 0

    conn.executemany(
        """
        INSERT INTO short_financial_history (
          ticker, year_report, quarter_no, quarter_label, trading_time, trading_date, update_date,
          length_report, closing_price, revenue, revenue_growth, npat_mi, npat_mi_growth, npat_mi_margin,
          roe, roa, gross_margin, debt_per_equity, current_ratio, quick_ratio, total_asset, total_equity,
          total_debts, raw_json, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ticker, year_report, quarter_label) DO UPDATE SET
          quarter_no      = excluded.quarter_no,
          trading_time    = excluded.trading_time,
          trading_date    = excluded.trading_date,
          update_date     = excluded.update_date,
          length_report   = excluded.length_report,
          closing_price   = excluded.closing_price,
          revenue         = excluded.revenue,
          revenue_growth  = excluded.revenue_growth,
          npat_mi         = excluded.npat_mi,
          npat_mi_growth  = excluded.npat_mi_growth,
          npat_mi_margin  = excluded.npat_mi_margin,
          roe             = excluded.roe,
          roa             = excluded.roa,
          gross_margin    = excluded.gross_margin,
          debt_per_equity = excluded.debt_per_equity,
          current_ratio   = excluded.current_ratio,
          quick_ratio     = excluded.quick_ratio,
          total_asset     = excluded.total_asset,
          total_equity    = excluded.total_equity,
          total_debts     = excluded.total_debts,
          raw_json        = excluded.raw_json,
          fetched_at      = excluded.fetched_at
        """,
        rows,
    )
    return len(rows)


def upsert_latest(conn: sqlite3.Connection, symbol: str, latest: dict[str, Any], fetched_at: str) -> None:
    quarter_label = str(latest.get("quarter") or "").strip()
    trading_time = _to_int(latest.get("tradingTime"))
    conn.execute(
        """
        INSERT INTO short_financial_latest (
          ticker, year_report, quarter_no, quarter_label, trading_time, trading_date, update_date,
          length_report, closing_price, revenue, revenue_growth, npat_mi, npat_mi_growth, npat_mi_margin,
          roe, roa, gross_margin, debt_per_equity, current_ratio, quick_ratio, total_asset, total_equity,
          total_debts, raw_json, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ticker) DO UPDATE SET
          year_report     = excluded.year_report,
          quarter_no      = excluded.quarter_no,
          quarter_label   = excluded.quarter_label,
          trading_time    = excluded.trading_time,
          trading_date    = excluded.trading_date,
          update_date     = excluded.update_date,
          length_report   = excluded.length_report,
          closing_price   = excluded.closing_price,
          revenue         = excluded.revenue,
          revenue_growth  = excluded.revenue_growth,
          npat_mi         = excluded.npat_mi,
          npat_mi_growth  = excluded.npat_mi_growth,
          npat_mi_margin  = excluded.npat_mi_margin,
          roe             = excluded.roe,
          roa             = excluded.roa,
          gross_margin    = excluded.gross_margin,
          debt_per_equity = excluded.debt_per_equity,
          current_ratio   = excluded.current_ratio,
          quick_ratio     = excluded.quick_ratio,
          total_asset     = excluded.total_asset,
          total_equity    = excluded.total_equity,
          total_debts     = excluded.total_debts,
          raw_json        = excluded.raw_json,
          fetched_at      = excluded.fetched_at
        """,
        (
            symbol.upper(),
            _to_int(latest.get("yearReport")),
            _quarter_no(quarter_label),
            quarter_label or None,
            trading_time,
            _iso_date_from_epoch(trading_time),
            str(latest.get("updateDate") or "") or None,
            _to_int(latest.get("lengthReport")),
            _to_float(latest.get("closingPrice")),
            _to_float(latest.get("revenue")),
            _to_float(latest.get("revenueGrowth")),
            _to_float(latest.get("npatMi")),
            _to_float(latest.get("npatMiGrowth")),
            _to_float(latest.get("npatMiMargin")),
            _to_float(latest.get("roe")),
            _to_float(latest.get("roa")),
            _to_float(latest.get("grossMargin")),
            _to_float(latest.get("debtPerEquity")),
            _to_float(latest.get("currentRatio")),
            _to_float(latest.get("quickRatio")),
            _to_float(latest.get("totalAsset")),
            _to_float(latest.get("totalEquity")),
            _to_float(latest.get("totalDebts")),
            json.dumps(latest, ensure_ascii=False),
            fetched_at,
        ),
    )


def upsert_payload(
    conn: sqlite3.Connection,
    symbol: str,
    envelope: dict[str, Any] | None,
    entries: list[dict[str, Any]],
    fetched_at: str,
) -> None:
    if envelope is None:
        envelope = {"data": entries}
    conn.execute(
        """
        INSERT INTO short_financial_payload (
          ticker, row_count, response_successful, response_status, server_datetime, trace_id, raw_json, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(ticker) DO UPDATE SET
          row_count           = excluded.row_count,
          response_successful = excluded.response_successful,
          response_status     = excluded.response_status,
          server_datetime     = excluded.server_datetime,
          trace_id            = excluded.trace_id,
          raw_json            = excluded.raw_json,
          fetched_at          = excluded.fetched_at
        """,
        (
            symbol.upper(),
            len(entries),
            1 if bool(envelope.get("successful")) else 0 if "successful" in envelope else None,
            _to_int(envelope.get("status")),
            str(envelope.get("serverDateTime") or "") or None,
            str(envelope.get("traceId") or "") or None,
            json.dumps(envelope, ensure_ascii=False),
            fetched_at,
        ),
    )


def _symbols_from_company_db(company_db: str) -> list[str]:
    if not os.path.exists(company_db):
        return []
    try:
        conn = sqlite3.connect(company_db)
        rows = conn.execute(
            """
            SELECT DISTINCT UPPER(ticker)
            FROM companies
            WHERE floor = 'HOSE'
              AND COALESCE(is_index, 0) = 0
              AND ticker GLOB '[A-Z][A-Z][A-Z]'
            ORDER BY UPPER(ticker)
            """
        ).fetchall()
        conn.close()
        return [r[0] for r in rows if r[0]]
    except Exception as e:
        log.warning(f"Cannot read symbols from company DB: {e}")
        return []


def _symbols_from_csv(csv_path: str) -> list[str]:
    import csv

    if not os.path.exists(csv_path):
        return []
    out: list[str] = []
    try:
        with open(csv_path, "r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            if "ticker" in (reader.fieldnames or []):
                for row in reader:
                    t = (row.get("ticker") or "").strip().upper()
                    if t:
                        out.append(t)
            else:
                f.seek(0)
                for line in f:
                    t = line.strip().upper()
                    if t and t != "TICKER":
                        out.append(t)
    except Exception as e:
        log.warning(f"Cannot read symbols from CSV: {e}")
    return sorted(set(out))


def collect_symbols(args: argparse.Namespace) -> list[str]:
    if args.symbols:
        return sorted({s.strip().upper() for s in args.symbols.split(",") if s.strip()})

    if args.tickers_csv:
        symbols = _symbols_from_csv(args.tickers_csv)
        if symbols:
            return symbols

    symbols = _symbols_from_company_db(args.company_db)
    if not symbols:
        log.error("No symbols found. Pass --symbols, --tickers-csv, or ensure company DB exists.")
    return symbols


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fetch VCI short-financial for HOSE stocks into SQLite")
    p.add_argument("--db", default=None, help="Output SQLite path (default: fetch_sqlite/vci_short_financials.sqlite)")
    p.add_argument(
        "--company-db",
        default=str(Path(__file__).resolve().parent / "vci_company.sqlite"),
        help="Path to vci_company.sqlite used to select HOSE stocks",
    )
    p.add_argument("--tickers-csv", default=None, help="Optional CSV with ticker column")
    p.add_argument("--symbols", default=None, help="Comma-separated ticker list (overrides auto-discovery)")
    p.add_argument("--length-report", type=int, default=200, help="History length per ticker (default: 200)")
    p.add_argument("--workers", type=int, default=12, help="Concurrent workers (default: 12)")
    p.add_argument("--timeout", type=int, default=20, help="Per-request timeout seconds (default: 20)")
    p.add_argument("--retries", type=int, default=3, help="Retries per symbol (default: 3)")
    p.add_argument("--delay", type=float, default=0.05, help="Extra delay between requests (default: 0.05)")
    p.add_argument("--batch-commit", type=int, default=100, help="Commit every N symbols (default: 100)")
    p.add_argument("-v", "--verbose", action="store_true", help="Verbose logging")
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

    log.info(f"Fetching short-financial for {len(symbols)} HOSE symbols → {db_path}")
    conn = sqlite3.connect(db_path)
    ensure_schema(conn)

    run_started = dt.datetime.now(tz=dt.timezone.utc).replace(microsecond=0).isoformat()
    conn.execute("INSERT OR REPLACE INTO meta VALUES ('last_run_started', ?)", (run_started,))
    conn.execute("INSERT OR REPLACE INTO meta VALUES ('last_length_report', ?)", (str(args.length_report),))
    conn.commit()

    fetched_at = dt.datetime.now(tz=dt.timezone.utc).replace(microsecond=0).isoformat()
    ok_count = 0
    history_rows = 0
    skipped = 0
    errors = 0
    pending = 0

    def _worker(symbol: str) -> tuple[str, list[dict[str, Any]], dict[str, Any] | None, Exception | None]:
        opener = _build_opener()
        try:
            if args.delay > 0:
                time.sleep(args.delay + random.random() * 0.05)
            entries, envelope = _fetch_symbol(
                opener,
                symbol,
                length_report=args.length_report,
                timeout_s=args.timeout,
                retries=args.retries,
            )
            return symbol, entries, envelope, None
        except Exception as exc:
            return symbol, [], None, exc

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(_worker, sym): sym for sym in symbols}
        for future in as_completed(futures):
            symbol, entries, envelope, exc = future.result()
            if exc is not None:
                log.debug(f"  {symbol}: error — {exc}")
                errors += 1
                continue
            if not entries:
                skipped += 1
                upsert_payload(conn, symbol, envelope, entries, fetched_at)
                pending += 1
                if pending >= args.batch_commit:
                    conn.commit()
                    pending = 0
                continue

            entries_sorted = sorted(entries, key=_entry_sort_key)
            latest = entries_sorted[-1]

            try:
                history_rows += upsert_history(conn, symbol, entries_sorted, fetched_at)
                upsert_latest(conn, symbol, latest, fetched_at)
                upsert_payload(conn, symbol, envelope, entries_sorted, fetched_at)
                ok_count += 1
                pending += 1
                if args.verbose:
                    log.debug(
                        f"  {symbol}: latest={latest.get('quarter')} {latest.get('yearReport')} rows={len(entries_sorted)}"
                    )
            except Exception as upsert_exc:
                log.warning(f"  {symbol}: upsert failed — {upsert_exc}")
                errors += 1

            if pending >= args.batch_commit:
                conn.commit()
                pending = 0

    conn.commit()
    run_finished = dt.datetime.now(tz=dt.timezone.utc).replace(microsecond=0).isoformat()
    conn.execute("INSERT OR REPLACE INTO meta VALUES ('last_run_finished', ?)", (run_finished,))
    conn.execute("INSERT OR REPLACE INTO meta VALUES ('last_run_ok_count', ?)", (str(ok_count),))
    conn.execute("INSERT OR REPLACE INTO meta VALUES ('last_run_history_rows', ?)", (str(history_rows),))
    conn.execute("INSERT OR REPLACE INTO meta VALUES ('last_run_skipped_count', ?)", (str(skipped),))
    conn.execute("INSERT OR REPLACE INTO meta VALUES ('last_run_error_count', ?)", (str(errors),))
    conn.commit()
    conn.close()

    log.info(
        f"Done: {ok_count} tickers upserted, {history_rows} history rows, {skipped} skipped, {errors} errors"
    )


if __name__ == "__main__":
    main()
