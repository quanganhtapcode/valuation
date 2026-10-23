"""Lossless compact transport for historical index chart rows."""
from __future__ import annotations

from typing import Any

CHART_COLUMNS = ('date', 'vnindex', 'open', 'high', 'low', 'close', 'ema50', 'pe', 'pb', 'volume')


def compact_chart_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Encode column names once; keep every observation and its precision."""
    return {**payload, 'columns': list(CHART_COLUMNS),
            'data': [[row.get(column) for column in CHART_COLUMNS]
                     for row in payload.get('data', [])]}
