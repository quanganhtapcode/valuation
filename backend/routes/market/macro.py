"""Macro economic data route — exchange rates, commodities, and economic indicators."""
from __future__ import annotations

import logging
import os
import sqlite3
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import requests as http_requests
from flask import Blueprint, jsonify, request

from .deps import cache_func

_MACRO_HISTORY_DB = os.path.join(
    os.path.dirname(__file__), '..', '..', '..', 'fetch_sqlite', 'macro_history.sqlite'
)

_ALLOWED_SYMBOLS = {
    'USDVND=X', 'EURVND=X', 'CNYVND=X', 'JPYVND=X',
    'BZ=F', 'HG=F', 'ZR=F', 'GC=F',
}

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
_INVESTING_GDP_ID = 1853   # Vietnamese GDP YoY (quarterly)


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


def _date_to_quarter(year: int, month: int) -> str:
    """Convert publication month to Vietnam GDP quarter label.

    Vietnam GSO releases:
      Q1 data ≈ March/April   → month 3-4
      Q2 data ≈ June/July     → month 5-7
      Q3 data ≈ October       → month 8-10
      Q4 data ≈ January(+1yr) → month 1
    """
    if month == 1:
        return f'Q4/{year - 1}'
    elif month <= 4:
        return f'Q1/{year}'
    elif month <= 7:
        return f'Q2/{year}'
    elif month <= 10:
        return f'Q3/{year}'
    else:
        return f'Q4/{year}'


def _fetch_investing(event_id: int, limit: int) -> list[dict]:
    """Generic fetch from investing.com sbcharts API."""
    try:
        url = f'https://sbcharts.investing.com/events_charts/eu/{event_id}.json'
        r = http_requests.get(url, timeout=8, headers=_YAHOO_HEADERS)
        if r.status_code != 200:
            logger.warning('macro: investing.com event %s status %s', event_id, r.status_code)
            return []
        raw = r.json().get('data', [])
        results = []
        for entry in raw:
            try:
                ts, val = entry[0], entry[1]
                dt = datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
                results.append({
                    'date': dt.strftime('%Y-%m'),
                    'value': round(float(val), 2),
                })
            except Exception:
                continue
        results.sort(key=lambda x: x['date'])
        return results[-limit:]
    except Exception as exc:
        logger.warning('macro: investing.com event %s: %s', event_id, exc)
        return []


def _add_quarter_labels(points: list[dict]) -> list[dict]:
    """Enrich GDP points with a human-readable quarter label."""
    out = []
    for p in points:
        year, month = int(p['date'][:4]), int(p['date'][5:7])
        out.append({**p, 'quarter': _date_to_quarter(year, month)})
    return out


def _fetch_macro_data() -> dict:
    all_yahoo = list(_FX_SYMBOLS.keys()) + list(_COMMODITY_SYMBOLS.keys())

    yahoo_results: dict[str, dict] = {}

    with ThreadPoolExecutor(max_workers=len(all_yahoo) + 2) as pool:
        yahoo_futures = {pool.submit(_fetch_yahoo, sym): sym for sym in all_yahoo}
        cpi_future    = pool.submit(_fetch_investing, _INVESTING_CPI_ID, 36)
        gdp_future    = pool.submit(_fetch_investing, _INVESTING_GDP_ID, 32)

        for future in as_completed(yahoo_futures):
            sym = yahoo_futures[future]
            result = future.result()
            if result:
                yahoo_results[sym] = result

        cpi = cpi_future.result()
        gdp = _add_quarter_labels(gdp_future.result())

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
            'gdp': gdp,
        },
    }


def register(market_bp: Blueprint) -> None:
    @market_bp.route('/macro', methods=['GET'])
    def api_macro():
        """Vietnam macro indicators: FX, commodities, monthly CPI, quarterly GDP. Cached 1 hour."""
        try:
            data, _ = cache_func()('market_macro', 3600, _fetch_macro_data)
            return jsonify(data)
        except Exception as exc:
            logger.error('macro route error: %s', exc)
            return jsonify({
                'exchange_rates': [],
                'commodities':    [],
                'economic':       {'cpi': [], 'gdp': []},
            })

    @market_bp.route('/macro/history', methods=['GET'])
    def api_macro_history():
        """Historical daily prices for a macro symbol from SQLite. ?symbol=USDVND%3DX&days=365"""
        symbol = request.args.get('symbol', '').upper()
        if symbol not in _ALLOWED_SYMBOLS:
            return jsonify({'error': 'unknown symbol'}), 400
        try:
            days = min(int(request.args.get('days', 365)), 3 * 365)
        except ValueError:
            days = 365

        cache_key = f'macro_history_{symbol}_{days}'

        def _read():
            db_path = os.path.normpath(_MACRO_HISTORY_DB)
            conn = sqlite3.connect(db_path)
            rows = conn.execute(
                '''SELECT date, close FROM macro_prices
                   WHERE symbol = ?
                   ORDER BY date DESC
                   LIMIT ?''',
                (symbol, days),
            ).fetchall()
            conn.close()
            # Return ascending
            return [{'date': r[0], 'close': r[1]} for r in reversed(rows)]

        try:
            data, _ = cache_func()(cache_key, 3600, _read)
            return jsonify(data)
        except Exception as exc:
            logger.error('macro history %s: %s', symbol, exc)
            return jsonify([])
