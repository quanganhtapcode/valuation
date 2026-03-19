"""Generate sector_peers.json from the main DB.

Calculates MEDIAN P/E and P/B for each sector, saving results to sector_peers.json
at project root. Called by run_pipeline.py after the daily BCTC fetch.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

# Ensure backend is importable when run from any CWD
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.db_path import resolve_stocks_db_path  # noqa: E402

# Outlier filter thresholds
PE_MIN, PE_MAX = 0, 100
PB_MIN, PB_MAX = 0, 10


def _detect_table(cursor: sqlite3.Cursor) -> str:
    """Return the first existing table among known candidates."""
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in cursor.fetchall()}
    for candidate in ("overview", "stock_overview"):
        if candidate in tables:
            return candidate
    raise RuntimeError(f"Neither 'overview' nor 'stock_overview' found. Tables: {tables}")


def generate_sector_peers(db_path: str | None = None) -> str | None:
    print("=" * 60)
    print("GENERATING SECTOR PEERS FROM DATABASE")
    print("=" * 60)

    resolved = db_path or resolve_stocks_db_path()
    if not os.path.exists(resolved):
        print(f"   ❌ Error: {resolved} not found!")
        return None

    conn = sqlite3.connect(resolved)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        table = _detect_table(cursor)
    except RuntimeError as exc:
        print(f"   ❌ {exc}")
        conn.close()
        return None

    print(f"\n📋 Step 1: Fetching data from '{table}'...")
    cursor.execute(
        f"""
        SELECT symbol, industry AS sector, pe, pb, market_cap
        FROM {table}
        WHERE pe > ? AND pe <= ? AND pb > ? AND pb <= ?
        """,
        (PE_MIN, PE_MAX, PB_MIN, PB_MAX),
    )
    rows = cursor.fetchall()
    conn.close()
    print(f"   ✓ Fetched {len(rows)} stocks (after outlier filtering)")

    # Group by sector
    sectors: dict[str, list] = defaultdict(list)
    for r in rows:
        sector = r["sector"]
        if not sector or sector == "Unknown":
            continue
        sectors[sector].append(
            {
                "symbol": r["symbol"],
                "market_cap": r["market_cap"] or 0,
                "pe_ratio": float(r["pe"]),
                "pb_ratio": float(r["pb"]),
            }
        )

    # Step 2: Calculate medians
    print("\n📋 Step 2: Calculating sector medians...")
    sector_peers: dict = {}

    for sector_name, stocks in sectors.items():
        all_pe = [s["pe_ratio"] for s in stocks]
        all_pb = [s["pb_ratio"] for s in stocks]

        median_pe = float(np.median(all_pe))
        median_pb = float(np.median(all_pb))

        stocks.sort(key=lambda x: x["market_cap"], reverse=True)
        top_10 = stocks[:10]

        sector_peers[sector_name] = {
            "median_pe": round(median_pe, 2),
            "median_pb": round(median_pb, 2),
            "peer_count": len(top_10),
            "total_in_sector": len(stocks),
            "peers": [
                {
                    "symbol": s["symbol"],
                    "market_cap": s["market_cap"],
                    "pe_ratio": round(s["pe_ratio"], 2),
                    "pb_ratio": round(s["pb_ratio"], 2),
                }
                for s in top_10
            ],
        }

    output_file = os.path.join(str(ROOT), "sector_peers.json")
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(sector_peers, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Saved to: {output_file} ({len(sector_peers)} sectors)")
    return output_file


if __name__ == "__main__":
    generate_sector_peers()
