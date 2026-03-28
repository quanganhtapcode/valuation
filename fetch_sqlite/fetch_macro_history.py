#!/usr/bin/env python3
"""Fetch daily historical prices for FX pairs and commodities into SQLite.

Direct Yahoo Finance symbols (have full history):
  USDVND=X  EURVND=X  USDJPY=X  USDCNY=X
  BZ=F  HG=F  ZR=F  GC=F

Derived VND pairs (computed from USD crosses + USDVND):
  JPYVND=X  = USDVND / USDJPY
  CNYVND=X  = USDVND / USDCNY

Run daily via cron:
  0 1 * * * cd /var/www/valuation && .venv/bin/python fetch_sqlite/fetch_macro_history.py \
            --db fetch_sqlite/macro_history.sqlite >> fetch_sqlite/cron_macro_history.log 2>&1
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import sqlite3
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

# Fetched directly from Yahoo Finance
_DIRECT_SYMBOLS = [
    'USDVND=X', 'EURVND=X',
    'USDJPY=X', 'USDCNY=X',
    'BZ=F', 'HG=F', 'ZR=F', 'GC=F',
]

PRUNE_DAYS = 3 * 365

YAHOO_HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ),
    'Accept': 'application/json',
}


# ── SQLite setup ──────────────────────────────────────────────────────────────

def init_db(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS macro_prices (
            symbol TEXT NOT NULL,
            date   TEXT NOT NULL,
            close  REAL NOT NULL,
            PRIMARY KEY (symbol, date)
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_macro_symbol_date ON macro_prices (symbol, date)')
    conn.commit()
    return conn


# ── Fetch ─────────────────────────────────────────────────────────────────────

def _normalize_unit_change(rows: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """Detect and fix a sudden ~100x unit change at the tail of the series.

    Yahoo Finance occasionally changes the price unit for a futures contract
    (e.g. ZR=F switched from cents/cwt to USD/cwt), causing all historical
    values to be ~100x larger than the latest price. When detected, the older
    values are divided by the inferred scale factor.
    """
    if len(rows) < 10:
        return rows
    last = rows[-1][1]
    # Use median of last-10 to last-2 as the 'old unit' reference
    recent = sorted(r[1] for r in rows[-10:-1])
    median_prev = recent[len(recent) // 2]
    if last <= 0 or median_prev <= 0:
        return rows
    ratio = median_prev / last
    # If previous values are ~100x larger, divide them
    if 80 < ratio < 120:
        scale = round(ratio)
        logger.info('Unit change detected (%.1fx) — normalising older values', scale)
        return [
            (date, round(close / scale, 6)) if close > last * (scale / 2) else (date, close)
            for date, close in rows
        ]
    return rows


def fetch_history(symbol: str, range_str: str = '3y') -> dict[str, float]:
    """Return {date_str: close} for a symbol, with unit-change normalization."""
    url = (
        f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}'
        f'?interval=1d&range={range_str}'
    )
    req = urllib.request.Request(url, headers=YAHOO_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        result = data['chart']['result'][0]
        timestamps = result['timestamp']
        closes = result['indicators']['quote'][0]['close']
        pairs: list[tuple[str, float]] = []
        for ts, c in zip(timestamps, closes):
            if c is None:
                continue
            date_str = dt.datetime.utcfromtimestamp(ts).strftime('%Y-%m-%d')
            pairs.append((date_str, round(float(c), 6)))
        pairs = _normalize_unit_change(pairs)
        out = dict(pairs)
        return out
    except Exception as exc:
        logger.warning('fetch_history %s: %s', symbol, exc)
        return {}


def derive_vnd_cross(
    usdvnd: dict[str, float],
    usd_cross: dict[str, float],
) -> dict[str, float]:
    """Compute VND/X = USDVND / USD_X for dates present in both series."""
    result = {}
    for date, usd_x in usd_cross.items():
        vnd = usdvnd.get(date)
        if vnd and usd_x:
            result[date] = round(vnd / usd_x, 6)
    return result


# ── Upsert / prune ───────────────────────────────────────────────────────────

def upsert(conn: sqlite3.Connection, symbol: str, rows: dict[str, float]) -> int:
    if not rows:
        return 0
    conn.executemany(
        'INSERT OR REPLACE INTO macro_prices (symbol, date, close) VALUES (?, ?, ?)',
        [(symbol, date, close) for date, close in rows.items()],
    )
    conn.commit()
    return len(rows)


def prune(conn: sqlite3.Connection) -> None:
    cutoff = (dt.datetime.utcnow() - dt.timedelta(days=PRUNE_DAYS)).strftime('%Y-%m-%d')
    conn.execute('DELETE FROM macro_prices WHERE date < ?', (cutoff,))
    conn.commit()


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', default='fetch_sqlite/macro_history.sqlite')
    parser.add_argument('--range', default='3y', dest='range_str')
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()

    Path(args.db).parent.mkdir(parents=True, exist_ok=True)
    conn = init_db(args.db)

    logger.info('Fetching %d symbols (range=%s)', len(_DIRECT_SYMBOLS), args.range_str)

    fetched: dict[str, dict[str, float]] = {}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(fetch_history, sym, args.range_str): sym for sym in _DIRECT_SYMBOLS}
        for future in as_completed(futures):
            sym = futures[future]
            rows = future.result()
            fetched[sym] = rows
            logger.info('  %-12s  %d rows', sym, len(rows))
            time.sleep(0.1)

    # Upsert direct symbols (skip helper cross-rate symbols)
    for sym in ('USDVND=X', 'EURVND=X', 'BZ=F', 'HG=F', 'ZR=F', 'GC=F'):
        n = upsert(conn, sym, fetched.get(sym, {}))
        logger.info('  %-12s  %d rows upserted', sym, n)

    # Derive and upsert CNY/VND and JPY/VND
    usdvnd = fetched.get('USDVND=X', {})
    for derived_sym, cross_sym in (('CNYVND=X', 'USDCNY=X'), ('JPYVND=X', 'USDJPY=X')):
        derived = derive_vnd_cross(usdvnd, fetched.get(cross_sym, {}))
        n = upsert(conn, derived_sym, derived)
        logger.info('  %-12s  %d rows upserted (derived)', derived_sym, n)

    prune(conn)
    conn.close()
    logger.info('Done.')


if __name__ == '__main__':
    main()
