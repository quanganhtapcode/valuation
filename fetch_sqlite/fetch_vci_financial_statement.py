#!/usr/bin/env python3
"""Fetch VCI financial statements + metrics into SQLite.

Data sources:
  - GET /v2/company/search-bar?language=1           (symbol universe)
  - GET /v1/company/{SYMBOL}/financial-statement/metrics
  - GET /v1/company/{SYMBOL}/financial-statement?section=...

Outputs:
  - SQLite DB with statement periods, statement values, and mapping metrics
  - JSON file containing raw mapping payload from metrics endpoint
  - JSON file containing symbol universe snapshot used for the run
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import logging
import random
import sqlite3
import threading
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
SEARCH_BAR_URL = "https://iq.vietcap.com.vn/api/iq-insight-service/v2/company/search-bar?language=1"
V1_COMPANY_BASE = "https://iq.vietcap.com.vn/api/iq-insight-service/v1/company"
DEVICE_ID = "".join(f"{random.randrange(256):02x}" for _ in range(12))
HTTP_LOCK = threading.Lock()


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
        # Often optional for these endpoints, but aligned with VCI patterns.
        "device-id": DEVICE_ID,
        "connection": "keep-alive",
    }


def _build_opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))


def _request_json(
    opener: urllib.request.OpenerDirector,
    url: str,
    *,
    timeout_s: int = 20,
    retries: int = 3,
    backoff_base_s: float = 0.8,
) -> dict[str, Any]:
    headers = _headers()
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url=url, headers=headers, method="GET")
            with HTTP_LOCK:
                with opener.open(req, timeout=timeout_s) as resp:
                    raw = resp.read()
                    enc = (resp.headers.get("Content-Encoding") or "").lower()
            if "gzip" in enc:
                raw = gzip.decompress(raw)
            body = json.loads(raw.decode("utf-8", errors="replace"))
            if not isinstance(body, dict):
                raise ValueError(f"Unexpected response type from {url}: {type(body).__name__}")
            return body
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 404:
                raise
            if e.code not in (429, 500, 502, 503, 504) or attempt >= retries:
                raise
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as e:
            last_err = e
            if attempt >= retries:
                raise
        delay = backoff_base_s * (2**attempt) + random.random() * 0.2
        time.sleep(delay)
    if last_err:
        raise last_err
    raise RuntimeError(f"Unexpected request loop fallthrough for {url}")


def _include_symbol(item: dict[str, Any], universe: str, allowed_floors: set[str]) -> bool:
    floor = str(item.get("floor") or "").upper()
    is_index = bool(item.get("isIndex") or item.get("index"))
    com_type = str(item.get("comTypeCode") or "").upper()
    listed = floor in {"HOSE", "HNX", "UPCOM"} and floor in allowed_floors

    if universe == "all":
        return floor in allowed_floors
    if universe == "listed":
        return listed
    if universe == "listed-non-index":
        return listed and not is_index
    # universe == "equity" (default): only stock-like instruments, no index/fund.
    return listed and not is_index and com_type in {"CT", "NH", "CK", "BH"}


def _collect_symbols(
    opener: urllib.request.OpenerDirector,
    universe: str,
    allowed_floors: set[str],
) -> tuple[list[str], list[dict[str, Any]]]:
    body = _request_json(opener, SEARCH_BAR_URL)
    data = body.get("data")
    if not isinstance(data, list):
        raise RuntimeError("search-bar response missing data[]")
    symbols: list[str] = []
    kept_meta: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in data:
        if not isinstance(item, dict):
            continue
        if not _include_symbol(item, universe, allowed_floors):
            continue
        code = str(item.get("code") or "").strip().upper()
        if not code or code in seen:
            continue
        seen.add(code)
        symbols.append(code)
        kept_meta.append(item)
    return symbols, kept_meta


def _fetch_metrics(opener: urllib.request.OpenerDirector, symbol: str) -> dict[str, list[dict[str, Any]]]:
    symbol_q = urllib.parse.quote(symbol.upper(), safe="")
    url = f"{V1_COMPANY_BASE}/{symbol_q}/financial-statement/metrics"
    body = _request_json(opener, url)
    data = body.get("data")
    if not isinstance(data, dict):
        raise RuntimeError(f"metrics invalid for {symbol}")
    out: dict[str, list[dict[str, Any]]] = {}
    for section in SECTIONS:
        arr = data.get(section)
        out[section] = arr if isinstance(arr, list) else []
    return out


def _fetch_section(
    opener: urllib.request.OpenerDirector,
    symbol: str,
    section: str,
) -> dict[str, list[dict[str, Any]]]:
    symbol_q = urllib.parse.quote(symbol.upper(), safe="")
    url = f"{V1_COMPANY_BASE}/{symbol_q}/financial-statement?section={section}"
    body = _request_json(opener, url)
    data = body.get("data")
    if not isinstance(data, dict):
        return {"years": [], "quarters": []}
    years = data.get("years")
    quarters = data.get("quarters")
    return {
        "years": years if isinstance(years, list) else [],
        "quarters": quarters if isinstance(quarters, list) else [],
    }


def _to_int(v: Any, default: int = 0) -> int:
    try:
        if v is None or v == "":
            return default
        return int(v)
    except (TypeError, ValueError):
        return default


def _to_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        import math

        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _default_out_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "vci_financial_statement_data"


def _default_db_path(out_dir: Path) -> Path:
    return out_dir / "vci_financial_statements.sqlite"


def _default_mapping_path(out_dir: Path) -> Path:
    return out_dir / "financial_statement_metrics.json"


def _default_symbols_path(out_dir: Path) -> Path:
    return out_dir / "symbols_search_bar.json"


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA temp_store=MEMORY;")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS statement_metrics (
          section        TEXT NOT NULL,
          field          TEXT NOT NULL,
          name           TEXT,
          title_vi       TEXT,
          title_en       TEXT,
          full_title_vi  TEXT,
          full_title_en  TEXT,
          level          INTEGER,
          parent         TEXT,
          fetched_at     TEXT NOT NULL,
          PRIMARY KEY (section, field)
        );
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_statement_metrics_name ON statement_metrics(name);")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS statement_periods (
          ticker         TEXT NOT NULL,
          section        TEXT NOT NULL,
          period_kind    TEXT NOT NULL,  -- YEAR | QUARTER
          year_report    INTEGER NOT NULL,
          quarter_report INTEGER NOT NULL,
          length_report  INTEGER,
          public_date    TEXT,
          create_date    TEXT,
          update_date    TEXT,
          values_json    TEXT NOT NULL,
          fetched_at     TEXT NOT NULL,
          PRIMARY KEY (ticker, section, period_kind, year_report, quarter_report)
        );
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_statement_periods_ticker ON statement_periods(ticker);")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_statement_periods_lookup ON statement_periods(ticker, section, period_kind);"
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS statement_values (
          ticker         TEXT NOT NULL,
          section        TEXT NOT NULL,
          period_kind    TEXT NOT NULL,  -- YEAR | QUARTER
          year_report    INTEGER NOT NULL,
          quarter_report INTEGER NOT NULL,
          field          TEXT NOT NULL,
          value          REAL,
          fetched_at     TEXT NOT NULL,
          PRIMARY KEY (ticker, section, period_kind, year_report, quarter_report, field)
        );
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_statement_values_ticker ON statement_values(ticker);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_statement_values_field ON statement_values(field);")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS fetch_log (
          ticker     TEXT NOT NULL,
          status     TEXT NOT NULL,
          message    TEXT,
          fetched_at TEXT NOT NULL,
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


def upsert_metrics(
    conn: sqlite3.Connection,
    metrics: dict[str, list[dict[str, Any]]],
    fetched_at: str,
) -> dict[str, set[str]]:
    section_fields: dict[str, set[str]] = {s: set() for s in SECTIONS}
    for section, rows in metrics.items():
        if section not in section_fields:
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            field = str(row.get("field") or "").strip().lower()
            if not field:
                continue
            section_fields[section].add(field)
            conn.execute(
                """
                INSERT OR REPLACE INTO statement_metrics(
                  section, field, name, title_vi, title_en, full_title_vi, full_title_en,
                  level, parent, fetched_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    section,
                    field,
                    str(row.get("name") or "").strip() or None,
                    str(row.get("titleVi") or "").strip() or None,
                    str(row.get("titleEn") or "").strip() or None,
                    str(row.get("fullTitleVi") or "").strip() or None,
                    str(row.get("fullTitleEn") or "").strip() or None,
                    _to_int(row.get("level"), 0) or None,
                    str(row.get("parent") or "").strip() or None,
                    fetched_at,
                ),
            )
    conn.commit()
    return section_fields


def _quarter_value(row: dict[str, Any], period_kind: str) -> int:
    if period_kind == "YEAR":
        return 0
    for key in ("quarterReport", "quarter", "lengthReport"):
        qv = _to_int(row.get(key), 0)
        if 0 <= qv <= 4 and qv != 0:
            return qv
    return 0


def upsert_symbol_statements(
    conn: sqlite3.Connection,
    symbol: str,
    section_payloads: dict[str, dict[str, list[dict[str, Any]]]],
    fields_by_section: dict[str, set[str]],
    fetched_at: str,
    *,
    store_values_json: bool,
) -> tuple[int, int]:
    ticker = symbol.upper()
    period_rows = 0
    value_rows = 0
    with conn:
        for section in SECTIONS:
            conn.execute("DELETE FROM statement_periods WHERE ticker = ? AND section = ?", (ticker, section))
            conn.execute("DELETE FROM statement_values WHERE ticker = ? AND section = ?", (ticker, section))

            payload = section_payloads.get(section) or {"years": [], "quarters": []}
            for period_kind, rows_key in (("YEAR", "years"), ("QUARTER", "quarters")):
                rows = payload.get(rows_key)
                if not isinstance(rows, list):
                    continue
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    year_report = _to_int(row.get("yearReport") or row.get("year"), 0)
                    quarter_report = _quarter_value(row, period_kind)
                    if year_report <= 0:
                        continue

                    conn.execute(
                        """
                        INSERT OR REPLACE INTO statement_periods(
                          ticker, section, period_kind, year_report, quarter_report, length_report,
                          public_date, create_date, update_date, values_json, fetched_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            ticker,
                            section,
                            period_kind,
                            year_report,
                            quarter_report,
                            _to_int(row.get("lengthReport"), 0) or None,
                            str(row.get("publicDate") or "").strip() or None,
                            str(row.get("createDate") or "").strip() or None,
                            str(row.get("updateDate") or "").strip() or None,
                            (
                                json.dumps(row, ensure_ascii=False, separators=(",", ":"))
                                if store_values_json
                                else "{}"
                            ),
                            fetched_at,
                        ),
                    )
                    period_rows += 1

                    fields = fields_by_section.get(section) or set()
                    for field in fields:
                        if field not in row:
                            continue
                        fv = _to_float(row.get(field))
                        conn.execute(
                            """
                            INSERT OR REPLACE INTO statement_values(
                              ticker, section, period_kind, year_report, quarter_report, field, value, fetched_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                ticker,
                                section,
                                period_kind,
                                year_report,
                                quarter_report,
                                field,
                                fv,
                                fetched_at,
                            ),
                        )
                        value_rows += 1
    return period_rows, value_rows


def _fetch_symbol_all_sections(
    opener: urllib.request.OpenerDirector,
    symbol: str,
) -> dict[str, dict[str, list[dict[str, Any]]]]:
    out: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for section in SECTIONS:
        out[section] = _fetch_section(opener, symbol, section)
    return out


def _norm_floor_set(floor_arg: str) -> set[str]:
    if not floor_arg.strip():
        return {"HOSE", "HNX", "UPCOM", "OTC", "OTHER", "STOP"}
    parts = {p.strip().upper() for p in floor_arg.split(",") if p.strip()}
    if "ALL" in parts:
        return {"HOSE", "HNX", "UPCOM", "OTC", "OTHER", "STOP"}
    valid = {"HOSE", "HNX", "UPCOM", "OTC", "OTHER", "STOP"}
    keep = parts & valid
    if not keep:
        raise ValueError(f"Invalid --floors={floor_arg}. Valid: {', '.join(sorted(valid))},ALL")
    return keep


def _trim_period_rows(
    rows: list[dict[str, Any]],
    period_kind: str,
    max_years: int,
    max_quarters: int,
) -> list[dict[str, Any]]:
    if not rows:
        return []

    if period_kind == "YEAR":
        cap = max_years if max_years > 0 else len(rows)
        sorted_rows = sorted(rows, key=lambda r: _to_int(r.get("yearReport") or r.get("year"), 0), reverse=True)
        return sorted_rows[:cap]

    cap = max_quarters if max_quarters > 0 else len(rows)

    def _yq(r: dict[str, Any]) -> tuple[int, int]:
        y = _to_int(r.get("yearReport") or r.get("year"), 0)
        q = _to_int(r.get("quarterReport") or r.get("quarter") or r.get("lengthReport"), 0)
        return (y, q)

    sorted_rows = sorted(rows, key=_yq, reverse=True)
    return sorted_rows[:cap]


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch VCI financial statement + metrics into SQLite and mapping JSON."
    )
    parser.add_argument("--symbols", default="", help="Comma-separated symbols to fetch. Empty = use search-bar list.")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of symbols after discovery.")
    parser.add_argument("--workers", type=int, default=10, help="Parallel workers for fetching symbols.")
    parser.add_argument(
        "--batch-size",
        type=int,
        default=50,
        help="How many symbols to fetch per batch. Lower = lower RAM/IO spike.",
    )
    parser.add_argument(
        "--universe",
        choices=["all", "listed", "listed-non-index", "equity"],
        default="equity",
        help="Symbol universe when --symbols is empty. Default: equity (listed stocks only).",
    )
    parser.add_argument(
        "--floors",
        default="HOSE,HNX,UPCOM",
        help="Comma-separated floor filter (e.g. HOSE or HOSE,HNX,UPCOM or ALL).",
    )
    parser.add_argument(
        "--max-years",
        type=int,
        default=8,
        help="Keep latest N yearly periods per symbol/section. 0 = keep all.",
    )
    parser.add_argument(
        "--max-quarters",
        type=int,
        default=16,
        help="Keep latest N quarterly periods per symbol/section. 0 = keep all.",
    )
    parser.add_argument(
        "--store-values-json",
        action="store_true",
        help="Store full raw period JSON in statement_periods.values_json (bigger DB). Default: off.",
    )
    parser.add_argument(
        "--resume-missing",
        action="store_true",
        help="When enabled, skip symbols already marked ok/error in fetch_log and fetch only missing.",
    )
    parser.add_argument("--retry", type=int, default=3, help="HTTP retries per request.")
    parser.add_argument("--timeout", type=int, default=20, help="HTTP timeout seconds.")
    parser.add_argument("--mapping-symbol", default="FPT", help="Symbol used to fetch metrics mapping.")
    parser.add_argument("--out-dir", default="", help="Output folder. Default: <repo>/vci_financial_statement_data")
    parser.add_argument("--db-path", default="", help="SQLite DB path. Default: <out-dir>/vci_financial_statements.sqlite")
    parser.add_argument(
        "--mapping-file",
        default="",
        help="Mapping JSON path. Default: <out-dir>/financial_statement_metrics.json",
    )
    parser.add_argument(
        "--symbols-file",
        default="",
        help="Symbols snapshot JSON path. Default: <out-dir>/symbols_search_bar.json",
    )
    parser.add_argument("--test-only", action="store_true", help="Fetch only mapping-symbol (ignores list).")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    opener = _build_opener()

    out_dir = Path(args.out_dir).resolve() if args.out_dir else _default_out_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    db_path = Path(args.db_path).resolve() if args.db_path else _default_db_path(out_dir)
    mapping_path = Path(args.mapping_file).resolve() if args.mapping_file else _default_mapping_path(out_dir)
    symbols_path = Path(args.symbols_file).resolve() if args.symbols_file else _default_symbols_path(out_dir)

    conn = sqlite3.connect(str(db_path))
    ensure_schema(conn)
    fetched_at = dt.datetime.now(dt.timezone.utc).isoformat()

    metrics = _fetch_metrics(opener, args.mapping_symbol.upper())
    fields_by_section = upsert_metrics(conn, metrics, fetched_at)
    mapping_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("Mapping saved: %s", mapping_path)

    floors = _norm_floor_set(args.floors)

    if args.symbols.strip():
        symbols = sorted({s.strip().upper() for s in args.symbols.split(",") if s.strip()})
        symbol_meta: list[dict[str, Any]] = [{"code": s} for s in symbols]
    else:
        symbols, symbol_meta = _collect_symbols(opener, args.universe, floors)

    if args.test_only:
        symbols = [args.mapping_symbol.upper()]
        symbol_meta = [{"code": args.mapping_symbol.upper()}]

    if args.limit and args.limit > 0:
        symbols = symbols[: args.limit]

    if args.resume_missing:
        done_rows = conn.execute("SELECT DISTINCT ticker FROM fetch_log WHERE status IN ('ok','error')").fetchall()
        done = {r[0] for r in done_rows if r and r[0]}
        symbols = [s for s in symbols if s not in done]

    symbols_path.write_text(
        json.dumps(
            {
                "fetched_at": fetched_at,
                "universe": args.universe,
                "floors": sorted(floors),
                "count": len(symbols),
                "symbols": symbols,
                "raw_count": len(symbol_meta),
                "raw_data": symbol_meta,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    log.info("Symbols snapshot saved: %s (count=%d)", symbols_path, len(symbols))

    if not symbols:
        log.error("No symbols to fetch.")
        return 1

    success = 0
    failed = 0
    total_period_rows = 0
    total_value_rows = 0
    started = time.time()

    max_workers = max(1, min(int(args.workers), 32))
    log.info("Fetching %d symbols with %d workers", len(symbols), max_workers)

    batch_size = max(1, int(args.batch_size))
    processed = 0
    for bstart in range(0, len(symbols), batch_size):
        batch = symbols[bstart : bstart + batch_size]
        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            fut_map = {ex.submit(_fetch_symbol_all_sections, opener, sym): sym for sym in batch}
            for fut in as_completed(fut_map):
                symbol = fut_map[fut]
                try:
                    raw_payloads = fut.result()
                    trimmed_payloads: dict[str, dict[str, list[dict[str, Any]]]] = {}
                    for section in SECTIONS:
                        sec_payload = raw_payloads.get(section) or {"years": [], "quarters": []}
                        years = _trim_period_rows(
                            sec_payload.get("years") if isinstance(sec_payload.get("years"), list) else [],
                            "YEAR",
                            args.max_years,
                            args.max_quarters,
                        )
                        quarters = _trim_period_rows(
                            sec_payload.get("quarters") if isinstance(sec_payload.get("quarters"), list) else [],
                            "QUARTER",
                            args.max_years,
                            args.max_quarters,
                        )
                        if not args.store_values_json:
                            for row in years:
                                row.pop("values_json", None)
                            for row in quarters:
                                row.pop("values_json", None)
                        trimmed_payloads[section] = {"years": years, "quarters": quarters}

                    p_rows, v_rows = upsert_symbol_statements(
                        conn,
                        symbol,
                        section_payloads=trimmed_payloads,
                        fields_by_section=fields_by_section,
                        fetched_at=fetched_at,
                        store_values_json=args.store_values_json,
                    )
                    total_period_rows += p_rows
                    total_value_rows += v_rows
                    success += 1
                    conn.execute(
                        "INSERT OR REPLACE INTO fetch_log(ticker, status, message, fetched_at) VALUES (?, ?, ?, ?)",
                        (symbol, "ok", f"period_rows={p_rows}, value_rows={v_rows}", fetched_at),
                    )
                except Exception as e:
                    failed += 1
                    conn.execute(
                        "INSERT OR REPLACE INTO fetch_log(ticker, status, message, fetched_at) VALUES (?, ?, ?, ?)",
                        (symbol, "error", str(e)[:800], fetched_at),
                    )
                    log.warning("Failed %s: %s", symbol, e)
                processed += 1
                if processed % 50 == 0 or processed == len(symbols):
                    log.info("Progress %d/%d | ok=%d failed=%d", processed, len(symbols), success, failed)
        conn.commit()
    conn.commit()

    elapsed = time.time() - started
    conn.execute("INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)", ("last_run_at", fetched_at))
    conn.execute("INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)", ("last_run_success", str(success)))
    conn.execute("INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)", ("last_run_failed", str(failed)))
    conn.execute("INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)", ("last_run_seconds", f"{elapsed:.2f}"))
    conn.commit()
    conn.close()

    log.info(
        "Done. symbols=%d ok=%d failed=%d period_rows=%d value_rows=%d elapsed=%.1fs db=%s",
        len(symbols),
        success,
        failed,
        total_period_rows,
        total_value_rows,
        elapsed,
        db_path,
    )
    return 0 if success > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
