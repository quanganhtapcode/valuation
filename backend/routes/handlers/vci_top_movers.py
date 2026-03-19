from __future__ import annotations

import os
import sqlite3
from typing import Any


def top_movers_from_screener_sqlite(
    *,
    db_path: str,
    move_type: str,
    exchange: str = "HSX",
    limit: int = 10,
) -> dict[str, Any]:
    """Return payload shaped like {"Data": [...]} from vci_screening.sqlite."""
    move_type = (move_type or "UP").upper()
    direction = "DESC" if move_type == "UP" else "ASC"
    limit = min(max(int(limit or 10), 1), 50)

    if not db_path or not os.path.exists(db_path):
        return {"Data": []}

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        query = (
            "SELECT * FROM screening_data "
            "WHERE exchange = ? AND dailyPriceChangePercent IS NOT NULL "
            f"ORDER BY dailyPriceChangePercent {direction} LIMIT ?"
        )
        rows = conn.execute(query, (exchange, limit)).fetchall()

    mapped: list[dict[str, Any]] = []
    for r in rows:
        mapped.append(
            {
                "Symbol": r["ticker"],
                "CompanyName": r["viOrganName"] or r["enOrganName"] or "",
                "CurrentPrice": r["marketPrice"],
                "ChangePricePercent": r["dailyPriceChangePercent"],
                "Exchange": r["exchange"],
                "Value": r["accumulatedValue"],
            }
        )

    return {"Data": mapped}
