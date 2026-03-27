"""Macro economic data route — exchange rates, commodities, and World Bank indicators."""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

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
    'BZ=F':  {'name': 'Brent Crude',  'unit': 'USD/bbl'},
    'HG=F':  {'name': 'Đồng (Copper)', 'unit': 'USD/lb'},
    'ZR=F':  {'name': 'Lúa gạo (Rice)', 'unit': 'USD/cwt'},
    'GC=F':  {'name': 'Vàng (Gold)',   'unit': 'USD/oz'},
}

# World Bank indicator codes for Vietnam
_WB_CPI         = 'FP.CPI.TOTL.ZG'   # Inflation, consumer prices (annual %)
_WB_GDP_GROWTH  = 'NY.GDP.MKTP.KD.ZG' # GDP growth (annual %)


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


def _fetch_world_bank(indicator: str, mrv: int = 10) -> list[dict]:
    try:
        url = (
            f'https://api.worldbank.org/v2/country/VN/indicator/{indicator}'
            f'?format=json&mrv={mrv}&per_page={mrv}'
        )
        r = http_requests.get(url, timeout=10)
        if r.status_code != 200:
            return []
        payload = r.json()
        if len(payload) < 2 or not payload[1]:
            return []
        results = [
            {'year': int(item['date']), 'value': round(float(item['value']), 2)}
            for item in payload[1]
            if item.get('value') is not None
        ]
        return sorted(results, key=lambda x: x['year'])
    except Exception as exc:
        logger.warning('macro: world bank %s: %s', indicator, exc)
        return []


def _fetch_macro_data() -> dict:
    all_yahoo = list(_FX_SYMBOLS.keys()) + list(_COMMODITY_SYMBOLS.keys())

    yahoo_results: dict[str, dict] = {}
    cpi: list[dict] = []
    gdp: list[dict] = []

    with ThreadPoolExecutor(max_workers=len(all_yahoo) + 2) as pool:
        yahoo_futures  = {pool.submit(_fetch_yahoo, sym): sym for sym in all_yahoo}
        cpi_future     = pool.submit(_fetch_world_bank, _WB_CPI)
        gdp_future     = pool.submit(_fetch_world_bank, _WB_GDP_GROWTH)

        for future in as_completed(yahoo_futures):
            sym = yahoo_futures[future]
            result = future.result()
            if result:
                yahoo_results[sym] = result

        cpi = cpi_future.result()
        gdp = gdp_future.result()

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
            'cpi':        cpi,
            'gdp_growth': gdp,
        },
    }


def register(market_bp: Blueprint) -> None:
    @market_bp.route('/macro', methods=['GET'])
    def api_macro():
        """Vietnam macro indicators: FX rates, commodities, World Bank economic data. Cached 5 min."""
        try:
            data, _ = cache_func()('market_macro', 300, _fetch_macro_data)
            return jsonify(data)
        except Exception as exc:
            logger.error('macro route error: %s', exc)
            return jsonify({
                'exchange_rates': [],
                'commodities':    [],
                'economic':       {'cpi': [], 'gdp_growth': []},
            })
