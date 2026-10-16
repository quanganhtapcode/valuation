from __future__ import annotations

import math
import os
from datetime import datetime, timezone
from typing import Any

from backend.services.market_sessions import VN_TZ, expected_session_date
from backend.sqlite_utils import read_connection


def top_movers_from_screener_sqlite(
    *, db_path: str, move_type: str, exchange: str = "HSX", limit: int = 10,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Rank only matched quotes belonging to the expected Vietnam session."""
    rising = (move_type or "UP").upper() == "UP"
    limit = min(max(int(limit or 10), 1), 50)
    now = now or datetime.now(timezone.utc)
    session = expected_session_date(now)
    result: dict[str, Any] = {
        "Data": [], "session_date": session, "source": "VCI_SCREENING",
        "available": False,
    }
    if not db_path or not os.path.exists(db_path):
        return result

    with read_connection(db_path) as conn:
        columns = {row[1] for row in conn.execute('PRAGMA table_info(screening_data)')}
        if not {'matchPriceTime', 'refPrice'} <= columns:
            return result
        rows = conn.execute(
            "SELECT ticker, exchange, viOrganName, enOrganName, marketPrice, refPrice, "
            "accumulatedValue, matchPriceTime FROM screening_data "
            "WHERE exchange = ? AND ticker IS NOT NULL AND ticker != ''",
            (exchange,),
        ).fetchall()

    quotes = []
    for row in rows:
        timestamp = str(row['matchPriceTime'] or '')
        # fetched_at is ingestion time, not the date that the price traded.
        try:
            matched_at = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
            # Vietcap's timezone-free matchPriceTime is UTC, not ingestion time.
            if matched_at.tzinfo is None:
                matched_at = matched_at.replace(tzinfo=timezone.utc)
            if matched_at.astimezone(VN_TZ).date().isoformat() != session or matched_at > now:
                continue
            price, ref = float(row['marketPrice']), float(row['refPrice'])
            if not all(math.isfinite(n) and n > 0 for n in (price, ref)):
                continue
            change = (price / ref - 1) * 100
            if (rising and change <= 0) or (not rising and change >= 0):
                continue
            value = float(row['accumulatedValue'] or 0)
            quotes.append({
                'Symbol': str(row['ticker']).upper(),
                'CompanyName': row['viOrganName'] or row['enOrganName'] or '',
                'CurrentPrice': price, 'RefPrice': ref,
                'ChangePricePercent': change, 'Exchange': row['exchange'],
                'Value': value if math.isfinite(value) else 0,
                'SessionDate': session, 'QuoteTimestamp': timestamp,
            })
        except (TypeError, ValueError):
            continue
    quotes.sort(key=lambda item: item['ChangePricePercent'], reverse=rising)
    result.update(Data=quotes[:limit], available=bool(quotes))
    return result
