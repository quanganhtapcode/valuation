"""Non-destructive financial statement writes with explicit source tracking."""

from __future__ import annotations

import datetime as dt
import json
import math
import sqlite3

KEYS = ("ticker", "period_kind", "year_report", "quarter_report")
META = (*KEYS, "length_report", "public_date", "create_date", "update_date", "fetched_at")
TABLES = {"BALANCE_SHEET": "balance_sheet", "INCOME_STATEMENT": "income_statement",
          "CASH_FLOW": "cash_flow", "NOTE": "note"}


def ensure_provenance(conn: sqlite3.Connection) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS statement_provenance (
        ticker TEXT NOT NULL, section TEXT NOT NULL, period_kind TEXT NOT NULL,
        year_report INTEGER NOT NULL, quarter_report INTEGER NOT NULL,
        data_source TEXT NOT NULL, fetched_at TEXT NOT NULL,
        retained_fields_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (ticker, section, period_kind, year_report, quarter_report)
    )""")


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError, OverflowError):
        return None


def timestamp(value: str) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=dt.timezone.utc) if parsed.tzinfo is None else parsed


def write_statement(conn: sqlite3.Connection, section: str, metadata: dict,
                    values: dict, source: str, values_json: str = "{}") -> bool:
    """Keep existing non-NULL fields; SSI may revise only explicitly SSI rows.

    Provenance describes the latest writer. Fields retained from a previous
    payload retain their source and fetch timestamp in retained_fields_json.
    Rows predating provenance are deliberately classified as legacy/unknown.
    Caller owns the transaction and table schema.
    """
    table = TABLES[section]
    if source not in {"VCI", "SSI", "legacy"}:
        raise ValueError("Unsupported financial source")
    year, quarter = metadata["year_report"], metadata["quarter_report"]
    kind = metadata["period_kind"]
    if (not isinstance(year, int) or year <= 0 or
            not isinstance(quarter, int) or
            not ((kind == "YEAR" and quarter == 0) or
                 (kind == "QUARTER" and 1 <= quarter <= 4))):
        raise ValueError("Invalid financial statement period")
    incoming = {field: number(value) for field, value in values.items()}
    if not any(value is not None for value in incoming.values()):
        return False
    key = tuple(metadata[field] for field in KEYS)
    where = " AND ".join(f"{field}=?" for field in KEYS)
    cursor = conn.execute(f"SELECT * FROM {table} WHERE {where}", key)
    row = cursor.fetchone()
    previous = dict(zip((col[0] for col in cursor.description), row)) if row else {}
    provenance_key = (metadata["ticker"], section, kind, year, quarter)
    old = conn.execute("""SELECT data_source, fetched_at, retained_fields_json
        FROM statement_provenance WHERE ticker=? AND section=? AND period_kind=?
        AND year_report=? AND quarter_report=?""", provenance_key).fetchone()
    old_source, old_date, retained = old if old else (
        "legacy", previous.get("fetched_at", ""), "{}")
    if previous and source == "SSI" and old_source != "SSI":
        return False
    if previous and old_date:
        incoming_date, previous_date = timestamp(metadata["fetched_at"]), timestamp(old_date)
        if incoming_date < previous_date or (source == old_source and incoming_date == previous_date):
            return False
    retained_sources = json.loads(retained)
    for field, value in previous.items():
        if field in META or value is None:
            continue
        if incoming.get(field) is None:
            incoming[field] = value
            retained_sources.setdefault(field, {"source": old_source, "fetched_at": old_date})
        else:
            retained_sources.pop(field, None)
    merged_meta = {field: metadata.get(field) if metadata.get(field) is not None
                   else previous.get(field) for field in META}
    fields = [*META, *incoming]
    quoted = ",".join('"' + field.replace('"', '""') + '"' for field in fields)
    conn.execute(f"INSERT OR REPLACE INTO {table} ({quoted}) VALUES "
                 f"({','.join('?' for _ in fields)})",
                 [*merged_meta.values(), *incoming.values()])
    conn.execute("""INSERT OR REPLACE INTO statement_periods
        (ticker, section, period_kind, year_report, quarter_report, length_report,
         public_date, create_date, update_date, values_json, fetched_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (*provenance_key, *(merged_meta[field] for field in
          ("length_report", "public_date", "create_date", "update_date")),
         values_json, merged_meta["fetched_at"]))
    conn.execute("""INSERT OR REPLACE INTO statement_provenance
        (ticker,section,period_kind,year_report,quarter_report,data_source,fetched_at,retained_fields_json)
        VALUES (?,?,?,?,?,?,?,?)""",
        (*provenance_key, source, metadata["fetched_at"],
         json.dumps(retained_sources, separators=(",", ":"))))
    return True
