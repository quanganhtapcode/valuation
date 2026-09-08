#!/usr/bin/env python3
"""Add missing SSI periods and refresh explicitly SSI-owned rows; protect VCI/legacy rows."""

from __future__ import annotations

import argparse
import fcntl
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

if __package__:
    from .financial_statement_storage import META, TABLES, ensure_provenance, write_statement
else:
    from financial_statement_storage import META, TABLES, ensure_provenance, write_statement

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SSI_DB = ROOT / "data/financial-statements/vci_financial_statement_data/vci_financial_statements.sqlite"


def merge_ssi(conn: sqlite3.Connection, ssi_db: Path) -> dict[str, int]:
    """Caller owns the target write lock. Source is read-only; writes are atomic."""
    if conn.in_transaction:
        raise ValueError("Commit the caller transaction before merging SSI")
    conn.execute("ATTACH DATABASE ? AS ssi", (ssi_db.resolve(strict=True).as_uri() + "?mode=ro",))
    counts = {}
    try:
        if conn.execute("SELECT v FROM ssi.meta WHERE k='data_source'").fetchone() != ("SSI JSONL",):
            raise ValueError("Fallback database must be explicitly marked SSI JSONL")
        conn.execute("BEGIN IMMEDIATE")
        ensure_provenance(conn)
        for section, table in TABLES.items():
            if section == "NOTE":
                continue
            source_fields = [r[1] for r in conn.execute(f"PRAGMA ssi.table_info({table})")]
            target_fields = {r[1] for r in conn.execute(f"PRAGMA main.table_info({table})")}
            if not set(META).issubset(source_fields) or not set(META).issubset(target_fields):
                raise ValueError(f"Missing required columns in {table}")
            for field in sorted(set(source_fields) - target_fields):
                quoted = '"' + field.replace('"', '""') + '"'
                conn.execute(f"ALTER TABLE main.{table} ADD COLUMN {quoted} REAL")
            # Legacy rows are protected even if their timestamps happen to match SSI.
            cursor = conn.execute(f"""SELECT s.* FROM ssi.{table} s
                LEFT JOIN main.{table} v USING(ticker,period_kind,year_report,quarter_report)
                LEFT JOIN main.statement_provenance p ON p.ticker=v.ticker AND p.section=?
                  AND p.period_kind=v.period_kind AND p.year_report=v.year_report
                  AND p.quarter_report=v.quarter_report
                WHERE v.ticker IS NULL OR (p.data_source='SSI'
                  AND julianday(s.fetched_at)>julianday(p.fetched_at))""", (section,))
            counts[table] = 0
            for row in cursor:
                payload = dict(zip(source_fields, row))
                counts[table] += int(write_statement(
                    conn, section, {f: payload[f] for f in META},
                    {f: v for f, v in payload.items() if f not in META}, "SSI"))
        # Explicit columns allow schema evolution and avoid SELECT * order coupling.
        fields = [r[1] for r in conn.execute("PRAGMA main.table_info(statement_metrics)")]
        source_fields = {r[1] for r in conn.execute("PRAGMA ssi.table_info(statement_metrics)")}
        shared = ','.join('"' + f.replace('"', '""') + '"' for f in fields if f in source_fields)
        conn.execute(f"""INSERT OR IGNORE INTO statement_metrics ({shared})
            SELECT {shared} FROM ssi.statement_metrics WHERE section != 'NOTE'""")
        conn.execute("INSERT OR REPLACE INTO meta(k,v) VALUES (?,?)",
                     ("ssi_fallback_merged_at", datetime.now(timezone.utc).isoformat()))
        conn.commit()
        return counts
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.execute("DETACH DATABASE ssi")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vci-db", type=Path, default=ROOT / "data/sqlite/vci_financials.sqlite")
    parser.add_argument("--ssi-db", type=Path, default=DEFAULT_SSI_DB)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-backup", action="store_true")
    args = parser.parse_args()
    target, source = args.vci_db.resolve(strict=True), args.ssi_db.resolve(strict=True)
    if target.samefile(source):
        raise ValueError("SSI source and VCI target must be different databases")
    if args.dry_run:
        # Run the exact merge against an isolated in-memory snapshot.
        with closing(sqlite3.connect(target.as_uri() + "?mode=ro", uri=True)) as reader:
            with closing(sqlite3.connect(":memory:")) as preview:
                reader.backup(preview)
                print("Dry-run SSI inserts/updates:", merge_ssi(preview, source))
        return 0
    with Path(f"{target}.safe-run.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with closing(sqlite3.connect(target)) as conn:
            if not args.no_backup:
                stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
                backup = target.with_name(f"{target.stem}.pre-ssi-merge-{stamp}{target.suffix}")
                with closing(sqlite3.connect(backup)) as destination:
                    conn.backup(destination)
                print("Backup created:", backup)
            print("SSI inserts/updates:", merge_ssi(conn, source))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
