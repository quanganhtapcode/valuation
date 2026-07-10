from __future__ import annotations

import logging
import time
from concurrent.futures import TimeoutError, ThreadPoolExecutor, as_completed

import requests as http_requests
from flask import Blueprint, jsonify, request

from .deps import cache_func

logger = logging.getLogger(__name__)

_WORLD_SYMBOLS = ['^GSPC', '^IXIC', '^DJI', '^GDAXI', '^FTSE', '^N225', '^HSI', '000001.SS']
_WORLD_NAMES = {
    '^GSPC': 'S&P 500',
    '^IXIC': 'NASDAQ',
    '^DJI': 'Dow Jones',
    '^GDAXI': 'DAX',
    '^FTSE': 'FTSE 100',
    '^N225': 'Nikkei 225',
    '^HSI': 'Hang Seng',
    '000001.SS': 'Shanghai',
}
_YAHOO_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
}
_STALE_WORLD_INDICES: list[dict] = []
_STALE_WORLD_INDICES_AT = 0.0
_STALE_MAX_AGE_SECONDS = 60 * 60 * 6
_FETCH_TIMEOUT = (0.8, 1.2)
_TOTAL_FETCH_TIMEOUT_SECONDS = 1.8


def _fetch_one(sym: str) -> dict | None:
    """Fetch a single Yahoo Finance symbol. Returns None on failure."""
    try:
        url = f'https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1d&range=1d'
        r = http_requests.get(url, timeout=_FETCH_TIMEOUT, headers=_YAHOO_HEADERS)
        if r.status_code != 200:
            return None
        data = r.json()
        meta = data['chart']['result'][0]['meta']
        price = float(meta.get('regularMarketPrice') or 0)
        prev = float(meta.get('chartPreviousClose') or meta.get('previousClose') or price)
        change = round(price - prev, 2)
        pct = round((change / prev) * 100, 2) if prev else 0
        return {
            'symbol': sym,
            'name': _WORLD_NAMES.get(sym, sym),
            'price': price,
            'change': change,
            'changePercent': pct,
        }
    except Exception as e:
        logger.warning(f'world-indices: failed {sym}: {e}')
        return None


def _stale_is_usable() -> bool:
    return bool(_STALE_WORLD_INDICES) and (time.time() - _STALE_WORLD_INDICES_AT) < _STALE_MAX_AGE_SECONDS


def register(market_bp: Blueprint) -> None:
    @market_bp.route('/world-indices', methods=['GET', 'HEAD'])
    def api_world_indices():
        """World stock indices from Yahoo Finance with fast stale fallback."""
        global _STALE_WORLD_INDICES, _STALE_WORLD_INDICES_AT

        if request.method == 'HEAD':
            resp = jsonify([])
            resp.headers['X-Cache'] = 'HEAD'
            return resp
        def fetch_world_indices():
            results: list[dict] = [None] * len(_WORLD_SYMBOLS)  # type: ignore[list-item]
            with ThreadPoolExecutor(max_workers=len(_WORLD_SYMBOLS)) as executor:
                future_to_idx = {executor.submit(_fetch_one, sym): i for i, sym in enumerate(_WORLD_SYMBOLS)}
                try:
                    completed = as_completed(future_to_idx, timeout=_TOTAL_FETCH_TIMEOUT_SECONDS)
                    for future in completed:
                        idx = future_to_idx[future]
                        result = future.result()
                        if result is not None:
                            results[idx] = result
                except TimeoutError:
                    logger.warning('world-indices: total fetch timeout; returning partial/stale data')
                    for future in future_to_idx:
                        future.cancel()
            fresh = [r for r in results if r is not None]
            if fresh:
                _STALE_WORLD_INDICES = fresh
                _STALE_WORLD_INDICES_AT = time.time()
            return fresh

        try:
            data, is_cached = cache_func()('world_indices', 10 * 60, fetch_world_indices)
            if not data and _stale_is_usable():
                data = _STALE_WORLD_INDICES
                is_cached = True
            resp = jsonify(data or [])
            resp.headers['X-Cache'] = 'HIT' if is_cached else 'MISS'
            return resp
        except Exception as e:
            logger.error(f'world-indices error: {e}')
            if _stale_is_usable():
                resp = jsonify(_STALE_WORLD_INDICES)
                resp.headers['X-Cache'] = 'STALE'
                return resp
            return jsonify([])
