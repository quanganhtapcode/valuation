"""Macro economic data route — exchange rates, commodities, and economic indicators."""
from __future__ import annotations

import logging
import os
import sqlite3
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import requests as http_requests
from flask import Blueprint, jsonify, request

from .deps import cache_func

_MACRO_HISTORY_DB = os.path.join(
    os.path.dirname(__file__), '..', '..', '..', 'data', 'sqlite', 'macro_history.sqlite'
)
_FIREANT_MACRO_DB = os.path.join(
    os.path.dirname(__file__), '..', '..', '..', 'data', 'sqlite', 'fireant_macro.sqlite'
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
    # TradingView Vietnam economic indicators
    'ECONOMICS:VNINBR',  'ECONOMICS:VNIRYY',
    'ECONOMICS:VNGDPYY', 'ECONOMICS:VNGDPCP', 'ECONOMICS:VNGDPS',
    'ECONOMICS:VNGDPMAN','ECONOMICS:VNGDPA',  'ECONOMICS:VNGDPPC',
    'ECONOMICS:VNGNP',   'ECONOMICS:VNGFCF',
    'ECONOMICS:VNCPI',   'ECONOMICS:VNFI',    'ECONOMICS:VNCIR',
    'ECONOMICS:VNGASP',  'ECONOMICS:VNINTR',  'ECONOMICS:VNFER',
    'ECONOMICS:VNM2',    'ECONOMICS:VNDIR',
    'ECONOMICS:VNEXP',   'ECONOMICS:VNIMP',   'ECONOMICS:VNBOT',
    'ECONOMICS:VNFDI',   'ECONOMICS:VNUR',    'ECONOMICS:VNWAG',
    'ECONOMICS:VNMW',    'ECONOMICS:VNPOP',
    'ECONOMICS:VNIPYY',  'ECONOMICS:VNRSYY',
}

logger = logging.getLogger(__name__)

_YAHOO_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
}

_INVESTING_API_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'domain-id': 'www',
    'Referer': 'https://www.investing.com/',
    'Origin': 'https://www.investing.com',
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

_RATES_CACHE_TTL_SEC = 300
_rates_cache: dict | None = None
_rates_cache_updated_at = 0.0
_rates_cache_refreshing = False
_rates_cache_lock = threading.Lock()


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


def _read_rates_seed() -> dict:
    """Return the most recent local quotes immediately while Yahoo refreshes."""
    try:
        conn = sqlite3.connect(os.path.normpath(_MACRO_HISTORY_DB))
        rows = conn.execute(
            '''SELECT current.symbol, current.close, previous.close
               FROM macro_prices AS current
               LEFT JOIN macro_prices AS previous ON previous.symbol = current.symbol
                   AND previous.date = (
                       SELECT MAX(date) FROM macro_prices
                       WHERE symbol = current.symbol AND date < current.date
                   )
               WHERE current.date = (
                   SELECT MAX(date) FROM macro_prices WHERE symbol = current.symbol
               )'''
        ).fetchall()
        conn.close()
    except Exception as exc:
        logger.warning('macro: unable to load local rates seed: %s', exc)
        return {'exchange_rates': [], 'commodities': []}

    quotes = {}
    for symbol, price, previous in rows:
        if price is None:
            continue
        prev = previous if previous not in (None, 0) else price
        change = round(price - prev, 4)
        quotes[symbol] = {
            'price': price,
            'change': change,
            'changePercent': round((change / prev) * 100, 2) if prev else 0.0,
        }
    return {
        'exchange_rates': [
            {'symbol': sym, 'name': name, **quotes[sym]}
            for sym, name in _FX_SYMBOLS.items() if sym in quotes
        ],
        'commodities': [
            {'symbol': sym, 'name': meta['name'], 'unit': meta['unit'], **quotes[sym]}
            for sym, meta in _COMMODITY_SYMBOLS.items() if sym in quotes
        ],
    }


def _refresh_rates_cache() -> None:
    global _rates_cache, _rates_cache_updated_at, _rates_cache_refreshing
    try:
        fresh = _fetch_rates_data()
        if fresh['exchange_rates'] or fresh['commodities']:
            with _rates_cache_lock:
                _rates_cache = fresh
                _rates_cache_updated_at = time.monotonic()
    finally:
        with _rates_cache_lock:
            _rates_cache_refreshing = False


def _get_rates_stale_while_revalidate() -> dict:
    """Serve cached/local data now; refresh Yahoo quotes outside the request path."""
    global _rates_cache, _rates_cache_updated_at, _rates_cache_refreshing
    with _rates_cache_lock:
        if _rates_cache is None:
            _rates_cache = _read_rates_seed()
        should_refresh = (
            not _rates_cache_refreshing
            and time.monotonic() - _rates_cache_updated_at >= _RATES_CACHE_TTL_SEC
        )
        if should_refresh:
            _rates_cache_refreshing = True
            threading.Thread(target=_refresh_rates_cache, daemon=True, name='macro-rates-refresh').start()
        return _rates_cache


def _fetch_vn10y() -> list[dict]:
    """Fetch Vietnam 10Y bond yield from investing.com financial data API (monthly, instrument 29379)."""
    import json as _json
    try:
        url = 'https://api.investing.com/api/financialdata/29379/historical/chart/?interval=P1M&pointscount=160'
        req = urllib.request.Request(url, headers=_INVESTING_API_HEADERS)
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = _json.loads(resp.read()).get('data', [])
        results = []
        for item in raw:
            try:
                ts, close = item[0], item[4]
                dt = datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
                results.append({'date': dt.strftime('%Y-%m'), 'value': round(float(close), 3)})
            except Exception:
                continue
        results.sort(key=lambda x: x['date'])
        return results
    except Exception as exc:
        logger.warning('macro: vn10y fetch error: %s', exc)
        return []


def _fetch_economic_data(full: bool = False) -> dict:
    """Fetch CPI, GDP, VN10Y from investing.com. Cache 1 hour.

    full=True returns all available historical data (no truncation).
    """
    cpi_limit = 9999 if full else 36
    gdp_limit = 9999 if full else 32
    with ThreadPoolExecutor(max_workers=3) as pool:
        cpi_f   = pool.submit(_fetch_investing, _INVESTING_CPI_ID, cpi_limit)
        gdp_f   = pool.submit(_fetch_investing, _INVESTING_GDP_ID, gdp_limit)
        vn10y_f = pool.submit(_fetch_vn10y)
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


def _fetch_fireant_macro_data(types: list[str] | None = None, full: bool = False) -> dict:
    """Read FireAnt macro indicators from SQLite by type. Cache 6h.

    full=True skips the _FA_EXPOSED filter and returns all indicators in each type.
    """
    if types is None:
        types = list(_FA_EXPOSED.keys())

    result: dict[str, list] = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(_read_fireant_type, t): t for t in types}
        for future in as_completed(futures):
            t = futures[future]
            indicators = future.result()
            if not full:
                allowed = _FA_EXPOSED.get(t)
                if allowed is not None:
                    indicators = [i for i in indicators if i['id'] in allowed]
            result[t] = indicators

    return result


def register(market_bp: Blueprint) -> None:
    @market_bp.route('/macro/rates', methods=['GET'])
    def api_macro_rates():
        """Exchange rates + commodities, returned immediately from stale cache."""
        try:
            return jsonify(_get_rates_stale_while_revalidate())
        except Exception as exc:
            logger.error('macro/rates error: %s', exc)
            return jsonify({'exchange_rates': [], 'commodities': []})

    @market_bp.route('/macro/economic', methods=['GET'])
    def api_macro_economic():
        """CPI, GDP, VN 10Y bond yield from investing.com. Cache 1 hour.
        ?full=1 returns all available history (no truncation)."""
        full = request.args.get('full', '0') == '1'
        cache_key = 'market_macro_economic_full' if full else 'market_macro_economic'
        try:
            data, _ = cache_func()(cache_key, 3600, lambda: _fetch_economic_data(full))
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
        """All FireAnt macro indicators from SQLite, grouped by type.
        ?types=GDP,Trade  — filter by type
        ?full=1           — return all indicators (no _FA_EXPOSED filter)
        Cache 6h — refreshed by scripts/fetchers/fetch_fireant_macro.py cron."""
        try:
            types_param = request.args.get('types', '')
            full = request.args.get('full', '0') == '1'
            types = [t.strip() for t in types_param.split(',') if t.strip()] if types_param else None
            cache_key = f'market_macro_fireant_{types_param or "all"}_{"full" if full else "filtered"}'
            data, _ = cache_func()(cache_key, 6 * 3600, lambda: _fetch_fireant_macro_data(types, full))
            return jsonify(data)
        except Exception as exc:
            logger.error('macro/fireant error: %s', exc)
            return jsonify({})

    @market_bp.route('/macro/history', methods=['GET'])
    def api_macro_history():
        """Historical daily prices for a macro symbol from SQLite.
        ?symbol=USDVND%3DX&days=365  (chart use)
        ?symbol=USDVND%3DX&full=1    (download — all available data)"""
        symbol = request.args.get('symbol', '').upper()
        if symbol not in _ALLOWED_SYMBOLS:
            return jsonify({'error': 'unknown symbol'}), 400
        full = request.args.get('full', '0') == '1'
        try:
            days = None if full else min(int(request.args.get('days', 365)), 3 * 365)
        except ValueError:
            days = 365

        cache_key = f'macro_history_{symbol}_{"full" if full else days}'

        def _read():
            db_path = os.path.normpath(_MACRO_HISTORY_DB)
            conn = sqlite3.connect(db_path)
            if days is None:
                rows = conn.execute(
                    'SELECT date, close FROM macro_prices WHERE symbol = ? ORDER BY date ASC',
                    (symbol,),
                ).fetchall()
            else:
                rows = conn.execute(
                    '''SELECT date, close FROM macro_prices
                       WHERE symbol = ?
                       ORDER BY date DESC
                       LIMIT ?''',
                    (symbol, days),
                ).fetchall()
                rows = list(reversed(rows))
            conn.close()
            return [{'date': r[0], 'close': r[1]} for r in rows]

        try:
            data, _ = cache_func()(cache_key, 3600, _read)
            return jsonify(data)
        except Exception as exc:
            logger.error('macro history %s: %s', symbol, exc)
            return jsonify([])

    @market_bp.route('/macro/history/batch', methods=['GET'])
    def api_macro_history_batch():
        """Historical macro series in one SQLite query for the active table."""
        symbols = [symbol.strip().upper() for symbol in request.args.get('symbols', '').split(',') if symbol.strip()]
        symbols = list(dict.fromkeys(symbols))
        if not symbols or len(symbols) > 12 or any(symbol not in _ALLOWED_SYMBOLS for symbol in symbols):
            return jsonify({'error': 'unknown or invalid symbols'}), 400
        try:
            days = min(int(request.args.get('days', 365)), 3 * 365)
        except ValueError:
            days = 365

        cache_key = f'macro_history_batch_{"|".join(symbols)}_{days}'

        def _read_batch():
            db_path = os.path.normpath(_MACRO_HISTORY_DB)
            conn = sqlite3.connect(db_path)
            placeholders = ', '.join('?' for _ in symbols)
            rows = conn.execute(
                f'''SELECT symbol, date, close FROM (
                        SELECT symbol, date, close,
                               ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS row_num
                        FROM macro_prices WHERE symbol IN ({placeholders})
                    ) WHERE row_num <= ? ORDER BY symbol, date ASC''',
                [*symbols, days],
            ).fetchall()
            conn.close()
            data = {symbol: [] for symbol in symbols}
            for symbol, date, close in rows:
                data[symbol].append({'date': date, 'close': close})
            return data

        try:
            data, _ = cache_func()(cache_key, 3600, _read_batch)
            return jsonify(data)
        except Exception as exc:
            logger.error('macro history batch %s: %s', symbols, exc)
            return jsonify({symbol: [] for symbol in symbols})
