"""Reference card FX rates for both USD/VND transaction directions."""
from __future__ import annotations

import csv
from datetime import date, datetime, timedelta, timezone
import io
import logging
import math
import time

import requests

LOGGER = logging.getLogger(__name__)
_ARCHIVE_URL = 'https://raw.githubusercontent.com/avishj/ForexRadar/main/db/{currency}/{year}.csv'
_MASTERCARD_URL = 'https://www.mastercard.com/marketingservices/public/mccom-services/currency-conversions/conversion-rates'
_MASTERCARD_HEADERS = {
    'Accept': '*/*',
    'Referer': 'https://www.mastercard.com/mea/en/personal/get-support/currency-exchange-rate-converter.html',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36',
}
_MAX_AGE_DAYS = 3
_CACHE_SECONDS = 3600
_FAILURE_RETRY_SECONDS = 300
_visa_cache: dict[str, tuple[float, dict | None]] = {}
_mastercard_cache: dict[str, tuple[float, dict | None]] = {}


def parse_visa_rate(content: str, today: date, target: str = 'VND') -> dict | None:
    """Return the newest recent Visa quote for the requested billing currency."""
    latest = None
    for row in csv.DictReader(io.StringIO(content)):
        if (row.get('to_curr') or '').upper() != target or (row.get('provider') or '').upper() != 'VISA':
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


def get_mastercard_rate(today: date, transaction: str = 'USD', billing: str = 'VND') -> dict | None:
    now = time.monotonic()
    key = f'{transaction}/{billing}'
    next_refresh, cached = _mastercard_cache.get(key, (0.0, None))
    if now >= next_refresh:
        result = None
        try:
            response = requests.get(_MASTERCARD_URL, headers=_MASTERCARD_HEADERS, timeout=8, params={
                'exchange_date': today.isoformat(), 'transaction_currency': transaction,
                'cardholder_billing_currency': billing, 'bank_fee': '0', 'transaction_amount': '10000' if transaction == 'VND' else '1',
            })
            response.raise_for_status()
            data = response.json().get('data') or {}
            if data.get('transCurr') != transaction or data.get('crdhldBillCurr') != billing:
                raise ValueError('Unexpected Mastercard currency pair')
            observed = date.fromisoformat(data.get('fxDate', ''))
            rate = float(data.get('conversionRate', ''))
            if not 0 <= (today - observed).days <= _MAX_AGE_DAYS or not math.isfinite(rate) or rate <= 0:
                raise ValueError('Invalid or stale Mastercard rate')
            result = {'rate': rate, 'date': observed.isoformat(), 'source': 'Mastercard', 'feePercent': 0}
        except (requests.RequestException, ValueError, TypeError, AttributeError):
            LOGGER.warning('Unable to read Mastercard rate', exc_info=True)
        cached = result
        _mastercard_cache[key] = (now + (_CACHE_SECONDS if result else _FAILURE_RETRY_SECONDS), result)
    if cached and 0 <= (today - date.fromisoformat(cached['date'])).days <= _MAX_AGE_DAYS:
        return cached
    return None


def get_visa_rate(today: date, transaction: str, billing: str) -> dict | None:
    now = time.monotonic()
    key = f'{transaction}/{billing}'
    next_refresh, cached = _visa_cache.get(key, (0.0, None))
    if now >= next_refresh:
        result = None
        try:
            # Early January may require the preceding year's latest observation.
            years = [today.year, today.year - 1] if today.timetuple().tm_yday <= _MAX_AGE_DAYS else [today.year]
            for year in years:
                response = requests.get(_ARCHIVE_URL.format(currency=transaction, year=year), timeout=8)
                if response.status_code == 404:
                    continue
                response.raise_for_status()
                if len(response.content) > 5_000_000:
                    raise ValueError('Card rate archive too large')
                result = parse_visa_rate(response.text, today, billing)
                if result:
                    break
        except (requests.RequestException, ValueError):
            LOGGER.warning('Unable to read Visa rate archive', exc_info=True)
        cached = result
        _visa_cache[key] = (now + (_CACHE_SECONDS if result else _FAILURE_RETRY_SECONDS), result)
    return cached if cached and 0 <= (today - date.fromisoformat(cached['date'])).days <= _MAX_AGE_DAYS else None


def get_card_rates() -> dict:
    today = datetime.now(timezone(timedelta(hours=7))).date()
    return {
        'visa': get_visa_rate(today, 'USD', 'VND'),
        'visaReverse': get_visa_rate(today, 'VND', 'USD'),
        'mastercard': get_mastercard_rate(today, 'USD', 'VND'),
        'mastercardReverse': get_mastercard_rate(today, 'VND', 'USD'),
    }
