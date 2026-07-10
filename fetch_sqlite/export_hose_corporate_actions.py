#!/usr/bin/env python3
"""Export HOSE corporate actions (2016-04-2026) from vci_news_events.sqlite to CSV.

Usage:
    python fetch_sqlite/export_hose_corporate_actions.py
    python fetch_sqlite/export_hose_corporate_actions.py --out exports/my_file.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sqlite3
from pathlib import Path

BASE = Path(__file__).parent

NEWS_EVENTS_DB = os.environ.get(
    "VCI_NEWS_EVENTS_DB_PATH", str(BASE / "vci_news_events.sqlite")
)
COMPANY_DB = os.environ.get(
    "VCI_COMPANY_DB_PATH", str(BASE / "vci_company.sqlite")
)

DATE_FROM = "2016-01-01"
DATE_TO = "2026-04-30"

# Map ISS eventTitleEn subtype keyword → action_type
ISS_SUBTYPE_MAP = [
    ("Rights issue",        "rights_issue"),
    ("Stock dividend",      "stock_dividend"),
    ("Bonus Issue",         "bonus_issue"),
    ("Private Placements",  "private_placement"),
    ("ESOP",                "esop"),
    ("Public Offering",     "public_offering"),
    ("Convertible Bonds",   "convertible_bond_conversion"),
    ("Stock for stock",     "stock_merger"),
]

OTHER_CODE_MAP = {
    "AIS":  "additional_listing",
    "NLIS": "new_listing",
    "MOVE": "exchange_switch",
    "SUSP": "listing_suspension",
    "RETU": "relisting",
    "MA":   "merger_acquisition",
}

CSV_FIELDS = [
    "symbol",
    "action_type",
    "event_code",
    "event_title_en",
    "public_date",
    "ex_right_date",
    "record_date",
    "effective_date",
    "exercise_ratio",
    "value_per_share",
]


def _classify_iss(title: str) -> str:
    for keyword, atype in ISS_SUBTYPE_MAP:
        if keyword.lower() in title.lower():
            return atype
    return "share_issue_other"


def _date(val: str | None) -> str:
    if not val:
        return ""
    return val[:10]


def export(out_path: str) -> int:
    # Load HOSE stock tickers (exclude ETFs: is_index=0 and floor=HOSE)
    with sqlite3.connect(COMPANY_DB) as co:
        hose_tickers = {
            r[0]
            for r in co.execute(
                "SELECT ticker FROM companies WHERE floor='HOSE' AND is_index=0"
            )
        }

    rows: list[dict] = []

    with sqlite3.connect(NEWS_EVENTS_DB) as ev:
        cur = ev.execute(
            """
            SELECT symbol, tab, raw_json
            FROM items
            WHERE tab IN ('dividend', 'other')
              AND public_date >= ?
              AND public_date <= ?
            ORDER BY symbol, public_date
            """,
            (DATE_FROM, DATE_TO),
        )

        for symbol, tab, raw in cur:
            if symbol not in hose_tickers:
                continue

            try:
                item = json.loads(raw)
            except Exception:
                continue

            code = item.get("eventCode", "")
            title = item.get("eventTitleEn") or item.get("eventNameEn") or ""

            # Classify action_type
            if code == "ISS":
                action_type = _classify_iss(title)
            elif code in OTHER_CODE_MAP:
                action_type = OTHER_CODE_MAP[code]
            elif code == "DIV":
                # Cash dividend — skip (not a dilutive corporate action)
                continue
            else:
                action_type = "other"

            rows.append(
                {
                    "symbol": symbol,
                    "action_type": action_type,
                    "event_code": code,
                    "event_title_en": title,
                    "public_date": _date(item.get("publicDate")),
                    "ex_right_date": _date(item.get("exrightDate")),
                    "record_date": _date(item.get("recordDate")),
                    "effective_date": _date(item.get("listingDate")),
                    "exercise_ratio": item.get("exerciseRatio") or "",
                    "value_per_share": item.get("valuePerShare") or "",
                }
            )

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    return len(rows)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--out",
        default=str(Path(__file__).parent.parent / "exports" / "hose_corporate_actions.csv"),
    )
    args = ap.parse_args()

    n = export(args.out)
    print(f"Exported {n} corporate action records → {args.out}")


if __name__ == "__main__":
    main()
