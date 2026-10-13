#!/usr/bin/env python3
"""Refresh TradingView Vietnam economic observations without deleting history."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import logging
import math
from pathlib import Path
import re
import secrets
import sqlite3
import statistics
import time

import websocket

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB = ROOT / 'data/sqlite/macro_history.sqlite'
SYMBOLS = tuple('ECONOMICS:' + code for code in (
    'VNINBR', 'VNIRYY', 'VNGDPYY', 'VNGDPCP', 'VNGDPS', 'VNGDPMAN',
    'VNGDPA', 'VNGDPPC', 'VNGNP', 'VNGFCF', 'VNCPI', 'VNFI', 'VNCIR',
    'VNGASP', 'VNINTR', 'VNFER', 'VNM2', 'VNDIR', 'VNEXP', 'VNIMP',
    'VNBOT', 'VNFDI', 'VNUR', 'VNWAG', 'VNMW', 'VNPOP', 'VNIPYY', 'VNRSYY',
))
LOGGER = logging.getLogger(__name__)


def decode_messages(buffer: str) -> tuple[list[str], str]:
    messages = []
    while buffer:
        match = re.match(r'~m~(\d+)~m~', buffer)
        if match is None:
            if '~m~'.startswith(buffer) or re.match(r'^~m~\d*(?:~m?)?$', buffer):
                break
            raise ValueError('Invalid TradingView frame')
        end = match.end() + int(match.group(1))
        if len(buffer) < end:
            break
        messages.append(buffer[match.end():end])
        buffer = buffer[end:]
    return messages, buffer


def normalize_bars(bars: list[dict]) -> list[tuple[str, float]]:
    today = datetime.now(timezone.utc).date().isoformat()
    rows = {}
    for bar in bars:
        values = bar.get('v', [])
        if len(values) < 5:
            continue
        timestamp, close = float(values[0]), float(values[4])
        if not math.isfinite(timestamp) or not math.isfinite(close):
            continue
        date = datetime.fromtimestamp(timestamp, timezone.utc).date().isoformat()
        if date <= today:
            rows[date] = close
    if not rows:
        raise ValueError('Empty economic series')
    return sorted(rows.items())


def fetch_series(symbol: str, timeout: float = 30) -> list[tuple[str, float]]:
    session = 'cs_' + secrets.token_hex(6)
    socket = websocket.create_connection(
        'wss://data.tradingview.com/socket.io/websocket',
        origin='https://www.tradingview.com', timeout=timeout,
    )
    def send(method: str, params: list) -> None:
        body = json.dumps({'m': method, 'p': params}, separators=(',', ':'))
        socket.send(f'~m~{len(body)}~m~{body}')
    try:
        send('set_auth_token', ['unauthorized_user_token'])
        send('chart_create_session', [session, ''])
        definition = '=' + json.dumps({'symbol': symbol, 'adjustment': 'splits', 'session': 'regular'}, separators=(',', ':'))
        send('resolve_symbol', [session, 'sym1', definition])
        # Monthly resolution preserves the original observation dates for monthly,
        # quarterly and annual economics; 12M would shift annual observations.
        send('create_series', [session, 's1', 's1', 'sym1', '1D' if symbol == 'ECONOMICS:VNINBR' else '1M', 600])
        deadline = time.monotonic() + timeout
        buffer = ''
        bars = []
        while time.monotonic() < deadline:
            socket.settimeout(max(0.1, deadline - time.monotonic()))
            received = socket.recv()
            if not received:
                raise RuntimeError('TradingView disconnected before completing series')
            buffer += received.decode() if isinstance(received, bytes) else received
            messages, buffer = decode_messages(buffer)
            for body in messages:
                if body.startswith('~h~'):
                    socket.send(f'~m~{len(body)}~m~{body}')
                    continue
                message = json.loads(body)
                method, params = message.get('m'), message.get('p', [])
                if method in ('series_error', 'symbol_error', 'critical_error', 'protocol_error'):
                    raise RuntimeError(f'TradingView {method}: {params}')
                if method == 'timescale_update' and len(params) > 1:
                    bars.extend(params[1].get('s1', {}).get('s', []))
                if method == 'series_completed':
                    return normalize_bars(bars)
        raise TimeoutError('TradingView series did not complete')
    finally:
        socket.close()


def save_series(db: sqlite3.Connection, symbol: str, rows: list[tuple[str, float]]) -> int:
    if not rows or len(dict(rows)) != len(rows) or any(not math.isfinite(value) for _, value in rows):
        raise ValueError('Invalid or duplicate economic observations')
    existing = dict(db.execute('SELECT date, close FROM macro_prices WHERE symbol=?', (symbol,)))
    ratios = [abs(value / existing[date]) for date, value in rows if date in existing and existing[date] and value]
    if existing and not any(date in existing for date, _ in rows):
        raise ValueError('No overlapping dates; refusing to join incompatible histories')
    if ratios and not 0.1 <= statistics.median(ratios) <= 10:
        raise ValueError('Possible unit change; refusing to mix incompatible values')
    if existing and rows[-1][0] < max(existing):
        raise ValueError('Source is older than the saved observations')
    with db:
        db.executemany('INSERT OR REPLACE INTO macro_prices (symbol,date,close) VALUES (?,?,?)', [(symbol, date, close) for date, close in rows])
        db.execute('''INSERT OR REPLACE INTO macro_fetch_status
                      (symbol,fetched_at,last_date,point_count) VALUES (?,?,?,?)''',
                   (symbol, datetime.now(timezone.utc).isoformat(), rows[-1][0], len(rows)))
    return sum(date not in existing for date, _ in rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=DEFAULT_DB)
    parser.add_argument('--symbols', nargs='+', choices=SYMBOLS, default=SYMBOLS)
    parser.add_argument('--timeout', type=float, default=30)
    parser.add_argument('--retries', type=int, default=3)
    parser.add_argument('--delay', type=float, default=1.0)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    db = sqlite3.connect(args.db) if not args.dry_run else None
    if db:
        db.execute('CREATE TABLE IF NOT EXISTS macro_prices (symbol TEXT NOT NULL,date TEXT NOT NULL,close REAL NOT NULL,PRIMARY KEY(symbol,date))')
        db.execute('CREATE TABLE IF NOT EXISTS macro_fetch_status (symbol TEXT PRIMARY KEY,fetched_at TEXT NOT NULL,last_date TEXT NOT NULL,point_count INTEGER NOT NULL)')
        db.commit()
    failed = []
    try:
        for symbol in args.symbols:
            for attempt in range(max(1, args.retries)):
                try:
                    rows = fetch_series(symbol, args.timeout)
                    added = save_series(db, symbol, rows) if db else 0
                    LOGGER.info('%s points=%d latest=%s new=%d dry_run=%s', symbol, len(rows), rows[-1][0], added, args.dry_run)
                    break
                except Exception as exc:
                    LOGGER.warning('%s attempt=%d: %s', symbol, attempt + 1, exc)
                    if attempt + 1 >= max(1, args.retries):
                        failed.append(symbol)
                    else:
                        time.sleep(2)
            time.sleep(max(0, args.delay))
    finally:
        if db:
            db.close()
    LOGGER.info('Finished: success=%d failed=%d %s', len(args.symbols) - len(failed), len(failed), ','.join(failed))
    return (75 if len(failed) < len(args.symbols) else 1) if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
