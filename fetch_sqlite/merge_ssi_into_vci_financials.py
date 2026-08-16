#!/usr/bin/env python3
"""Merge SSI fallback periods into the website's preferred VCI SQLite cache.

VCI is never overwritten: an SSI row is inserted only when the same
``ticker, period_kind, year_report, quarter_report`` does not exist in VCI.

Notes are intentionally excluded: SSI currently supplies no note rows. Their
fallback is handled by ``fetch_vci_financial_statement.py``, which preserves
the last successful VCI notes snapshot in a separate SQLite archive.
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
# SSI-backed sections only. NOTE is VCI-only and has its own historical archive.
TABLES = ("balance_sheet", "income_statement", "cash_flow")
KEY_COLUMNS = ("ticker", "period_kind", "year_report", "quarter_report")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vci-db", default="fetch_sqlite/vci_financials.sqlite")
    parser.add_argument(
        "--ssi-db",
        default="vci_financial_statement_data/vci_financial_statements.sqlite",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-backup", action="store_true")
    return parser.parse_args()


def columns(connection: sqlite3.Connection, schema: str, table: str) -> list[str]:
    return [row[1] for row in connection.execute(f"PRAGMA {schema}.table_info({table})")]


def missing_count(connection: sqlite3.Connection, table: str) -> int:
    return connection.execute(
        f"""
        SELECT COUNT(*) FROM ssi.{table} AS s
        WHERE NOT EXISTS (
          SELECT 1 FROM main.{table} AS v
          WHERE {" AND ".join(f"v.{key} = s.{key}" for key in KEY_COLUMNS)}
        )
        """
    ).fetchone()[0]


def main() -> int:
    args = parse_args()
    vci_db = (ROOT / args.vci_db).resolve() if not Path(args.vci_db).is_absolute() else Path(args.vci_db)
    ssi_db = (ROOT / args.ssi_db).resolve() if not Path(args.ssi_db).is_absolute() else Path(args.ssi_db)
    if not vci_db.is_file() or not ssi_db.is_file():
        raise FileNotFoundError("Both --vci-db and --ssi-db must exist")

    connection = sqlite3.connect(vci_db)
    connection.execute("ATTACH DATABASE ? AS ssi", (f"file:{ssi_db}?mode=ro",))
    counts = {table: missing_count(connection, table) for table in TABLES}
    print("SSI fallback periods to insert:", counts, "total=", sum(counts.values()))
    if args.dry_run:
        connection.close()
        return 0

    if not args.no_backup:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup = vci_db.with_name(f"{vci_db.stem}.pre-ssi-merge-{stamp}{vci_db.suffix}")
        shutil.copy2(vci_db, backup)
        print(f"Backup created: {backup}")

    with connection:
        for table in TABLES:
            target_columns = columns(connection, "main", table)
            source_columns = set(columns(connection, "ssi", table))
            for field in sorted(source_columns - set(target_columns)):
                connection.execute(f'ALTER TABLE main.{table} ADD COLUMN "{field}" REAL')
            target_columns = columns(connection, "main", table)
            shared = [column for column in target_columns if column in source_columns]
            fields_sql = ", ".join(f'"{column}"' for column in shared)
            select_sql = ", ".join(f's."{column}"' for column in shared)
            connection.execute(
                f"""
                INSERT INTO main.{table} ({fields_sql})
                SELECT {select_sql} FROM ssi.{table} AS s
                WHERE NOT EXISTS (
                  SELECT 1 FROM main.{table} AS v
                  WHERE {" AND ".join(f"v.{key} = s.{key}" for key in KEY_COLUMNS)}
                )
                """
            )

        connection.execute(
            """
            INSERT OR IGNORE INTO statement_periods
            SELECT s.* FROM ssi.statement_periods AS s
            WHERE s.section IN ('BALANCE_SHEET', 'INCOME_STATEMENT', 'CASH_FLOW')
              AND NOT EXISTS (
                SELECT 1 FROM main.statement_periods AS v
                WHERE v.ticker = s.ticker AND v.section = s.section
                  AND v.period_kind = s.period_kind AND v.year_report = s.year_report
                  AND v.quarter_report = s.quarter_report
              )
            """
        )
        connection.execute(
            "INSERT OR IGNORE INTO statement_metrics SELECT * FROM ssi.statement_metrics"
        )
        connection.execute(
            "INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)",
            ("ssi_fallback_merged_at", datetime.now(timezone.utc).isoformat()),
        )
    connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    connection.close()
    print("Merge complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
