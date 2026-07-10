"""Canonical security universe built from company metadata and live screening."""

from __future__ import annotations

import datetime as dt
import argparse
import os
import sqlite3
from typing import Any

from backend.db_path import (
    resolve_vci_company_db_path,
    resolve_vci_screening_db_path,
)


_EXCHANGE_MAP = {
    "HSX": "HOSE",
    "HOSE": "HOSE",
    "HNX": "HNX",
    "UPCOM": "UPCOM",
}


def normalize_exchange(value: Any) -> str | None:
    """Return the canonical exchange name used across the application."""
    text = str(value or "").strip().upper()
    return _EXCHANGE_MAP.get(text)


def _load_active_exchanges(screening_db_path: str) -> dict[str, str]:
    if not os.path.exists(screening_db_path):
        raise FileNotFoundError(f"Screening DB not found: {screening_db_path}")

    uri = f"file:{os.path.abspath(screening_db_path)}?mode=ro"
    with sqlite3.connect(uri, uri=True) as conn:
        rows = conn.execute(
            """
            SELECT UPPER(TRIM(ticker)), exchange
            FROM screening_data
            WHERE ticker IS NOT NULL AND TRIM(ticker) <> ''
            """
        ).fetchall()

    active = {
        ticker: exchange
        for ticker, raw_exchange in rows
        if (exchange := normalize_exchange(raw_exchange))
    }
    if not active:
        raise RuntimeError("Screening DB contains no active listed securities")
    return active


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS security_master (
            ticker          TEXT PRIMARY KEY,
            exchange        TEXT,
            security_type   TEXT NOT NULL DEFAULT 'stock',
            listing_status  TEXT NOT NULL DEFAULT 'unknown',
            is_active       INTEGER NOT NULL DEFAULT 0,
            is_bank         INTEGER NOT NULL DEFAULT 0,
            company_id      TEXT,
            icb_code1       TEXT,
            icb_code2       TEXT,
            icb_code3       TEXT,
            icb_code4       TEXT,
            first_seen_at   TEXT NOT NULL,
            last_seen_at    TEXT,
            synced_at       TEXT NOT NULL,
            source          TEXT NOT NULL DEFAULT 'vci_company+vci_screening',
            FOREIGN KEY (ticker) REFERENCES companies(ticker)
        );

        CREATE INDEX IF NOT EXISTS idx_security_master_active
            ON security_master(is_active, security_type, exchange);
        CREATE INDEX IF NOT EXISTS idx_security_master_icb4
            ON security_master(icb_code4);

        DROP VIEW IF EXISTS active_stocks;
        CREATE VIEW active_stocks AS
        SELECT
            sm.ticker,
            sm.exchange,
            sm.security_type,
            sm.listing_status,
            sm.is_active,
            sm.is_bank,
            c.organ_name,
            c.en_organ_name,
            c.short_name,
            c.en_short_name,
            c.logo_url,
            c.company_id,
            c.icb_code1,
            c.icb_code2,
            c.icb_code3,
            c.icb_code4,
            c.icb_name1,
            c.icb_name2,
            c.icb_name3,
            c.icb_name4,
            c.en_icb_name1,
            c.en_icb_name2,
            c.en_icb_name3,
            c.en_icb_name4,
            sm.first_seen_at,
            sm.last_seen_at,
            sm.synced_at
        FROM security_master AS sm
        JOIN companies AS c ON c.ticker = sm.ticker
        WHERE sm.is_active = 1 AND sm.security_type = 'stock';
        """
    )


def refresh_security_master(
    company_db_path: str | None = None,
    screening_db_path: str | None = None,
) -> dict[str, int]:
    """Refresh the canonical security universe without mutating source tables."""
    company_path = company_db_path or resolve_vci_company_db_path()
    screening_path = screening_db_path or resolve_vci_screening_db_path()
    active_exchanges = _load_active_exchanges(screening_path)
    synced_at = dt.datetime.now(tz=dt.timezone.utc).replace(microsecond=0).isoformat()

    with sqlite3.connect(company_path) as conn:
        conn.row_factory = sqlite3.Row
        _ensure_schema(conn)
        companies = conn.execute(
            """
            SELECT ticker, floor, isbank, is_index, company_id,
                   icb_code1, icb_code2, icb_code3, icb_code4
            FROM companies
            WHERE ticker IS NOT NULL AND TRIM(ticker) <> ''
            """
        ).fetchall()

        rows: list[dict[str, Any]] = []
        active_count = 0
        for company in companies:
            ticker = str(company["ticker"]).strip().upper()
            is_index = bool(company["is_index"])
            security_type = "index" if is_index else "stock"
            exchange = active_exchanges.get(ticker) or normalize_exchange(company["floor"])
            is_active = int(not is_index and ticker in active_exchanges)
            if is_active:
                listing_status = "active"
                active_count += 1
            elif exchange:
                listing_status = "inactive"
            else:
                listing_status = "unlisted"

            rows.append(
                {
                    "ticker": ticker,
                    "exchange": exchange,
                    "security_type": security_type,
                    "listing_status": listing_status,
                    "is_active": is_active,
                    "is_bank": int(bool(company["isbank"])),
                    "company_id": company["company_id"],
                    "icb_code1": company["icb_code1"],
                    "icb_code2": company["icb_code2"],
                    "icb_code3": company["icb_code3"],
                    "icb_code4": company["icb_code4"],
                    "first_seen_at": synced_at,
                    "last_seen_at": synced_at if is_active else None,
                    "synced_at": synced_at,
                }
            )

        conn.executemany(
            """
            INSERT INTO security_master (
                ticker, exchange, security_type, listing_status, is_active,
                is_bank, company_id, icb_code1, icb_code2, icb_code3, icb_code4,
                first_seen_at, last_seen_at, synced_at
            ) VALUES (
                :ticker, :exchange, :security_type, :listing_status, :is_active,
                :is_bank, :company_id, :icb_code1, :icb_code2, :icb_code3, :icb_code4,
                :first_seen_at, :last_seen_at, :synced_at
            )
            ON CONFLICT(ticker) DO UPDATE SET
                exchange = excluded.exchange,
                security_type = excluded.security_type,
                listing_status = excluded.listing_status,
                is_active = excluded.is_active,
                is_bank = excluded.is_bank,
                company_id = excluded.company_id,
                icb_code1 = excluded.icb_code1,
                icb_code2 = excluded.icb_code2,
                icb_code3 = excluded.icb_code3,
                icb_code4 = excluded.icb_code4,
                last_seen_at = COALESCE(excluded.last_seen_at, security_master.last_seen_at),
                synced_at = excluded.synced_at
            """,
            rows,
        )
        conn.execute(
            "DELETE FROM security_master WHERE ticker NOT IN (SELECT UPPER(TRIM(ticker)) FROM companies)"
        )
        conn.commit()

    return {
        "total": len(rows),
        "active": active_count,
        "inactive": len(rows) - active_count,
    }


def active_stock_symbols(company_db_path: str | None = None) -> list[str]:
    """Load the active stock universe from the canonical security master."""
    company_path = company_db_path or resolve_vci_company_db_path()
    uri = f"file:{os.path.abspath(company_path)}?mode=ro"
    with sqlite3.connect(uri, uri=True) as conn:
        return [
            row[0]
            for row in conn.execute(
                "SELECT ticker FROM active_stocks ORDER BY ticker"
            ).fetchall()
        ]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Refresh the canonical security master in vci_company.sqlite"
    )
    parser.add_argument("--company-db", default=None)
    parser.add_argument("--screening-db", default=None)
    args = parser.parse_args()

    summary = refresh_security_master(
        company_db_path=args.company_db,
        screening_db_path=args.screening_db,
    )
    print(
        "security_master refreshed: "
        f"active={summary['active']} inactive={summary['inactive']} total={summary['total']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
