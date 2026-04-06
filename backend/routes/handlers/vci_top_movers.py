from __future__ import annotations

import os
import sqlite3
from typing import Any

from backend.data_sources.vci import VCIClient


def top_movers_from_screener_sqlite(
    *,
    db_path: str,
    move_type: str,
    exchange: str = "HSX",
    limit: int = 10,
) -> dict[str, Any]:
    """Return top movers with realtime price/change from VCI RAM cache when available."""
    move_type = (move_type or "UP").upper()
    direction = "DESC" if move_type == "UP" else "ASC"
    limit = min(max(int(limit or 10), 1), 50)

    if not db_path or not os.path.exists(db_path):
        return {"Data": []}

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT ticker, exchange, viOrganName, enOrganName, marketPrice, "
            "dailyPriceChangePercent, accumulatedValue "
            "FROM screening_data "
            "WHERE exchange = ? AND ticker IS NOT NULL AND ticker != ''",
            (exchange,),
        ).fetchall()

    VCIClient.ensure_background_refresh()
    realtime = VCIClient.get_all_prices() or {}

    enriched: list[dict[str, Any]] = []
    for r in rows:
        ticker = str(r["ticker"] or "").upper()
        if not ticker:
            continue

        rt = realtime.get(ticker) or {}
        price = float(rt.get("c") or r["marketPrice"] or 0)
        ref = float(rt.get("ref") or 0)
        if ref > 0:
            change_pct = ((price - ref) / ref) * 100
        else:
            change_pct = float(r["dailyPriceChangePercent"] or 0)

        rt_value_mn = float(rt.get("va") or 0)
        value_vnd = rt_value_mn * 1_000_000.0 if rt_value_mn > 0 else float(r["accumulatedValue"] or 0)

        enriched.append(
            {
                "Symbol": ticker,
                "CompanyName": r["viOrganName"] or r["enOrganName"] or "",
                "CurrentPrice": price,
                "ChangePricePercent": change_pct,
                "Exchange": r["exchange"],
                "Value": value_vnd,
            }
        )

    enriched.sort(key=lambda x: float(x.get("ChangePricePercent") or 0), reverse=(direction == "DESC"))
    mapped = enriched[:limit]

    return {"Data": mapped}
