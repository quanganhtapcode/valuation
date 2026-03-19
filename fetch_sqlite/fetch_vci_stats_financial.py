#!/usr/bin/env python3
"""Fetch VCI per-symbol statistics-financial data into SQLite.

Calls https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/{SYMBOL}/statistics-financial
for each listed symbol, extracts the most recent TTM entry, and upserts it into
vci_stats_financial.sqlite.

Run periodically (e.g. every 60 minutes) to keep financial ratios fresh:
    python fetch_sqlite/fetch_vci_stats_financial.py

All ratio values from the API are in decimal form (0.19 = 19%); stored as-is.
Use _normalize_percent_value() in source_priority.py to convert at read time.
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

# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

API_BASE = "https://iq.vietcap.com.vn/api/iq-insight-service/v1/company"
API_PATH = "statistics-financial"

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


def _fetch_symbol(
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
                data = json.loads(raw.decode("utf-8", errors="replace"))
                if isinstance(data, list):
                    return data
                if isinstance(data, dict):
                    # Some responses wrap in {"data": [...]}
                    inner = data.get("data") or data.get("result") or data.get("items")
                    if isinstance(inner, list):
                        return inner
                return None
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 404:
                return None  # symbol not found — skip silently
            if e.code not in (429, 500, 502, 503, 504) or attempt >= retries:
                raise
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_err = e
            if attempt >= retries:
                raise

        delay = backoff_base_s * (2**attempt) + random.random() * 0.3
        time.sleep(delay)

    if last_err:
        raise last_err
    return None


# ---------------------------------------------------------------------------
# SQLite
# ---------------------------------------------------------------------------

def _default_db_path() -> str:
    here = Path(__file__).resolve().parent
    return str(here / "vci_stats_financial.sqlite")


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS stats_financial_history (
          ticker               TEXT NOT NULL,
          year_report          INTEGER NOT NULL,
          quarter_report       INTEGER NOT NULL,
          period_date          TEXT,
          pe                   REAL,
          pb                   REAL,
          ps                   REAL,
          roe                  REAL,
          roa                  REAL,
          gross_margin         REAL,
          after_tax_margin     REAL,
          net_interest_margin  REAL,
          cir                  REAL,
          car                  REAL,
          casa_ratio           REAL,
          npl                  REAL,
          ldr                  REAL,
          loans_growth         REAL,
          deposit_growth       REAL,
          fetched_at           TEXT NOT NULL,
          PRIMARY KEY (ticker, year_report, quarter_report)
        );
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sfh_ticker ON stats_financial_history(ticker);"
    )
    conn.execute("""
        CREATE TABLE IF NOT EXISTS stats_financial (
          ticker               TEXT PRIMARY KEY,
          -- Valuation multiples (decimal: 0.19 = 19x for ratios; raw for P/E etc.)
          pe                   REAL,
          pb                   REAL,
          ps                   REAL,
          price_to_cash_flow   REAL,
          ev_to_ebitda         REAL,
          -- Profitability (decimal: 0.19 = 19%)
          roe                  REAL,
          roa                  REAL,
          gross_margin         REAL,
          pre_tax_margin       REAL,
          after_tax_margin     REAL,
          -- Banking-specific (decimal)
          net_interest_margin  REAL,
          cir                  REAL,
          car                  REAL,
          casa_ratio           REAL,
          npl                  REAL,
          ldr                  REAL,
          loans_growth         REAL,
          deposit_growth       REAL,
          -- Leverage
          debt_to_equity       REAL,
          financial_leverage   REAL,
          -- Liquidity
          current_ratio        REAL,
          quick_ratio          REAL,
          cash_ratio           REAL,
          asset_turnover       REAL,
          -- Market
          market_cap           REAL,
          shares               REAL,
          -- Period identifier from API
          period_date          TEXT,
          -- Raw JSON of the latest entry
          raw_json             TEXT,
          fetched_at           TEXT NOT NULL
        );
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS meta (
          k TEXT PRIMARY KEY,
          v TEXT NOT NULL
        );
    """)
    conn.commit()


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


def _extract_latest_row(entries: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return the most recent entry from the API response array.

    The API returns entries sorted oldest-first (ascending by period).
    We want the last entry (most recent TTM).
    """
    if not entries:
        return None
    # Try to sort by date field if present
    date_keys = ("date", "period", "reportDate", "periodDate", "quarter", "year")
    for key in date_keys:
        if key in entries[0]:
            try:
                sorted_entries = sorted(entries, key=lambda x: str(x.get(key) or ""), reverse=True)
                return sorted_entries[0]
            except Exception:
                pass
    # No date key found — return last element (API usually sends newest last)
    return entries[-1]


def _parse_period_date(row: dict[str, Any]) -> str | None:
    for key in ("date", "period", "reportDate", "periodDate"):
        v = row.get(key)
        if v is not None:
            return str(v)
    return None


def _parse_year_quarter(row: dict[str, Any]) -> tuple[int, int] | None:
    """Extract (year, quarter) integers from an API response row."""
    import re as _re
    # Try direct integer fields first (VCI uses yearReport + quarter)
    yr = row.get("yearReport") or row.get("year")
    qt = row.get("quarter") or row.get("quarterReport")
    if yr is not None and qt is not None:
        try:
            return int(yr), int(qt)
        except (TypeError, ValueError):
            pass
    # Fall back to parsing from a date string
    date_str = _parse_period_date(row)
    if date_str:
        m = _re.match(r"(\d{4})-(\d{2})", str(date_str))
        if m:
            year = int(m.group(1))
            month = int(m.group(2))
            quarter = (month - 1) // 3 + 1
            return year, quarter
    return None


def upsert_history_rows(
    conn: sqlite3.Connection,
    symbol: str,
    entries: list[dict[str, Any]],
    fetched_at: str,
) -> int:
    """Insert/replace all historical rows for a symbol into stats_financial_history."""
    count = 0
    for row in entries:
        yq = _parse_year_quarter(row)
        if yq is None:
            continue
        year, quarter = yq
        conn.execute("""
            INSERT INTO stats_financial_history (
              ticker, year_report, quarter_report, period_date,
              pe, pb, ps, roe, roa, gross_margin, after_tax_margin,
              net_interest_margin, cir, car, casa_ratio, npl, ldr,
              loans_growth, deposit_growth, fetched_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(ticker, year_report, quarter_report) DO UPDATE SET
              period_date          = excluded.period_date,
              pe                   = excluded.pe,
              pb                   = excluded.pb,
              ps                   = excluded.ps,
              roe                  = excluded.roe,
              roa                  = excluded.roa,
              gross_margin         = excluded.gross_margin,
              after_tax_margin     = excluded.after_tax_margin,
              net_interest_margin  = excluded.net_interest_margin,
              cir                  = excluded.cir,
              car                  = excluded.car,
              casa_ratio           = excluded.casa_ratio,
              npl                  = excluded.npl,
              ldr                  = excluded.ldr,
              loans_growth         = excluded.loans_growth,
              deposit_growth       = excluded.deposit_growth,
              fetched_at           = excluded.fetched_at
        """, (
            symbol.upper(), year, quarter, _parse_period_date(row),
            _to_float(row.get("pe")),
            _to_float(row.get("pb")),
            _to_float(row.get("ps")),
            _to_float(row.get("roe")),
            _to_float(row.get("roa")),
            _to_float(row.get("grossMargin")),
            _to_float(row.get("afterTaxProfitMargin")),
            _to_float(row.get("netInterestMargin")),
            _to_float(row.get("cir")),
            _to_float(row.get("car")),
            _to_float(row.get("casaRatio")),
            _to_float(row.get("npl")),
            _to_float(row.get("ldrLoanDepositRatio")),
            _to_float(row.get("loansGrowth")),
            _to_float(row.get("depositGrowth")),
            fetched_at,
        ))
        count += 1
    return count


def upsert_row(conn: sqlite3.Connection, symbol: str, row: dict[str, Any], fetched_at: str) -> None:
    conn.execute("""
        INSERT INTO stats_financial (
          ticker, pe, pb, ps, price_to_cash_flow, ev_to_ebitda,
          roe, roa, gross_margin, pre_tax_margin, after_tax_margin,
          net_interest_margin, cir, car, casa_ratio, npl, ldr,
          loans_growth, deposit_growth,
          debt_to_equity, financial_leverage,
          current_ratio, quick_ratio, cash_ratio, asset_turnover,
          market_cap, shares, period_date, raw_json, fetched_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?,
          ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?
        )
        ON CONFLICT(ticker) DO UPDATE SET
          pe                  = excluded.pe,
          pb                  = excluded.pb,
          ps                  = excluded.ps,
          price_to_cash_flow  = excluded.price_to_cash_flow,
          ev_to_ebitda        = excluded.ev_to_ebitda,
          roe                 = excluded.roe,
          roa                 = excluded.roa,
          gross_margin        = excluded.gross_margin,
          pre_tax_margin      = excluded.pre_tax_margin,
          after_tax_margin    = excluded.after_tax_margin,
          net_interest_margin = excluded.net_interest_margin,
          cir                 = excluded.cir,
          car                 = excluded.car,
          casa_ratio          = excluded.casa_ratio,
          npl                 = excluded.npl,
          ldr                 = excluded.ldr,
          loans_growth        = excluded.loans_growth,
          deposit_growth      = excluded.deposit_growth,
          debt_to_equity      = excluded.debt_to_equity,
          financial_leverage  = excluded.financial_leverage,
          current_ratio       = excluded.current_ratio,
          quick_ratio         = excluded.quick_ratio,
          cash_ratio          = excluded.cash_ratio,
          asset_turnover      = excluded.asset_turnover,
          market_cap          = excluded.market_cap,
          shares              = excluded.shares,
          period_date         = excluded.period_date,
          raw_json            = excluded.raw_json,
          fetched_at          = excluded.fetched_at
    """, (
        symbol.upper(),
        _to_float(row.get("pe")),
        _to_float(row.get("pb")),
        _to_float(row.get("ps")),
        _to_float(row.get("priceToCashFlow")),
        _to_float(row.get("evToEbitda")),
        _to_float(row.get("roe")),
        _to_float(row.get("roa")),
        _to_float(row.get("grossMargin")),
        _to_float(row.get("preTaxProfitMargin")),
        _to_float(row.get("afterTaxProfitMargin")),
        _to_float(row.get("netInterestMargin")),
        _to_float(row.get("cir")),
        _to_float(row.get("car")),
        _to_float(row.get("casaRatio")),
        _to_float(row.get("npl")),
        _to_float(row.get("ldrLoanDepositRatio")),
        _to_float(row.get("loansGrowth")),
        _to_float(row.get("depositGrowth")),
        _to_float(row.get("debtToEquity")),
        _to_float(row.get("financialLeverage")),
        _to_float(row.get("currentRatio")),
        _to_float(row.get("quickRatio")),
        _to_float(row.get("cashRatio")),
        _to_float(row.get("assetTurnover")),
        _to_float(row.get("marketCap")),
        _to_float(row.get("numberOfSharesMktCap")),
        _parse_period_date(row),
        json.dumps(row, ensure_ascii=False),
        fetched_at,
    ))


# ---------------------------------------------------------------------------
# Symbol sources
# ---------------------------------------------------------------------------

def _get_symbols_from_screening(screening_db: str) -> list[str]:
    if not os.path.exists(screening_db):
        return []
    try:
        conn = sqlite3.connect(screening_db)
        rows = conn.execute(
            "SELECT UPPER(ticker) FROM screening_data WHERE ticker IS NOT NULL"
        ).fetchall()
        conn.close()
        return [r[0] for r in rows if r[0]]
    except Exception as e:
        log.warning(f"Could not read symbols from screening DB: {e}")
        return []


def _get_symbols_from_stocks_db(stocks_db: str) -> list[str]:
    if not os.path.exists(stocks_db):
        return []
    try:
        conn = sqlite3.connect(stocks_db)
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
        log.warning(f"Could not read symbols from stocks DB: {e}")
    return []


def collect_symbols(args: argparse.Namespace) -> list[str]:
    symbols: list[str] = []

    if getattr(args, "symbols", None):
        return [s.strip().upper() for s in args.symbols.split(",") if s.strip()]

    # 1. VCI screening SQLite (most reliable — refreshed every 5 min)
    here = Path(__file__).resolve().parent
    screening_db = getattr(args, "screening_db", None) or str(here / "vci_screening.sqlite")
    symbols = _get_symbols_from_screening(screening_db)

    if not symbols:
        # 2. Fallback: vietnam_stocks.db
        root = here.parent
        for candidate in [
            root / "vietnam_stocks.db",
            root / "stocks.db",
            Path("/var/www/valuation/vietnam_stocks.db"),
            Path("/var/www/valuation/stocks.db"),
        ]:
            symbols = _get_symbols_from_stocks_db(str(candidate))
            if symbols:
                break

    if not symbols:
        log.error("No symbols found. Pass --symbols A,B,C or ensure screening/stocks DB exists.")

    return sorted(set(symbols))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fetch VCI statistics-financial per symbol into SQLite")
    p.add_argument("--db", default=None, help="Output SQLite path (default: fetch_sqlite/vci_stats_financial.sqlite)")
    p.add_argument("--screening-db", default=None, help="Path to vci_screening.sqlite for symbol list")
    p.add_argument("--symbols", default=None, help="Comma-separated symbol list (overrides auto-discovery)")
    p.add_argument("--workers", type=int, default=20, help="Concurrent HTTP workers (default: 20)")
    p.add_argument("--timeout", type=int, default=15, help="Per-request timeout in seconds (default: 15)")
    p.add_argument("--retries", type=int, default=3, help="Retries per symbol (default: 3)")
    p.add_argument("--delay", type=float, default=0.0, help="Extra delay between requests in seconds (default: 0)")
    p.add_argument("--batch-commit", type=int, default=50, help="Commit every N upserts (default: 50)")
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

    log.info(f"Fetching stats-financial for {len(symbols)} symbols → {db_path}")

    conn = sqlite3.connect(db_path)
    ensure_schema(conn)
    conn.execute(
        "INSERT OR REPLACE INTO meta VALUES ('last_run_started', ?)",
        (dt.datetime.now(tz=dt.timezone.utc).isoformat(),),
    )
    conn.commit()

    fetched_at = dt.datetime.now(tz=dt.timezone.utc).replace(microsecond=0).isoformat()
    ok_count = 0
    err_count = 0
    skip_count = 0
    pending_upserts = 0

    def _worker(symbol: str) -> tuple[str, list[dict] | None, Exception | None]:
        opener = _build_opener()
        try:
            if args.delay > 0:
                time.sleep(args.delay + random.random() * 0.1)
            data = _fetch_symbol(opener, symbol, timeout_s=args.timeout, retries=args.retries)
            return symbol, data, None
        except Exception as exc:
            return symbol, None, exc

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(_worker, sym): sym for sym in symbols}
        for future in as_completed(futures):
            symbol, data, exc = future.result()
            if exc is not None:
                log.debug(f"  {symbol}: error — {exc}")
                err_count += 1
                continue
            if data is None:
                skip_count += 1
                continue

            row = _extract_latest_row(data)
            if row is None:
                skip_count += 1
                continue

            try:
                upsert_row(conn, symbol, row, fetched_at)
                upsert_history_rows(conn, symbol, data, fetched_at)
                pending_upserts += 1
                ok_count += 1
                if args.verbose:
                    log.debug(f"  {symbol}: pe={row.get('pe')} pb={row.get('pb')} roe={row.get('roe')} history={len(data)}")
            except Exception as upsert_exc:
                log.warning(f"  {symbol}: upsert failed — {upsert_exc}")
                err_count += 1

            if pending_upserts >= args.batch_commit:
                conn.commit()
                pending_upserts = 0

    conn.commit()
    conn.execute(
        "INSERT OR REPLACE INTO meta VALUES ('last_run_finished', ?)",
        (dt.datetime.now(tz=dt.timezone.utc).isoformat(),),
    )
    conn.execute(
        "INSERT OR REPLACE INTO meta VALUES ('last_run_ok_count', ?)",
        (str(ok_count),),
    )
    conn.commit()
    conn.close()

    log.info(
        f"Done: {ok_count} upserted, {skip_count} skipped (no data), {err_count} errors"
    )


if __name__ == "__main__":
    main()
