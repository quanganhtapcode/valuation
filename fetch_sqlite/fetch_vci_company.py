#!/usr/bin/env python3
"""Fetch VCI company info (search-bar) into SQLite.

Source:
  GET https://iq.vietcap.com.vn/api/iq-insight-service/v2/company/search-bar?language=1

Output:
  fetch_sqlite/vci_company.sqlite   (default)

Tables:
  companies        – one row per ticker (upsert on re-run)
  fetch_log        – one row per run

Usage:
  python fetch_vci_company.py                        # fetch all, default output
  python fetch_vci_company.py --db /path/out.sqlite  # custom DB path
  python fetch_vci_company.py --dry-run              # print JSON, no write

NOTE: The VCI domain (iq.vietcap.com.vn) blocks datacenter IPs.
      Run this script from your local machine, then upload the SQLite to the VPS.
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
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)

SEARCH_BAR_URL_TMPL = (
    "https://iq.vietcap.com.vn/api/iq-insight-service/v2/company/search-bar"
    "?language={language}"
)

DEFAULT_DB_NAME = "vci_company.sqlite"


# ── HTTP helpers ──────────────────────────────────────────────────────────────

def _device_id() -> str:
    return "".join(f"{random.randrange(256):02x}" for _ in range(12))


def _headers() -> dict[str, str]:
    return {
        "accept": "application/json",
        "accept-encoding": "gzip, deflate, br",
        "accept-language": "en-US,en;q=0.9,vi-VN;q=0.8,vi;q=0.7",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "origin": "https://trading.vietcap.com.vn",
        "referer": "https://trading.vietcap.com.vn/",
        "user-agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/145.0.0.0 Safari/537.36"
        ),
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "sec-ch-ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "device-id": _device_id(),
        "connection": "keep-alive",
    }


def _build_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))


def _request_json(
    opener: urllib.request.OpenerDirector,
    url: str,
    *,
    timeout_s: int = 30,
    retries: int = 4,
    backoff_base: float = 1.0,
) -> Any:
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url=url, headers=_headers(), method="GET")
            with opener.open(req, timeout=timeout_s) as resp:
                raw = resp.read()
                enc = (resp.headers.get("Content-Encoding") or "").lower()
            if "gzip" in enc:
                raw = gzip.decompress(raw)
            return json.loads(raw.decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 404:
                raise
            if e.code not in (429, 500, 502, 503, 504) or attempt >= retries:
                raise
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
            last_err = e
            if attempt >= retries:
                raise
        delay = backoff_base * (2 ** attempt) + random.random() * 0.3
        log.warning("Attempt %d failed, retrying in %.1fs…", attempt + 1, delay)
        time.sleep(delay)
    raise last_err or RuntimeError("request failed")


# ── Data extraction ───────────────────────────────────────────────────────────

def _str(item: dict, *keys: str) -> str | None:
    """Return the first non-empty string found under any of the given keys."""
    for k in keys:
        v = item.get(k)
        if v is not None and str(v).strip():
            return str(v).strip()
    return None


def _float(item: dict, *keys: str) -> float | None:
    for k in keys:
        v = item.get(k)
        if v is None:
            continue
        try:
            return float(v)
        except (TypeError, ValueError):
            continue
    return None


def _icb_code_name(item: dict[str, Any], level: int) -> tuple[str | None, str | None]:
    """Extract ICB code/name for a given level from both legacy and nested shapes."""
    # New shape from search-bar:
    #   icbLv1: {"code":"3000","name":"Hàng Tiêu dùng",...}
    lv = item.get(f"icbLv{level}")
    if isinstance(lv, dict):
        code = _str(lv, "code")
        name = _str(lv, "name")
        if code or name:
            return code, name

    # Legacy fallback keys
    code = _str(item, f"icbCode{level}", f"icb_code{level}")
    name = _str(item, f"icbName{level}", f"icb_name{level}")
    return code, name


def _parse_company(
    item_vi: dict[str, Any],
    fetched_at: str,
    *,
    item_en: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Normalise one search-bar item into a flat dict matching the DB schema."""
    icb_code1, icb_name1 = _icb_code_name(item_vi, 1)
    icb_code2, icb_name2 = _icb_code_name(item_vi, 2)
    icb_code3, icb_name3 = _icb_code_name(item_vi, 3)
    icb_code4, icb_name4 = _icb_code_name(item_vi, 4)

    en_icb_name1 = en_icb_name2 = en_icb_name3 = en_icb_name4 = None
    if item_en:
        _, en_icb_name1 = _icb_code_name(item_en, 1)
        _, en_icb_name2 = _icb_code_name(item_en, 2)
        _, en_icb_name3 = _icb_code_name(item_en, 3)
        _, en_icb_name4 = _icb_code_name(item_en, 4)

    return {
        "ticker":         _str(item_vi, "code", "ticker", "symbol") or "",
        "organ_name":     _str(item_vi, "organName", "organ_name", "companyName", "name"),
        "en_organ_name":  _str(
            item_en or {},
            "organName",
            "organ_name",
            "companyName",
            "name",
            "enOrganName",
            "en_organ_name",
            "enCompanyName",
            "enName",
        ),
        "short_name":     _str(item_vi, "organShortName", "shortName", "short_name"),
        "en_short_name":  _str(item_en or {}, "organShortName", "shortName", "short_name", "enOrganShortName", "enShortName", "en_short_name"),
        "floor":          _str(item_vi, "floor", "exchange") or "",
        "logo_url":       _str(item_vi, "logoUrl", "logo_url"),
        "target_price":   _float(item_vi, "targetPrice", "target_price"),
        "isbank":         1 if (item_vi.get("isBank") or item_vi.get("bank")) else 0,
        "is_index":       1 if (item_vi.get("isIndex") or item_vi.get("index")) else 0,
        # ICB numeric codes
        "icb_code1":      icb_code1,
        "icb_code2":      icb_code2,
        "icb_code3":      icb_code3,
        "icb_code4":      icb_code4,
        # ICB sector/industry names – VCI returns both VI and EN depending on language param
        "icb_name1":      icb_name1,
        "icb_name2":      icb_name2,
        "icb_name3":      icb_name3,
        "icb_name4":      icb_name4,
        # English ICB names (returned by some VCI endpoints alongside VI names)
        "en_icb_name1":   en_icb_name1 or _str(item_vi, "enIcbName1", "en_icb_name1"),
        "en_icb_name2":   en_icb_name2 or _str(item_vi, "enIcbName2", "en_icb_name2"),
        "en_icb_name3":   en_icb_name3 or _str(item_vi, "enIcbName3", "en_icb_name3"),
        "en_icb_name4":   en_icb_name4 or _str(item_vi, "enIcbName4", "en_icb_name4"),
        # ID
        "company_id":     _str(item_vi, "companyId", "organCode", "id"),
        "fetched_at":     fetched_at,
    }


# ── SQLite schema ─────────────────────────────────────────────────────────────

_COMPANIES_DDL = """
CREATE TABLE IF NOT EXISTS companies (
    ticker          TEXT PRIMARY KEY,
    organ_name      TEXT,
    en_organ_name   TEXT,
    short_name      TEXT,
    en_short_name   TEXT,
    floor           TEXT,
    logo_url        TEXT,
    target_price    REAL,
    isbank          INTEGER DEFAULT 0,
    is_index        INTEGER DEFAULT 0,
    icb_code1       TEXT,
    icb_code2       TEXT,
    icb_code3       TEXT,
    icb_code4       TEXT,
    icb_name1       TEXT,
    icb_name2       TEXT,
    icb_name3       TEXT,
    icb_name4       TEXT,
    en_icb_name1    TEXT,
    en_icb_name2    TEXT,
    en_icb_name3    TEXT,
    en_icb_name4    TEXT,
    company_id      TEXT,
    fetched_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_companies_floor ON companies(floor);
CREATE INDEX IF NOT EXISTS idx_companies_icb4  ON companies(icb_code4);
"""

_FETCH_LOG_DDL = """
CREATE TABLE IF NOT EXISTS fetch_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    fetched_at  TEXT NOT NULL,
    total_raw   INTEGER,
    inserted    INTEGER,
    status      TEXT,
    error       TEXT
);
"""

_UPSERT = """
INSERT INTO companies (
    ticker, organ_name, en_organ_name, short_name, en_short_name,
    floor, logo_url, target_price, isbank, is_index,
    icb_code1, icb_code2, icb_code3, icb_code4,
    icb_name1, icb_name2, icb_name3, icb_name4,
    en_icb_name1, en_icb_name2, en_icb_name3, en_icb_name4,
    company_id, fetched_at
) VALUES (
    :ticker, :organ_name, :en_organ_name, :short_name, :en_short_name,
    :floor, :logo_url, :target_price, :isbank, :is_index,
    :icb_code1, :icb_code2, :icb_code3, :icb_code4,
    :icb_name1, :icb_name2, :icb_name3, :icb_name4,
    :en_icb_name1, :en_icb_name2, :en_icb_name3, :en_icb_name4,
    :company_id, :fetched_at
)
ON CONFLICT(ticker) DO UPDATE SET
    organ_name      = excluded.organ_name,
    en_organ_name   = excluded.en_organ_name,
    short_name      = excluded.short_name,
    en_short_name   = excluded.en_short_name,
    floor           = excluded.floor,
    logo_url        = excluded.logo_url,
    target_price    = excluded.target_price,
    isbank          = excluded.isbank,
    is_index        = excluded.is_index,
    icb_code1       = excluded.icb_code1,
    icb_code2       = excluded.icb_code2,
    icb_code3       = excluded.icb_code3,
    icb_code4       = excluded.icb_code4,
    icb_name1       = excluded.icb_name1,
    icb_name2       = excluded.icb_name2,
    icb_name3       = excluded.icb_name3,
    icb_name4       = excluded.icb_name4,
    en_icb_name1    = excluded.en_icb_name1,
    en_icb_name2    = excluded.en_icb_name2,
    en_icb_name3    = excluded.en_icb_name3,
    en_icb_name4    = excluded.en_icb_name4,
    company_id      = excluded.company_id,
    fetched_at      = excluded.fetched_at;
"""


_COMPANY_COLUMNS = [
    "ticker",
    "organ_name",
    "en_organ_name",
    "short_name",
    "en_short_name",
    "floor",
    "logo_url",
    "target_price",
    "isbank",
    "is_index",
    "icb_code1",
    "icb_code2",
    "icb_code3",
    "icb_code4",
    "icb_name1",
    "icb_name2",
    "icb_name3",
    "icb_name4",
    "en_icb_name1",
    "en_icb_name2",
    "en_icb_name3",
    "en_icb_name4",
    "company_id",
    "fetched_at",
]


def _ensure_companies_schema(conn: sqlite3.Connection) -> None:
    exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='companies' LIMIT 1"
    ).fetchone()
    if not exists:
        conn.executescript(_COMPANIES_DDL)
        return

    cols = [r[1] for r in conn.execute("PRAGMA table_info(companies)").fetchall()]
    if cols == _COMPANY_COLUMNS:
        conn.executescript(
            """
            CREATE INDEX IF NOT EXISTS idx_companies_floor ON companies(floor);
            CREATE INDEX IF NOT EXISTS idx_companies_icb4  ON companies(icb_code4);
            """
        )
        return

    log.info("Migrating companies schema to remove obsolete columns and add new fields...")
    conn.execute("ALTER TABLE companies RENAME TO companies_old")
    conn.executescript(_COMPANIES_DDL)
    shared = [c for c in _COMPANY_COLUMNS if c in cols]
    if shared:
        sel = ",".join(shared)
        conn.execute(f"INSERT INTO companies ({sel}) SELECT {sel} FROM companies_old")
    conn.execute("DROP TABLE companies_old")


def _init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(_FETCH_LOG_DDL)
    _ensure_companies_schema(conn)
    conn.commit()


def _write_companies(
    conn: sqlite3.Connection,
    rows: list[dict[str, Any]],
    fetched_at: str,
    total_raw: int,
) -> int:
    conn.executemany(_UPSERT, rows)
    conn.execute(
        "INSERT INTO fetch_log (fetched_at, total_raw, inserted, status) VALUES (?,?,?,?)",
        (fetched_at, total_raw, len(rows), "ok"),
    )
    conn.commit()
    return len(rows)


# ── Main ──────────────────────────────────────────────────────────────────────

def _default_db_path() -> Path:
    return Path(__file__).resolve().parent / DEFAULT_DB_NAME


def fetch_and_store(db_path: Path, *, dry_run: bool = False) -> None:
    fetched_at = dt.datetime.now(tz=dt.timezone.utc).replace(microsecond=0).isoformat()
    opener = _build_opener()

    log.info("Fetching company search-bar (VI) from VCI…")
    body_vi = _request_json(opener, SEARCH_BAR_URL_TMPL.format(language=1))
    log.info("Fetching company search-bar (EN) from VCI…")
    body_en = _request_json(opener, SEARCH_BAR_URL_TMPL.format(language=2))

    raw_items_vi: list[dict] = body_vi.get("data") if isinstance(body_vi.get("data"), list) else []
    if not raw_items_vi and isinstance(body_vi, list):
        raw_items_vi = body_vi  # some versions return a bare array

    raw_items_en: list[dict] = body_en.get("data") if isinstance(body_en.get("data"), list) else []
    if not raw_items_en and isinstance(body_en, list):
        raw_items_en = body_en

    if not raw_items_vi:
        raise RuntimeError(f"Unexpected VI response structure: {list(body_vi.keys()) if isinstance(body_vi, dict) else type(body_vi)}")
    if not raw_items_en:
        raise RuntimeError(f"Unexpected EN response structure: {list(body_en.keys()) if isinstance(body_en, dict) else type(body_en)}")

    log.info("Got %d VI items and %d EN items from search-bar", len(raw_items_vi), len(raw_items_en))

    # Print sample keys on first run so we can see what VCI returns
    sample_keys = list(raw_items_vi[0].keys()) if raw_items_vi else []
    log.info("Sample keys from first item: %s", sample_keys)

    en_by_ticker: dict[str, dict[str, Any]] = {}
    for item in raw_items_en:
        tk = _str(item, "code", "ticker", "symbol")
        if tk:
            en_by_ticker[tk.upper()] = item

    rows = []
    skipped = 0
    for item_vi in raw_items_vi:
        ticker = _str(item_vi, "code", "ticker", "symbol")
        item_en = en_by_ticker.get(ticker.upper()) if ticker else None
        row = _parse_company(item_vi, fetched_at, item_en=item_en)
        if not row["ticker"]:
            skipped += 1
            continue
        rows.append(row)

    log.info("Parsed %d companies (%d skipped – no ticker)", len(rows), skipped)

    if dry_run:
        log.info("DRY RUN – printing first 5 parsed rows:")
        for r in rows[:5]:
            print(json.dumps(r, ensure_ascii=False, indent=2))
        log.info("DRY RUN – printing first 3 raw items:")
        for item in raw_items_vi[:3]:
            print(json.dumps(item, ensure_ascii=False, indent=2))
        return

    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    try:
        _init_db(conn)
        n = _write_companies(conn, rows, fetched_at, len(raw_items_vi))
        log.info("Wrote %d companies to %s", n, db_path)
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch VCI company info (search-bar) → SQLite"
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=_default_db_path(),
        help=f"Output SQLite path (default: {_default_db_path()})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print parsed data without writing to DB",
    )
    args = parser.parse_args()

    try:
        fetch_and_store(args.db, dry_run=args.dry_run)
    except urllib.error.HTTPError as e:
        if e.code in (403, 503):
            log.error(
                "HTTP %d from iq.vietcap.com.vn — your IP is blocked.\n"
                "Run this script from your local Windows machine (not the VPS),\n"
                "then copy the resulting SQLite file to the server.",
                e.code,
            )
        else:
            log.error("HTTP error: %s", e)
        raise SystemExit(1)
    except Exception as e:
        log.error("Fatal: %s", e)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
