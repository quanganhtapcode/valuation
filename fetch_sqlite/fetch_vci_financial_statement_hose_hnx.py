#!/usr/bin/env python3
"""Fetch VCI BS/IS/CF/NOTE for HOSE+HNX into normalized wide tables.

Endpoints used:
  - /v1/company/{symbol}/financial-statement?section=BALANCE_SHEET
  - /v1/company/{symbol}/financial-statement?section=INCOME_STATEMENT
  - /v1/company/{symbol}/financial-statement?section=CASH_FLOW
  - /v1/company/{symbol}/financial-statement?section=NOTE

Tables (plain names, wide):
  - balance_sheet
  - income_statement
  - cash_flow
  - note
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import logging
import random
import re
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)

SECTIONS = ("BALANCE_SHEET", "INCOME_STATEMENT", "CASH_FLOW", "NOTE")
SECTION_TABLE = {
    "BALANCE_SHEET": "balance_sheet",
    "INCOME_STATEMENT": "income_statement",
    "CASH_FLOW": "cash_flow",
    "NOTE": "note",
}
OLD_SECTION_TABLE = {
    "BALANCE_SHEET": "statement_wide_balance_sheet",
    "INCOME_STATEMENT": "statement_wide_income_statement",
    "CASH_FLOW": "statement_wide_cash_flow",
    "NOTE": "statement_wide_note",
}
V1_COMPANY_BASE = "https://iq.vietcap.com.vn/api/iq-insight-service/v1/company"
FIELD_CODE_RE = re.compile(r"^[a-z]{3}\d+$", re.IGNORECASE)
DEVICE_ID = "".join(f"{random.randrange(256):02x}" for _ in range(12))


def _headers() -> dict[str, str]:
    return {
        "accept": "application/json",
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": "en-US,en;q=0.9,vi;q=0.8",
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
        "device-id": DEVICE_ID,
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
) -> dict[str, Any]:
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url=url, headers=_headers(), method="GET")
            with opener.open(req, timeout=timeout_s) as resp:
                raw = resp.read()
                enc = (resp.headers.get("Content-Encoding") or "").lower()
            if "gzip" in enc:
                raw = gzip.decompress(raw)
            body = json.loads(raw.decode("utf-8", errors="replace"))
            if not isinstance(body, dict):
                raise ValueError(f"Unexpected response type: {type(body).__name__}")
            return body
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code not in (429, 500, 502, 503, 504) or attempt >= retries:
                raise
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as e:
            last_err = e
            if attempt >= retries:
                raise
        time.sleep(backoff_base_s * (2**attempt) + random.random() * 0.25)

    if last_err:
        raise last_err
    raise RuntimeError("request loop finished unexpectedly")


def _to_int(v: Any, default: int = 0) -> int:
    try:
        if v is None or v == "":
            return default
        return int(v)
    except (TypeError, ValueError):
        return default


def _to_float(v: Any) -> float | None:
    try:
        if v is None or v == "":
            return None
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):
        return None
    return f


def _quarter_value(row: dict[str, Any], period_kind: str) -> int:
    if period_kind == "YEAR":
        return 0
    for key in ("quarterReport", "quarter", "lengthReport"):
        qv = _to_int(row.get(key), 0)
        if 0 < qv <= 4:
            return qv
    return 0


def _qident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _field_sort_key(field: str) -> tuple[str, int, str]:
    f = (field or "").strip().lower()
    m = re.match(r"^([a-z]+)(\d+)$", f)
    if not m:
        return (f, 10**9, f)
    return (m.group(1), int(m.group(2)), f)


def _base_cols() -> list[str]:
    return [
        "ticker",
        "period_kind",
        "year_report",
        "quarter_report",
        "length_report",
        "public_date",
        "create_date",
        "update_date",
        "fetched_at",
    ]


def _default_company_db_path() -> Path:
    return Path(__file__).resolve().parent / "vci_company.sqlite"


def _default_db_path() -> Path:
    return Path(__file__).resolve().parent / "vci_financial_statement_hose_hnx.sqlite"


def _default_metrics_json_path() -> Path:
    return Path(__file__).resolve().parent / "vci_financial_statement_metrics_hose_hnx.json"


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
        (table,),
    ).fetchone()
    return bool(row)


def _load_symbols_from_company_db(company_db: Path, limit: int) -> list[str]:
    if not company_db.exists():
        raise FileNotFoundError(f"Company DB not found: {company_db}")
    conn = sqlite3.connect(str(company_db))
    try:
        rows = conn.execute(
            """
            SELECT ticker
            FROM companies
            WHERE is_index = 0
              AND floor IN ('HOSE', 'HNX')
              AND ticker IS NOT NULL
              AND TRIM(ticker) <> ''
            ORDER BY ticker
            """
        ).fetchall()
    finally:
        conn.close()
    symbols = [str(r[0]).strip().upper() for r in rows if r and r[0]]
    if limit > 0:
        symbols = symbols[:limit]
    return symbols


def _load_retry_failed_symbols(db_path: Path, limit: int) -> list[str]:
    if not db_path.exists():
        return []
    conn = sqlite3.connect(str(db_path))
    try:
        row = conn.execute("SELECT v FROM meta WHERE k='last_run_at'").fetchone()
        if not row or not row[0]:
            return []
        rows = conn.execute(
            "SELECT ticker FROM fetch_log WHERE fetched_at=? AND status='error' ORDER BY ticker",
            (str(row[0]),),
        ).fetchall()
    finally:
        conn.close()
    symbols = [str(r[0]).strip().upper() for r in rows if r and r[0]]
    if limit > 0:
        symbols = symbols[:limit]
    return symbols


def _load_retry_missing_symbols(company_db: Path, db_path: Path, limit: int) -> list[str]:
    universe = set(_load_symbols_from_company_db(company_db, 0))
    if not db_path.exists():
        out = sorted(universe)
        return out[:limit] if limit > 0 else out

    conn = sqlite3.connect(str(db_path))
    try:
        rows = conn.execute(
            """
            SELECT DISTINCT ticker FROM (
              SELECT ticker FROM balance_sheet
              UNION
              SELECT ticker FROM income_statement
              UNION
              SELECT ticker FROM cash_flow
              UNION
              SELECT ticker FROM note
            )
            """
        ).fetchall()
    finally:
        conn.close()

    done = {str(r[0]).strip().upper() for r in rows if r and r[0]}
    out = sorted(universe - done)
    if limit > 0:
        out = out[:limit]
    return out


def _migrate_old_table_names(conn: sqlite3.Connection) -> None:
    for sec in SECTIONS:
        old = OLD_SECTION_TABLE[sec]
        new = SECTION_TABLE[sec]
        if _table_exists(conn, old) and not _table_exists(conn, new):
            conn.execute(f"ALTER TABLE {old} RENAME TO {new}")
    conn.commit()


def _create_section_table(conn: sqlite3.Connection, table: str) -> None:
    conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table} (
          ticker         TEXT NOT NULL,
          period_kind    TEXT NOT NULL,
          year_report    INTEGER NOT NULL,
          quarter_report INTEGER NOT NULL,
          length_report  INTEGER,
          public_date    TEXT,
          create_date    TEXT,
          update_date    TEXT,
          fetched_at     TEXT NOT NULL,
          PRIMARY KEY (ticker, period_kind, year_report, quarter_report)
        );
        """
    )
    conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_ticker ON {table}(ticker)")
    conn.execute(
        f"CREATE INDEX IF NOT EXISTS idx_{table}_lookup ON {table}(ticker, period_kind, year_report, quarter_report)"
    )


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    conn.execute("PRAGMA auto_vacuum=INCREMENTAL;")  # reclaim free pages incrementally

    _migrate_old_table_names(conn)
    for sec in SECTIONS:
        _create_section_table(conn, SECTION_TABLE[sec])

    # Cleanup legacy row-based / obsolete tables now that pipeline is wide-only.
    conn.execute("DROP TABLE IF EXISTS statement_periods")
    conn.execute("DROP TABLE IF EXISTS statement_values")
    conn.execute("DROP TABLE IF EXISTS statement_wide")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS fetch_log (
          ticker        TEXT NOT NULL,
          status        TEXT NOT NULL,
          message       TEXT,
          fetched_at    TEXT NOT NULL,
          row_count     INTEGER DEFAULT 0,
          PRIMARY KEY (ticker, fetched_at)
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


def _wide_existing_cols(conn: sqlite3.Connection, table: str) -> list[str]:
    return [str(r[1]) for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]


def _ensure_wide_columns(conn: sqlite3.Connection, table: str, fields: set[str]) -> None:
    if not fields:
        return
    existing = set(_wide_existing_cols(conn, table))
    for field in sorted(fields, key=_field_sort_key):
        if field in existing:
            continue
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {_qident(field)} REAL")


def _reorder_wide_columns(conn: sqlite3.Connection, table: str) -> bool:
    current = _wide_existing_cols(conn, table)
    base = _base_cols()
    dynamic = [c for c in current if c not in set(base)]
    desired = base + sorted(dynamic, key=_field_sort_key)
    if current == desired:
        return False

    tmp = f"{table}_tmp_reorder"
    conn.execute(f"DROP TABLE IF EXISTS {tmp}")
    defs: list[str] = []
    for c in desired:
        if c in {"ticker", "period_kind"}:
            defs.append(f"{_qident(c)} TEXT NOT NULL")
        elif c in {"year_report", "quarter_report"}:
            defs.append(f"{_qident(c)} INTEGER NOT NULL")
        elif c == "length_report":
            defs.append(f"{_qident(c)} INTEGER")
        elif c in {"public_date", "create_date", "update_date"}:
            defs.append(f"{_qident(c)} TEXT")
        elif c == "fetched_at":
            defs.append(f"{_qident(c)} TEXT NOT NULL")
        else:
            defs.append(f"{_qident(c)} REAL")
    pk = "PRIMARY KEY (ticker, period_kind, year_report, quarter_report)"
    conn.execute(f"CREATE TABLE {tmp} ({', '.join(defs)}, {pk})")
    shared = [c for c in desired if c in set(current)]
    s = ", ".join(_qident(c) for c in shared)
    conn.execute(f"INSERT INTO {tmp} ({s}) SELECT {s} FROM {table}")
    conn.execute(f"DROP TABLE {table}")
    conn.execute(f"ALTER TABLE {tmp} RENAME TO {table}")
    conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_ticker ON {table}(ticker)")
    conn.execute(
        f"CREATE INDEX IF NOT EXISTS idx_{table}_lookup ON {table}(ticker, period_kind, year_report, quarter_report)"
    )
    return True


def _reorder_all_tables(conn: sqlite3.Connection) -> int:
    changed = 0
    for sec in SECTIONS:
        if _reorder_wide_columns(conn, SECTION_TABLE[sec]):
            changed += 1
    conn.commit()
    return changed


def _extract_field_values(row: dict[str, Any]) -> dict[str, float | None]:
    out: dict[str, float | None] = {}
    for k, v in row.items():
        if not isinstance(k, str):
            continue
        f = k.strip().lower()
        if FIELD_CODE_RE.fullmatch(f):
            out[f] = _to_float(v)
    return out


def _fetch_symbol_sections(
    symbol: str,
    *,
    timeout_s: int,
    retries: int,
    backoff_base_s: float,
) -> dict[str, dict[str, list[dict[str, Any]]]]:
    opener = _build_opener()
    symbol_q = urllib.parse.quote(symbol.upper(), safe="")
    out: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for sec in SECTIONS:
        url = f"{V1_COMPANY_BASE}/{symbol_q}/financial-statement?section={sec}"
        body = _request_json(opener, url, timeout_s=timeout_s, retries=retries, backoff_base_s=backoff_base_s)
        data = body.get("data")
        if not isinstance(data, dict):
            out[sec] = {"years": [], "quarters": []}
            continue
        years = data.get("years")
        quarters = data.get("quarters")
        out[sec] = {
            "years": years if isinstance(years, list) else [],
            "quarters": quarters if isinstance(quarters, list) else [],
        }
    return out


def _upsert_symbol(
    conn: sqlite3.Connection,
    symbol: str,
    payloads: dict[str, dict[str, list[dict[str, Any]]]],
    fetched_at: str,
) -> int:
    ticker = symbol.upper()

    fields_by_sec: dict[str, set[str]] = {s: set() for s in SECTIONS}
    for sec in SECTIONS:
        p = payloads.get(sec) or {"years": [], "quarters": []}
        for rows_key in ("years", "quarters"):
            rows = p.get(rows_key)
            if not isinstance(rows, list):
                continue
            for row in rows:
                if isinstance(row, dict):
                    fields_by_sec[sec].update(_extract_field_values(row).keys())
    for sec in SECTIONS:
        _ensure_wide_columns(conn, SECTION_TABLE[sec], fields_by_sec[sec])

    row_count = 0
    with conn:
        for sec in SECTIONS:
            table = SECTION_TABLE[sec]
            conn.execute(f"DELETE FROM {table} WHERE ticker = ?", (ticker,))
            p = payloads.get(sec) or {"years": [], "quarters": []}
            for period_kind, rows_key in (("YEAR", "years"), ("QUARTER", "quarters")):
                rows = p.get(rows_key)
                if not isinstance(rows, list):
                    continue
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    y = _to_int(row.get("yearReport") or row.get("year"), 0)
                    if y <= 0:
                        continue
                    q = _quarter_value(row, period_kind)
                    fv = _extract_field_values(row)
                    base_cols = _base_cols()
                    base_vals: list[Any] = [
                        ticker,
                        period_kind,
                        y,
                        q,
                        _to_int(row.get("lengthReport"), 0) or None,
                        str(row.get("publicDate") or "").strip() or None,
                        str(row.get("createDate") or "").strip() or None,
                        str(row.get("updateDate") or "").strip() or None,
                        fetched_at,
                    ]
                    dyn = sorted(fv.keys(), key=_field_sort_key)
                    cols = base_cols + dyn
                    vals = base_vals + [fv[c] for c in dyn]
                    conn.execute(
                        f"INSERT OR REPLACE INTO {table} ({', '.join(_qident(c) for c in cols)}) "
                        f"VALUES ({', '.join(['?'] * len(cols))})",
                        vals,
                    )
                    row_count += 1
    return row_count


def _load_metrics_json(path: Path) -> dict[str, dict[str, dict[str, Any]]]:
    m: dict[str, dict[str, dict[str, Any]]] = {s: {} for s in SECTIONS}
    if not path.exists():
        return m
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return m
    if not isinstance(raw, dict):
        return m
    for sec in SECTIONS:
        rows = raw.get(sec)
        if not isinstance(rows, list):
            continue
        for item in rows:
            if not isinstance(item, dict):
                continue
            f = str(item.get("field") or "").strip().lower()
            if f:
                m[sec][f] = item
    return m


def _save_metrics_json(path: Path, mapping: dict[str, dict[str, dict[str, Any]]]) -> None:
    out: dict[str, list[dict[str, Any]]] = {}
    for sec in SECTIONS:
        out[sec] = [mapping[sec][f] for f in sorted(mapping[sec].keys(), key=_field_sort_key)]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")


def _fetch_metrics(opener: urllib.request.OpenerDirector, symbol: str, timeout_s: int, retries: int, backoff_base_s: float) -> dict[str, dict[str, Any]]:
    symbol_q = urllib.parse.quote(symbol.upper(), safe="")
    url = f"{V1_COMPANY_BASE}/{symbol_q}/financial-statement/metrics"
    body = _request_json(opener, url, timeout_s=timeout_s, retries=retries, backoff_base_s=backoff_base_s)
    data = body.get("data")
    if not isinstance(data, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for sec in SECTIONS:
        arr = data.get(sec)
        if not isinstance(arr, list):
            continue
        for item in arr:
            if not isinstance(item, dict):
                continue
            f = str(item.get("field") or "").strip().lower()
            if f:
                out[f"{sec}:{f}"] = item
    return out


def _needed_keys_from_tables(conn: sqlite3.Connection) -> set[str]:
    keys: set[str] = set()
    base = set(_base_cols())
    for sec in SECTIONS:
        table = SECTION_TABLE[sec]
        cols = _wide_existing_cols(conn, table)
        for c in cols:
            if c in base:
                continue
            if FIELD_CODE_RE.fullmatch(c):
                keys.add(f"{sec}:{c}")
    return keys


def _find_symbol_with_field(conn: sqlite3.Connection, section: str, field: str, preferred: str) -> str | None:
    table = SECTION_TABLE[section]
    if preferred:
        row = conn.execute(
            f"SELECT ticker FROM {table} WHERE ticker=? AND {_qident(field)} IS NOT NULL LIMIT 1",
            (preferred,),
        ).fetchone()
        if row and row[0]:
            return str(row[0]).strip().upper()
    row = conn.execute(
        f"SELECT ticker FROM {table} WHERE {_qident(field)} IS NOT NULL ORDER BY ticker LIMIT 1"
    ).fetchone()
    if row and row[0]:
        return str(row[0]).strip().upper()
    return None


def _build_metrics_map(
    conn: sqlite3.Connection,
    metrics_json: Path,
    prefer_symbol: str,
    max_calls: int,
    timeout_s: int,
    retries: int,
    backoff_base_s: float,
    fill_placeholder: bool,
) -> tuple[int, int, int]:
    mapping = _load_metrics_json(metrics_json)
    needed = _needed_keys_from_tables(conn)
    known = {f"{s}:{f}" for s in SECTIONS for f in mapping[s].keys()}
    missing = needed - known
    if not missing:
        _save_metrics_json(metrics_json, mapping)
        return (0, 0, 0)

    opener = _build_opener()
    cache: dict[str, dict[str, dict[str, Any]] | None] = {}
    calls = 0
    added = 0
    pref = prefer_symbol.strip().upper()

    def _get_symbol_metrics(sym: str) -> dict[str, dict[str, Any]] | None:
        nonlocal calls
        if sym in cache:
            return cache[sym]
        if calls >= max_calls:
            return None
        try:
            payload = _fetch_metrics(opener, sym, timeout_s, retries, backoff_base_s)
        except Exception:
            payload = None
        calls += 1
        cache[sym] = payload
        return payload

    for key in sorted(list(missing), key=lambda x: _field_sort_key(x.split(":", 1)[1])):
        if calls >= max_calls:
            break
        if key not in missing:
            continue
        sec, field = key.split(":", 1)
        sym = _find_symbol_with_field(conn, sec, field, pref)
        if not sym:
            continue
        payload = _get_symbol_metrics(sym)
        if not payload:
            continue
        item = payload.get(key)
        if not item:
            continue
        if field not in mapping[sec]:
            mapping[sec][field] = item
            added += 1
        else:
            old = mapping[sec][field]
            if (
                (not str(old.get("titleVi") or "").strip() and str(item.get("titleVi") or "").strip())
                or (not str(old.get("titleEn") or "").strip() and str(item.get("titleEn") or "").strip())
            ):
                mapping[sec][field] = item
        missing.remove(key)

    if fill_placeholder and missing:
        for key in sorted(missing):
            sec, field = key.split(":", 1)
            if field in mapping[sec]:
                continue
            mapping[sec][field] = {
                "field": field,
                "name": field.upper(),
                "titleVi": field.upper(),
                "titleEn": field.upper(),
                "source": "fallback_code",
            }
            added += 1
        missing = set()

    _save_metrics_json(metrics_json, mapping)
    return (calls, added, len(missing))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fetch VCI statements (HOSE/HNX) into wide tables")
    p.add_argument("--db", default=str(_default_db_path()), help="Output sqlite path")
    p.add_argument("--company-db", default=str(_default_company_db_path()), help="Company sqlite path")
    p.add_argument("--symbols", default="", help="Comma-separated symbols override")
    p.add_argument("--limit", type=int, default=0, help="Limit symbols")
    p.add_argument("--workers", type=int, default=5, help="Fetch workers (default: 5)")
    p.add_argument("--timeout", type=int, default=20, help="HTTP timeout")
    p.add_argument("--retries", type=int, default=3, help="HTTP retries")
    p.add_argument("--backoff", type=float, default=0.8, help="Retry backoff base")
    p.add_argument("--retry-failed-latest", action="store_true", help="Retry only failed symbols in latest run")
    p.add_argument("--retry-missing", action="store_true", help="Retry only missing symbols vs HOSE+HNX universe")
    p.add_argument("--reorder-columns", action="store_true", help="Physically reorder columns by natural field order")
    p.add_argument("--build-metrics-map", action="store_true", help="Build/update metrics mapping JSON")
    p.add_argument("--metrics-json", default=str(_default_metrics_json_path()), help="Metrics mapping JSON output")
    p.add_argument("--metrics-prefer-symbol", default="AAA", help="Preferred symbol for metrics lookup")
    p.add_argument("--metrics-max-calls", type=int, default=1000, help="Max calls to metrics endpoint")
    p.add_argument("--metrics-fill-placeholder", action="store_true", help="Fill unresolved fields with fallback labels")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    fetched_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()

    db_path = Path(args.db).resolve()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    ensure_schema(conn)

    if args.reorder_columns:
        changed = _reorder_all_tables(conn)
        log.info("Reordered columns: changed_tables=%d", changed)
        conn.close()
        return 0

    if args.build_metrics_map:
        calls, added, missing = _build_metrics_map(
            conn=conn,
            metrics_json=Path(args.metrics_json).resolve(),
            prefer_symbol=str(args.metrics_prefer_symbol),
            max_calls=max(1, int(args.metrics_max_calls)),
            timeout_s=int(args.timeout),
            retries=int(args.retries),
            backoff_base_s=float(args.backoff),
            fill_placeholder=bool(args.metrics_fill_placeholder),
        )
        log.info(
            "Metrics map updated: calls=%d added=%d missing_after=%d json=%s",
            calls,
            added,
            missing,
            Path(args.metrics_json).resolve(),
        )
        conn.close()
        return 0

    if args.symbols.strip():
        symbols = sorted({s.strip().upper() for s in args.symbols.split(",") if s.strip()})
        if args.limit > 0:
            symbols = symbols[: args.limit]
        source = "cli"
    elif args.retry_failed_latest:
        symbols = _load_retry_failed_symbols(db_path, int(args.limit))
        source = "retry-failed-latest"
    elif args.retry_missing:
        symbols = _load_retry_missing_symbols(Path(args.company_db), db_path, int(args.limit))
        source = "retry-missing"
    else:
        symbols = _load_symbols_from_company_db(Path(args.company_db), int(args.limit))
        source = "company-sqlite"

    if not symbols:
        log.error("No symbols to fetch.")
        conn.close()
        return 1

    conn.execute("INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)", ("symbol_source", source))
    conn.execute("INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)", ("symbol_count", str(len(symbols))))
    conn.execute("INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)", ("floors", "HOSE,HNX"))
    conn.commit()

    log.info("Start fetch symbols=%d workers=%d db=%s", len(symbols), int(args.workers), db_path)
    ok = 0
    failed = 0
    total_rows = 0
    start = time.time()

    with ThreadPoolExecutor(max_workers=max(1, min(int(args.workers), 16))) as ex:
        fut_map = {
            ex.submit(
                _fetch_symbol_sections,
                sym,
                timeout_s=int(args.timeout),
                retries=int(args.retries),
                backoff_base_s=float(args.backoff),
            ): sym
            for sym in symbols
        }
        for idx, fut in enumerate(as_completed(fut_map), 1):
            sym = fut_map[fut]
            try:
                payloads = fut.result()
                row_count = _upsert_symbol(conn, sym, payloads, fetched_at)
                conn.execute(
                    "INSERT OR REPLACE INTO fetch_log(ticker,status,message,fetched_at,row_count) VALUES (?,?,?,?,?)",
                    (sym, "ok", "", fetched_at, row_count),
                )
                ok += 1
                total_rows += row_count
            except Exception as e:
                conn.execute(
                    "INSERT OR REPLACE INTO fetch_log(ticker,status,message,fetched_at,row_count) VALUES (?,?,?,?,0)",
                    (sym, "error", str(e)[:800], fetched_at),
                )
                failed += 1
                log.warning("Failed %s: %s", sym, e)

            if idx % 50 == 0 or idx == len(symbols):
                conn.commit()
                log.info("Progress %d/%d | ok=%d failed=%d", idx, len(symbols), ok, failed)

    changed = _reorder_all_tables(conn)
    elapsed = time.time() - start
    conn.execute("INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)", ("last_run_at", fetched_at))
    conn.execute("INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)", ("last_run_ok", str(ok)))
    conn.execute("INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)", ("last_run_failed", str(failed)))
    conn.execute("INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)", ("last_run_seconds", f"{elapsed:.2f}"))
    conn.commit()
    conn.close()

    log.info(
        "Done. symbols=%d ok=%d failed=%d rows=%d reordered_tables=%d elapsed=%.1fs",
        len(symbols),
        ok,
        failed,
        total_rows,
        changed,
        elapsed,
    )
    return 0 if ok > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
