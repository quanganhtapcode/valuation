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
_FIREANT_MACRO_DB = os.path.join(
    os.path.dirname(__file__), '..', '..', '..', 'fetch_sqlite', 'fireant_macro.sqlite'
)

# FireAnt static public token (expires 2030, used by fireant.tradestation client)
_FIREANT_BEARER = (
    "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsIng1dCI6IkdYdExONzViZlZQakdvNERWdjV4QkRI"
    "THpnSSIsImtpZCI6IkdYdExONzViZlZQakdvNERWdjV4QkRITHpnSSJ9.eyJpc3MiOiJodHRwczov"
    "L2FjY291bnRzLmZpcmVhbnQudm4iLCJhdWQiOiJodHRwczovL2FjY291bnRzLmZpcmVhbnQudm4v"
    "cmVzb3VyY2VzIiwiZXhwIjoxODg5NjIyNTMwLCJuYmYiOjE1ODk2MjI1MzAsImNsaWVudF9pZCI6"
    "ImZpcmVhbnQudHJhZGVzdGF0aW9uIiwic2NvcGUiOlsiYWNhZGVteS1yZWFkIiwiYWNhZGVteS13"
    "cml0ZSIsImFjY291bnRzLXJlYWQiLCJhY2NvdW50cy13cml0ZSIsImJsb2ctcmVhZCIsImNvbXBh"
    "bmllcy1yZWFkIiwiZmluYW5jZS1yZWFkIiwiaW5kaXZpZHVhbHMtcmVhZCIsImludmVzdG9wZWRp"
    "YS1yZWFkIiwib3JkZXJzLXJlYWQiLCJvcmRlcnMtd3JpdGUiLCJwb3N0cy1yZWFkIiwicG9zdHMt"
    "d3JpdGUiLCJzZWFyY2giLCJzeW1ib2xzLXJlYWQiLCJ1c2VyLWRhdGEtcmVhZCIsInVzZXItZGF0"
    "YS13cml0ZSIsInVzZXJzLXJlYWQiXSwianRpIjoiMjYxYTZhYWQ2MTQ5Njk1ZmJiYzcwODM5MjM0"
    "Njc1NWQifQ.dA5-HVzWv-BRfEiAd24uNBiBxASO-PAyWeWESovZm_hj4aXMAZA1-bWNZeXt88dqo"
    "go18AwpDQ-h6gefLPdZSFrG5umC1dVWaeYvUnGm62g4XS29fj6p01dhKNNqrsu5KrhnhdnKYVv9Vd"
    "mbmqDfWR8wDgglk5cJFqalzq6dJWJInFQEPmUs9BW_Zs8tQDn-i5r4tYq2U8vCdqptXoM7YgPllX"
    "aPVDeccC9QNu2Xlp9WUvoROzoQXg25lFub1IYkTrM66gJ6t9fJRZToewCt495WNEOQFa_rwLCZ1Qw"
    "zvL0iYkONHS_jZ0BOhBCdW9dWSawD6iF1SIQaFROvMDH1rg"
)
_FIREANT_HEADERS = {
    'authorization': f'Bearer {_FIREANT_BEARER}',
    'origin': 'https://fireant.vn',
    'accept': 'application/json',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
}

_ALLOWED_SYMBOLS = {
    'USDVND=X', 'EURVND=X', 'CNYVND=X', 'JPYVND=X',
    'BZ=F', 'SI=F', 'ZR=F', 'GC=F',
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
    'SI=F': {'name': 'Bạc (Silver)',   'unit': 'USD/oz'},
    'ZR=F': {'name': 'Lúa gạo (Rice)', 'unit': 'USD/cwt'},
    'GC=F': {'name': 'Vàng (Gold)',    'unit': 'USD/oz'},
}

# investing.com sbcharts event IDs for Vietnam
_INVESTING_CPI_ID   = 1851  # Vietnamese CPI YoY (monthly)
_INVESTING_GDP_ID   = 1853  # Vietnamese GDP YoY (quarterly)
_INVESTING_VN10Y_ID = 1860  # Vietnam 10-Year Government Bond Yield (monthly)


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


def _fetch_rates_data() -> dict:
    """Fetch exchange rates + commodities from Yahoo Finance. Cache 5 min."""
    all_yahoo = list(_FX_SYMBOLS.keys()) + list(_COMMODITY_SYMBOLS.keys())
    yahoo_results: dict[str, dict] = {}

    with ThreadPoolExecutor(max_workers=len(all_yahoo)) as pool:
        futures = {pool.submit(_fetch_yahoo, sym): sym for sym in all_yahoo}
        for future in as_completed(futures):
            result = future.result()
            if result:
                yahoo_results[futures[future]] = result

    return {
        'exchange_rates': [
            {'symbol': sym, 'name': name, **yahoo_results[sym]}
            for sym, name in _FX_SYMBOLS.items()
            if sym in yahoo_results
        ],
        'commodities': [
            {'symbol': sym, 'name': meta['name'], 'unit': meta['unit'], **yahoo_results[sym]}
            for sym, meta in _COMMODITY_SYMBOLS.items()
            if sym in yahoo_results
        ],
    }


def _fetch_economic_data() -> dict:
    """Fetch CPI, GDP, VN10Y from investing.com sbcharts. Cache 1 hour."""
    with ThreadPoolExecutor(max_workers=3) as pool:
        cpi_f   = pool.submit(_fetch_investing, _INVESTING_CPI_ID,   36)
        gdp_f   = pool.submit(_fetch_investing, _INVESTING_GDP_ID,   32)
        vn10y_f = pool.submit(_fetch_investing, _INVESTING_VN10Y_ID, 84)
        cpi   = cpi_f.result()
        gdp   = _add_quarter_labels(gdp_f.result())
        vn10y = vn10y_f.result()
    return {'cpi': cpi, 'gdp': gdp, 'vn10y': vn10y}


def _read_fireant_type(macro_type: str) -> list[dict]:
    """Read all indicators + their data for a macro type from SQLite."""
    try:
        db = os.path.normpath(_FIREANT_MACRO_DB)
        conn = sqlite3.connect(db)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            'SELECT id, name, name_vn, unit, frequency, last_value, last_date '
            'FROM macro_indicators WHERE type=? ORDER BY id',
            (macro_type,),
        ).fetchall()
        result = []
        for row in rows:
            data_rows = conn.execute(
                'SELECT date, value FROM macro_data WHERE indicator_id=? ORDER BY rowid',
                (row['id'],),
            ).fetchall()
            result.append({
                'id':        row['id'],
                'nameVN':    row['name_vn'] or row['name'],
                'name':      row['name'],
                'unit':      row['unit'],
                'frequency': row['frequency'],
                'lastValue': row['last_value'],
                'lastDate':  row['last_date'],
                'data':      [{'date': r['date'], 'value': r['value']} for r in data_rows],
            })
        conn.close()
        return result
    except Exception as exc:
        logger.error('read_fireant_type %s: %s', macro_type, exc)
        return []


# Map from macro type → list of indicator IDs to expose via the API
# (None = expose all indicators in that type)
_FA_EXPOSED: dict[str, list[int] | None] = {
    'GDP':          [1, 2, 22, 26, 5, 7, 9, 15],   # total, growth, per-capita, full-year, sectors
    'Prices':       None,                            # all: CPI, inflation, core, PPI
    'Trade':        [54, 59, 61, 62, 57, 58],        # balance, exports, imports, FDI, current-acct
    'Labour':       [72, 68, 73, 67, 71],            # unemployment, population, wages
    'Money':        None,                            # all: FX reserves, M0/M1/M2, deposit rate
    'Consumer':     [91, 92, 90, 88],               # retail sales, gasoline, confidence
    'Business':     [51, 49, 46, 39],               # PMI, industrial prod, electricity, cars
    'InterestRate': [99, 101, 105, 107, 115],        # overnight, 1w, 1m, 3m, refinancing
    'Taxes':        [93, 94, 95],                    # corporate, personal, VAT
}


def _fetch_fireant_macro_data(types: list[str] | None = None) -> dict:
    """Read FireAnt macro indicators from SQLite by type. Cache 6h."""
    if types is None:
        types = list(_FA_EXPOSED.keys())

    result: dict[str, list] = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(_read_fireant_type, t): t for t in types}
        for future in as_completed(futures):
            t = futures[future]
            indicators = future.result()
            allowed = _FA_EXPOSED.get(t)
            if allowed is not None:
                indicators = [i for i in indicators if i['id'] in allowed]
            result[t] = indicators

    return result


def register(market_bp: Blueprint) -> None:
    @market_bp.route('/macro/rates', methods=['GET'])
    def api_macro_rates():
        """Exchange rates + commodities from Yahoo Finance. Cache 5 min."""
        try:
            data, _ = cache_func()('market_macro_rates', 300, _fetch_rates_data)
            return jsonify(data)
        except Exception as exc:
            logger.error('macro/rates error: %s', exc)
            return jsonify({'exchange_rates': [], 'commodities': []})

    @market_bp.route('/macro/economic', methods=['GET'])
    def api_macro_economic():
        """CPI, GDP, VN 10Y bond yield from investing.com. Cache 1 hour."""
        try:
            data, _ = cache_func()('market_macro_economic', 3600, _fetch_economic_data)
            return jsonify(data)
        except Exception as exc:
            logger.error('macro/economic error: %s', exc)
            return jsonify({'cpi': [], 'gdp': [], 'vn10y': []})

    @market_bp.route('/macro', methods=['GET'])
    def api_macro():
        """Combined macro endpoint (backward compat). Merges rates + economic."""
        try:
            rates_data, _    = cache_func()('market_macro_rates',    300,  _fetch_rates_data)
            eco_data, _      = cache_func()('market_macro_economic', 3600, _fetch_economic_data)
            return jsonify({**rates_data, 'economic': eco_data})
        except Exception as exc:
            logger.error('macro route error: %s', exc)
            return jsonify({
                'exchange_rates': [],
                'commodities':    [],
                'economic':       {'cpi': [], 'gdp': [], 'vn10y': []},
            })

    @market_bp.route('/macro/fireant-gdp', methods=['GET'])
    def api_macro_fireant_gdp():
        """Backward-compat alias → returns GDP+Trade from SQLite."""
        try:
            all_data, _ = cache_func()('market_macro_fireant_all', 6 * 3600, _fetch_fireant_macro_data)
            # Flatten GDP + Trade into key→indicator dict (old format)
            out: dict = {}
            key_map = {
                1: 'gdp_total', 2: 'gdp_growth_qoq', 22: 'gdp_per_capita', 26: 'gdp_growth_year',
                54: 'trade_balance', 59: 'exports', 62: 'imports', 61: 'fdi',
            }
            for t in ('GDP', 'Trade'):
                for ind in all_data.get(t, []):
                    k = key_map.get(ind['id'])
                    if k:
                        out[k] = ind
            return jsonify(out)
        except Exception as exc:
            logger.error('macro/fireant-gdp error: %s', exc)
            return jsonify({})

    @market_bp.route('/macro/fireant', methods=['GET'])
    def api_macro_fireant():
        """All FireAnt macro indicators from SQLite, grouped by type. ?types=GDP,Trade
        Cache 6h — refreshed by fetch_sqlite/fetch_fireant_macro.py cron."""
        try:
            types_param = request.args.get('types', '')
            types = [t.strip() for t in types_param.split(',') if t.strip()] if types_param else None
            cache_key = f'market_macro_fireant_{types_param or "all"}'
            data, _ = cache_func()(cache_key, 6 * 3600, lambda: _fetch_fireant_macro_data(types))
            return jsonify(data)
        except Exception as exc:
            logger.error('macro/fireant error: %s', exc)
            return jsonify({})

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
