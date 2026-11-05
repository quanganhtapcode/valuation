"""Reference Visa card FX rate published in ForexRadar's public archive."""
from __future__ import annotations

import csv
from datetime import date, datetime, timedelta, timezone
import io
import logging
import math
import time

import requests

LOGGER = logging.getLogger(__name__)
_ARCHIVE_URL = 'https://raw.githubusercontent.com/avishj/ForexRadar/main/db/USD/{year}.csv'
_MAX_AGE_DAYS = 3
_CACHE_SECONDS = 3600
_FAILURE_RETRY_SECONDS = 300
_cached: dict | None = None
_next_refresh = 0.0


def parse_visa_rate(content: str, today: date) -> dict | None:
    """Return the newest recent USD transaction/VND billing Visa quote."""
    latest = None
    for row in csv.DictReader(io.StringIO(content)):
        if (row.get('to_curr') or '').upper() != 'VND' or (row.get('provider') or '').upper() != 'VISA':
            continue
        try:
            observed = date.fromisoformat(row.get('date', ''))
            rate = float(row.get('rate', ''))
        except (ValueError, TypeError):
            continue
        if not 0 <= (today - observed).days <= _MAX_AGE_DAYS or not math.isfinite(rate) or rate <= 0:
            continue
        if latest is None or observed > latest[0]:
            latest = (observed, rate)
    if latest is None:
        return None
    return {'rate': latest[1], 'date': latest[0].isoformat(), 'source': 'ForexRadar', 'feePercent': 0}


def get_card_rates() -> dict:
    global _cached, _next_refresh
    now = time.monotonic()
    today = datetime.now(timezone(timedelta(hours=7))).date()
    if now >= _next_refresh:
        result = None
        try:
            # Early January may require the preceding year's latest observation.
            years = [today.year, today.year - 1] if today.timetuple().tm_yday <= _MAX_AGE_DAYS else [today.year]
            for year in years:
                response = requests.get(_ARCHIVE_URL.format(year=year), timeout=8)
                if response.status_code == 404:
                    continue
                response.raise_for_status()
                if len(response.content) > 5_000_000:
                    raise ValueError('Card rate archive too large')
                result = parse_visa_rate(response.text, today)
                if result:
                    break
        except (requests.RequestException, ValueError):
            LOGGER.warning('Unable to read Visa rate archive', exc_info=True)
        _cached = result
        _next_refresh = now + (_CACHE_SECONDS if result else _FAILURE_RETRY_SECONDS)
    visa = _cached if _cached and 0 <= (today - date.fromisoformat(_cached['date'])).days <= _MAX_AGE_DAYS else None
    return {'visa': visa, 'mastercard': None}
