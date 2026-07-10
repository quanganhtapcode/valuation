#!/usr/bin/env python3
"""Generate frontend-next/public/ticker_data.json from the canonical stock universe.

Source:
  vci_company.sqlite active_stocks view

Output fields per ticker:
  symbol    – ticker code
  name      – Vietnamese full name (organ_name)
  en_name   – English full name (en_organ_name)
  sector    – Vietnamese ICB level-3 sector
  en_sector – English ICB level-3 sector
  exchange  – HOSE / HNX / UPCOM
  isbank    – true if bank (from vci_company isbank flag)

Only HOSE, HNX, UPCOM listed tickers are included.

Usage:
  python scripts/generate_ticker_data.py
  python scripts/generate_ticker_data.py --dry-run   # print stats, no write
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
import sqlite3
import sys
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.db_path import resolve_vci_company_db_path
from backend.security_master import refresh_security_master

OUTPUT = ROOT / "frontend-next" / "public" / "ticker_data.json"

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

def _connect(path: str):
    if not path or not os.path.exists(path):
        return None
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def build_ticker_data() -> list[dict]:
    company_db = resolve_vci_company_db_path()
    refresh_security_master(company_db_path=company_db)

    conn = _connect(company_db)
    if not conn:
        log.error("vci_company.sqlite not found at %s", company_db)
        return []

    rows = conn.execute("""
        SELECT ticker, organ_name, en_organ_name, short_name,
               exchange, is_bank AS isbank,
               icb_name3, en_icb_name3
        FROM active_stocks
        ORDER BY ticker
    """).fetchall()
    conn.close()
    log.info("Loaded %d companies from vci_company", len(rows))

    tickers: list[dict] = []
    for r in rows:
        ticker = r["ticker"]

        tickers.append({
            "symbol":    ticker,
            "name":      r["organ_name"] or r["short_name"] or ticker,
            "en_name":   r["en_organ_name"] or r["short_name"] or ticker,
            "sector":    r["icb_name3"] or "Unknown",
            "en_sector": r["en_icb_name3"] or "Unknown",
            "exchange":  r["exchange"],
            "isbank":    bool(r["isbank"]),
        })

    log.info("Included %d active stocks from security_master", len(tickers))
    return tickers


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print stats only, no write")
    args = parser.parse_args()

    tickers = build_ticker_data()
    if not tickers:
        log.error("No tickers generated — aborting")
        sys.exit(1)

    # Stats
    banks = sum(1 for t in tickers if t["isbank"])
    by_exchange: dict[str, int] = {}
    for t in tickers:
        by_exchange[t["exchange"]] = by_exchange.get(t["exchange"], 0) + 1

    log.info("Summary: %d total | %d banks | %s",
             len(tickers), banks,
             " | ".join(f"{ex}:{cnt}" for ex, cnt in sorted(by_exchange.items())))

    payload = {
        "last_updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(tickers),
        "tickers": tickers,
    }

    if args.dry_run:
        log.info("DRY RUN — sample output:")
        sample = [t for t in tickers if t["isbank"]][:3] + [t for t in tickers if not t["isbank"]][:3]
        print(json.dumps(sample, ensure_ascii=False, indent=2))
        return

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = OUTPUT.stat().st_size / 1024
    log.info("Written to %s (%.1f KB)", OUTPUT, size_kb)


if __name__ == "__main__":
    main()
