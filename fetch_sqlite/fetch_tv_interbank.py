#!/usr/bin/env python3
"""Fetch Vietnam macro indicators from TradingView WebSocket.

Symbols fetched:
  ECONOMICS:VNINBR  — Interbank overnight rate (daily,   ~5000 bars)
  ECONOMICS:VNIRYY  — Inflation rate YoY       (monthly, ~500  bars)

Stores close values into macro_history.sqlite (table: macro_prices).

Usage:
    python3 fetch_sqlite/fetch_tv_interbank.py
    python3 fetch_sqlite/fetch_tv_interbank.py --db fetch_sqlite/macro_history.sqlite
    python3 fetch_sqlite/fetch_tv_interbank.py --symbols VNINBR
"""
from __future__ import annotations

import argparse
import datetime
import json
import logging
import random
import sqlite3
import string
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import websocket

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

_DB_PATH = Path(__file__).parent / 'macro_history.sqlite'

WS_URL     = 'wss://data.tradingview.com/socket.io/websocket'
WS_TIMEOUT = 30


@dataclass
class TVSymbol:
    symbol: str       # TradingView symbol e.g. 'ECONOMICS:VNINBR'
    resolution: str   # 'D', 'W', 'M', etc.
    n_bars: int       # number of bars to request


TV_SYMBOLS: list[TVSymbol] = [
    # Rates (daily)
    TVSymbol('ECONOMICS:VNINBR',  'D', 5000),  # Interbank overnight rate
    # GDP
    TVSymbol('ECONOMICS:VNGDPYY',  'M', 600),  # GDP growth YoY (quarterly)
    TVSymbol('ECONOMICS:VNGDPCP',  'M', 600),  # Real GDP (quarterly)
    TVSymbol('ECONOMICS:VNGDPS',   'M', 600),  # GDP - Services
    TVSymbol('ECONOMICS:VNGDPMAN', 'M', 600),  # GDP - Manufacturing
    TVSymbol('ECONOMICS:VNGDPA',   'M', 600),  # GDP - Agriculture
    TVSymbol('ECONOMICS:VNGDPPC',  'M', 200),  # GDP per capita (annual)
    TVSymbol('ECONOMICS:VNGNP',    'M', 200),  # GNP (annual)
    TVSymbol('ECONOMICS:VNGFCF',   'M', 200),  # Fixed capital formation (annual)
    # Prices & Inflation
    TVSymbol('ECONOMICS:VNIRYY',   'M', 600),  # Inflation YoY
    TVSymbol('ECONOMICS:VNCPI',    'M', 600),  # CPI index
    TVSymbol('ECONOMICS:VNFI',     'M', 400),  # Food inflation
    TVSymbol('ECONOMICS:VNCIR',    'M', 300),  # Core inflation
    TVSymbol('ECONOMICS:VNGASP',   'M', 300),  # Gasoline price
    # Money & Interest Rates
    TVSymbol('ECONOMICS:VNINTR',   'M', 600),  # Policy interest rate
    TVSymbol('ECONOMICS:VNFER',    'M', 600),  # FX reserves
    TVSymbol('ECONOMICS:VNM2',     'M', 200),  # M2 money supply (annual)
    TVSymbol('ECONOMICS:VNDIR',    'M', 100),  # Deposit rate (annual)
    # Trade
    TVSymbol('ECONOMICS:VNEXP',    'M', 600),  # Exports
    TVSymbol('ECONOMICS:VNIMP',    'M', 600),  # Imports
    TVSymbol('ECONOMICS:VNBOT',    'M', 600),  # Trade balance
    TVSymbol('ECONOMICS:VNFDI',    'M', 400),  # FDI
    # Labour
    TVSymbol('ECONOMICS:VNUR',     'M', 300),  # Unemployment rate
    TVSymbol('ECONOMICS:VNWAG',    'M', 200),  # Average wages
    TVSymbol('ECONOMICS:VNMW',     'M', 100),  # Minimum wage
    TVSymbol('ECONOMICS:VNPOP',    'M', 200),  # Population
    # Business & Consumer
    TVSymbol('ECONOMICS:VNIPYY',   'M', 400),  # Industrial production YoY
    TVSymbol('ECONOMICS:VNRSYY',   'M', 400),  # Retail sales YoY
]


# ── WebSocket helpers ─────────────────────────────────────────────────────────

def _make_session() -> str:
    return ''.join(random.choices(string.ascii_lowercase, k=12))


def _send(ws: websocket.WebSocketApp, func: str, args: list) -> None:
    msg = json.dumps({'m': func, 'p': args})
    ws.send(f'~m~{len(msg)}~m~{msg}')


def _parse_messages(raw: str) -> list[dict]:
    msgs: list[dict] = []
    i = 0
    while True:
        start = raw.find('~m~', i)
        if start == -1:
            break
        end = raw.find('~m~', start + 3)
        if end == -1:
            break
        try:
            length = int(raw[start + 3:end])
            payload = raw[end + 3:end + 3 + length]
            try:
                msgs.append(json.loads(payload))
            except json.JSONDecodeError:
                pass
        except ValueError:
            pass
        i = end + 3
    return msgs


# ── Fetch one symbol ──────────────────────────────────────────────────────────

def fetch_symbol(tv: TVSymbol) -> list[tuple[str, float]]:
    """Return list of (date_str, close) sorted ascending."""
    bars: list[dict] = []
    done = threading.Event()

    def on_message(ws: websocket.WebSocketApp, raw: str) -> None:
        for d in _parse_messages(raw):
            m = d.get('m')
            if m == 'timescale_update':
                p = d.get('p', [])
                if len(p) > 1:
                    for bar in p[1].get('s1', {}).get('s', []):
                        v = bar.get('v', [])
                        if len(v) >= 5:
                            bars.append({'ts': v[0], 'c': v[4]})
            if m == 'series_completed':
                done.set()

    def on_open(ws: websocket.WebSocketApp) -> None:
        cs = _make_session()
        _send(ws, 'set_auth_token', ['unauthorized_user_token'])
        _send(ws, 'chart_create_session', [cs, ''])
        sym_payload = '=' + json.dumps({'symbol': tv.symbol, 'adjustment': 'splits'})
        _send(ws, 'resolve_symbol', [cs, 'sym1', sym_payload])
        _send(ws, 'create_series', [cs, 's1', 's1', 'sym1', tv.resolution, tv.n_bars])

    def on_error(ws: websocket.WebSocketApp, err: Exception) -> None:
        logger.error('[%s] WebSocket error: %s', tv.symbol, err)
        done.set()

    ws = websocket.WebSocketApp(
        WS_URL,
        header={'Origin': 'https://www.tradingview.com'},
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
    )
    t = threading.Thread(target=ws.run_forever, kwargs={'ping_interval': 0}, daemon=True)
    t.start()
    done.wait(timeout=WS_TIMEOUT)
    ws.close()

    if not bars:
        raise RuntimeError(f'No data received for {tv.symbol}')

    result = [
        (datetime.datetime.utcfromtimestamp(b['ts']).strftime('%Y-%m-%d'), b['c'])
        for b in bars
    ]
    result.sort(key=lambda x: x[0])
    return result


# ── SQLite store ──────────────────────────────────────────────────────────────

def store(db_path: Path, symbol: str, rows: list[tuple[str, float]]) -> int:
    conn = sqlite3.connect(db_path)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS macro_prices (
            symbol TEXT NOT NULL,
            date   TEXT NOT NULL,
            close  REAL,
            PRIMARY KEY (symbol, date)
        )
    ''')
    for date_str, close in rows:
        conn.execute(
            'INSERT INTO macro_prices (symbol, date, close) VALUES (?, ?, ?)'
            ' ON CONFLICT(symbol, date) DO UPDATE SET close=excluded.close',
            (symbol, date_str, close),
        )
    conn.commit()
    conn.close()
    return len(rows)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', default=str(_DB_PATH))
    ap.add_argument('--symbols', help='Comma-separated short names to fetch, e.g. VNINBR,VNIRYY')
    args = ap.parse_args()

    db_path = Path(args.db)

    filter_set: set[str] | None = None
    if args.symbols:
        filter_set = {s.strip().upper() for s in args.symbols.split(',')}

    for tv in TV_SYMBOLS:
        short = tv.symbol.split(':')[-1]
        if filter_set and short not in filter_set:
            continue

        logger.info('Fetching %s (resolution=%s, n_bars=%d)...', tv.symbol, tv.resolution, tv.n_bars)
        try:
            rows = fetch_symbol(tv)
            logger.info('  Received %d points (%s → %s)', len(rows), rows[0][0], rows[-1][0])
            n = store(db_path, tv.symbol, rows)
            logger.info('  Upserted %d rows (symbol=%s)', n, tv.symbol)
        except Exception as exc:
            logger.error('  Failed: %s', exc)

        time.sleep(1)


if __name__ == '__main__':
    main()
