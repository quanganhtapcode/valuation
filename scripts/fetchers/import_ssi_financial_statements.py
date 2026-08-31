#!/usr/bin/env python3
"""Convert SSI JSONL financial statements into the VCI-compatible SQLite schema.

Only the quarterly and yearly arrays are imported.  ``sixMonths`` and
``nineMonths`` are intentionally excluded, so they cannot collide with a
quarterly period in the VCI-wide tables.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import re
import sqlite3
from pathlib import Path
from typing import Any

from fetch_vci_financial_statement import (
    SECTION_TABLE_MAP,
    _ensure_wide_table,
    ensure_schema,
    upsert_metrics,
)


log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

SOURCE_FILES = {
    "BALANCE_SHEET": "balance_sheets.jsonl",
    "INCOME_STATEMENT": "ssi_income_statements.jsonl",
    "CASH_FLOW": "data.jsonl",
}
FIELD_CODE_RE = re.compile(r"^[a-z]{3}\d+$", re.IGNORECASE)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--db-path",
        default="data/financial-statements/vci_financial_statement_data/vci_financial_statements.sqlite",
        help="Destination SQLite path.",
    )
    parser.add_argument(
        "--mapping-file",
        default="data/financial-statements/vci_financial_statement_data/financial_statement_metrics.json",
        help="Existing VCI metrics JSON used for labels and base columns.",
    )
    parser.add_argument(
        "--section",
        choices=sorted(SOURCE_FILES),
        help="Import one section only; useful for incremental or resource-limited runs.",
    )
    return parser.parse_args()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON in {path}:{number}") from exc
            if isinstance(value, dict):
                rows.append(value)
    return rows


def period_payload(record: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Map SSI buckets to the two period kinds supported by the VCI schema."""
    data = record.get("data")
    items = data.get("items") if isinstance(data, dict) else None
    item = items[0] if isinstance(items, list) and items and isinstance(items[0], dict) else {}
    quarterly = item.get("quarterly")
    yearly = item.get("yearly")
    return {
        "quarters": quarterly if isinstance(quarterly, list) else [],
        "years": yearly if isinstance(yearly, list) else [],
    }


def field_codes(records: list[dict[str, Any]]) -> set[str]:
    fields: set[str] = set()
    for record in records:
        payload = period_payload(record)
        for rows in payload.values():
            for row in rows:
                if isinstance(row, dict):
                    fields.update(
                        key.lower()
                        for key in row
                        if isinstance(key, str) and FIELD_CODE_RE.fullmatch(key)
                    )
    return fields


def main() -> int:
    args = parse_args()
    root = Path(__file__).resolve().parents[2]
    db_path = (root / args.db_path).resolve() if not Path(args.db_path).is_absolute() else Path(args.db_path)
    mapping_path = (
        (root / args.mapping_file).resolve()
        if not Path(args.mapping_file).is_absolute()
        else Path(args.mapping_file)
    )
    if not mapping_path.is_file():
        raise FileNotFoundError(f"VCI mapping file not found: {mapping_path}")

    metrics = json.loads(mapping_path.read_text(encoding="utf-8"))
    if not isinstance(metrics, dict):
        raise ValueError("Metrics file must contain a JSON object")

    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    ensure_schema(conn)
    imported_at = dt.datetime.now(dt.timezone.utc).isoformat()
    fields_by_section = upsert_metrics(conn, metrics, imported_at)
    source_files = (
        {args.section: SOURCE_FILES[args.section]} if args.section else SOURCE_FILES
    )
    records_by_section = {
        section: read_jsonl(root / filename) for section, filename in source_files.items()
    }
    wide_columns: dict[str, set[str]] = {}
    for section, table in SECTION_TABLE_MAP.items():
        extra_fields = field_codes(records_by_section.get(section, [])) - fields_by_section[section]
        for field in extra_fields:
            conn.execute(
                "INSERT OR IGNORE INTO statement_metrics(section, field, name, fetched_at) VALUES (?, ?, ?, ?)",
                (section, field, field.upper(), imported_at),
            )
        fields_by_section[section].update(extra_fields)
        fields = sorted(fields_by_section.get(section, set()))
        _ensure_wide_table(conn, table, fields)
        wide_columns[section] = set(fields)

    total_symbols = total_periods = total_rows = 0
    with conn:
        for section, records in records_by_section.items():
            table = SECTION_TABLE_MAP[section]
            fields = sorted(wide_columns[section])
            field_columns = ", ".join(f'"{field}"' for field in fields)
            placeholders = ", ".join("?" for _ in fields)
            wide_sql = (
                f"INSERT OR REPLACE INTO {table} "
                f"(ticker, period_kind, year_report, quarter_report, length_report, public_date, "
                f"create_date, update_date, fetched_at, {field_columns}) "
                f"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, {placeholders})"
            )
            period_sql = """
                INSERT OR REPLACE INTO statement_periods(
                  ticker, section, period_kind, year_report, quarter_report, length_report,
                  public_date, create_date, update_date, values_json, fetched_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """
            for record in records:
                symbol = str(record.get("symbol") or "").strip().upper()
                if not symbol:
                    continue
                fetched_at = str(record.get("fetched_at") or imported_at)
                total_symbols += 1
                payload = period_payload(record)
                for period_kind, rows in (("YEAR", payload["years"]), ("QUARTER", payload["quarters"])):
                    for row in rows:
                        year = row.get("yearReport")
                        quarter = 0 if period_kind == "YEAR" else row.get("quarterReport")
                        if not isinstance(year, int) or year <= 0 or not isinstance(quarter, int):
                            continue
                        raw_fields = {key.lower(): value for key, value in row.items() if isinstance(key, str)}
                        conn.execute(
                            period_sql,
                            (symbol, section, period_kind, year, quarter, None, None, None, None, "{}", fetched_at),
                        )
                        conn.execute(
                            wide_sql,
                            [symbol, period_kind, year, quarter, None, None, None, None, fetched_at]
                            + [raw_fields.get(field) for field in fields],
                        )
                        total_periods += 1
                        total_rows += 1

    conn.execute("INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)", ("data_source", "SSI JSONL"))
    conn.execute("INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)", ("imported_at", imported_at))
    conn.execute("INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)", ("periods_included", "quarterly,yearly"))
    conn.commit()
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    log.info(
        "Done: symbols=%d periods=%d wide_rows=%d db=%s",
        total_symbols,
        total_periods,
        total_rows,
        db_path,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
