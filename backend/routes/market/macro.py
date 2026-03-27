"""Macro economic data route — exchange rates, commodities, and economic indicators."""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import requests as http_requests
from flask import Blueprint, jsonify

from .deps import cache_func

logger = logging.getLogger(__name__)

_YAHOO_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
}

# VND exchange rate pairs (price = VND per 1 foreign currency unit)
_FX_SYMBOLS: dict[str, str] = {
    'USDVND=X': 'USD/VND',
    'EURVND=X': 'EUR/VND',
    'CNYVND=X': 'CNY/VND',
    'JPYVND=X': 'JPY/VND',
}

# Commodities relevant to Vietnam (USD-denominated)
_COMMODITY_SYMBOLS: dict[str, dict] = {
    'BZ=F': {'name': 'Brent Crude',    'unit': 'USD/bbl'},
    'HG=F': {'name': 'Đồng (Copper)',  'unit': 'USD/lb'},
    'ZR=F': {'name': 'Lúa gạo (Rice)', 'unit': 'USD/cwt'},
    'GC=F': {'name': 'Vàng (Gold)',    'unit': 'USD/oz'},
}

# investing.com sbcharts event IDs for Vietnam
_INVESTING_CPI_ID = 1851   # Vietnamese CPI YoY (monthly)


def _fetch_yahoo(sym: str) -> dict | None:
    try:
        url = f'https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1d&range=1d'
        r = http_requests.get(url, timeout=7, headers=_YAHOO_HEADERS)
        if r.status_code != 200:
            return None
        data = r.json()
        meta = data['chart']['result'][0]['meta']
        price = float(meta.get('regularMarketPrice') or 0)
        prev  = float(meta.get('chartPreviousClose') or meta.get('previousClose') or price)
        change = round(price - prev, 4)
        pct    = round((change / prev) * 100, 2) if prev else 0.0
        return {'price': price, 'change': change, 'changePercent': pct}
    except Exception as exc:
        logger.warning('macro: yahoo %s: %s', sym, exc)
        return None


def _fetch_investing_cpi(months: int = 36) -> list[dict]:
    """Fetch Vietnam monthly CPI YoY from investing.com sbcharts API."""
    try:
        url = f'https://sbcharts.investing.com/events_charts/eu/{_INVESTING_CPI_ID}.json'
        r = http_requests.get(url, timeout=8, headers=_YAHOO_HEADERS)
        if r.status_code != 200:
            logger.warning('macro: investing.com CPI status %s', r.status_code)
            return []
        raw = r.json().get('data', [])
        # Each entry: [timestamp_ms, value, flag]
        results = []
        for entry in raw:
            try:
                ts, val = entry[0], entry[1]
                dt = datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
                results.append({'date': dt.strftime('%Y-%m'), 'value': round(float(val), 2)})
            except Exception:
                continue
        # Sort ascending and return last N months
        results.sort(key=lambda x: x['date'])
        return results[-months:]
    except Exception as exc:
        logger.warning('macro: investing.com CPI: %s', exc)
        return []


def _fetch_macro_data() -> dict:
    all_yahoo = list(_FX_SYMBOLS.keys()) + list(_COMMODITY_SYMBOLS.keys())

    yahoo_results: dict[str, dict] = {}
    cpi: list[dict] = []

    with ThreadPoolExecutor(max_workers=len(all_yahoo) + 1) as pool:
        yahoo_futures = {pool.submit(_fetch_yahoo, sym): sym for sym in all_yahoo}
        cpi_future    = pool.submit(_fetch_investing_cpi)

        for future in as_completed(yahoo_futures):
            sym = yahoo_futures[future]
            result = future.result()
            if result:
                yahoo_results[sym] = result

        cpi = cpi_future.result()

    exchange_rates = [
        {'symbol': sym, 'name': name, **yahoo_results[sym]}
        for sym, name in _FX_SYMBOLS.items()
        if sym in yahoo_results
    ]

    commodities = [
        {'symbol': sym, 'name': meta['name'], 'unit': meta['unit'], **yahoo_results[sym]}
        for sym, meta in _COMMODITY_SYMBOLS.items()
        if sym in yahoo_results
    ]

    return {
        'exchange_rates': exchange_rates,
        'commodities':    commodities,
        'economic': {
            'cpi': cpi,
        },
    }


def register(market_bp: Blueprint) -> None:
    @market_bp.route('/macro', methods=['GET'])
    def api_macro():
        """Vietnam macro indicators: FX rates, commodities, monthly CPI. Cached 1 hour."""
        try:
            data, _ = cache_func()('market_macro', 3600, _fetch_macro_data)
            return jsonify(data)
        except Exception as exc:
            logger.error('macro route error: %s', exc)
            return jsonify({
                'exchange_rates': [],
                'commodities':    [],
                'economic':       {'cpi': []},
            })
