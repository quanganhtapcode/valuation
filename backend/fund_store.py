"""Persistent fund metadata and dated NAV; HTTP reads never call upstream."""
from __future__ import annotations

import json
import math
import os
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

DEFAULT_PATH = Path(__file__).resolve().parents[1] / 'data/funds.sqlite'


def connect():
    path = Path(os.getenv('FUNDS_DB_PATH', str(DEFAULT_PATH)))
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript('''
        CREATE TABLE IF NOT EXISTS funds (
            symbol TEXT PRIMARY KEY, product_id INTEGER NOT NULL,
            metadata TEXT NOT NULL, updated_at TEXT NOT NULL,
            history_updated_at TEXT, history_error TEXT);
        CREATE TABLE IF NOT EXISTS fund_nav (
            symbol TEXT NOT NULL REFERENCES funds(symbol),
            date TEXT NOT NULL, nav REAL NOT NULL CHECK(nav > 0),
            PRIMARY KEY(symbol, date));
        CREATE TABLE IF NOT EXISTS fund_nav_observations (
            symbol TEXT NOT NULL REFERENCES funds(symbol), date TEXT NOT NULL,
            source_id INTEGER NOT NULL, nav REAL NOT NULL, created_at INTEGER,
            PRIMARY KEY(symbol,date,source_id));
    ''')
    return db


def nav_point(stamp, value):
    stamp = date.fromisoformat(str(stamp)).isoformat()
    value = float(value)
    if not math.isfinite(value) or value <= 0:
        raise ValueError('Invalid NAV')
    return stamp, value


def save_listing(records):
    now = datetime.now(timezone.utc).isoformat()
    # Validate the whole listing before committing any changes.
    prepared = []
    for row in records:
        symbol = row['short_name'].upper()
        product_id = int(float(row['fund_id_fmarket']))
        point = nav_point(row['nav_update_at'], row['nav']) if row.get('nav_update_at') else None
        prepared.append((symbol, product_id, json.dumps(row, ensure_ascii=False, allow_nan=False), point))
    if not prepared:
        raise ValueError('Empty fund listing')
    db = connect()
    try:
        with db:
            for symbol, product_id, metadata, point in prepared:
                db.execute('''INSERT INTO funds(symbol,product_id,metadata,updated_at) VALUES(?,?,?,?)
                    ON CONFLICT(symbol) DO UPDATE SET product_id=excluded.product_id,
                    metadata=excluded.metadata,updated_at=excluded.updated_at''', (symbol, product_id, metadata, now))
                if point:
                    db.execute('INSERT INTO fund_nav VALUES(?,?,?) ON CONFLICT(symbol,date) DO UPDATE SET nav=excluded.nav', (symbol, *point))
    finally:
        db.close()


def save_history(symbol, rows):
    points = {}
    observations = []
    for row in rows:
        stamp, nav = nav_point(row['navDate'], row['nav'])
        source_id = int(row.get('id') or -1)
        created_at = int(row.get('createdAt') or 0)
        rank = (created_at, source_id)
        if stamp in points and points[stamp][0] == rank and points[stamp][1] != nav:
            raise ValueError('Conflicting NAV without distinct source identity')
        if stamp not in points or rank > points[stamp][0]:
            points[stamp] = (rank, nav)
        observations.append((symbol, stamp, source_id, nav, created_at))
    if not points:
        raise ValueError('Empty NAV history')
    db = connect()
    try:
        with db:
            db.executemany('INSERT INTO fund_nav_observations VALUES(?,?,?,?,?) ON CONFLICT(symbol,date,source_id) DO UPDATE SET nav=excluded.nav,created_at=excluded.created_at', observations)
            selected = []
            for stamp in points:
                best = db.execute('SELECT nav FROM fund_nav_observations WHERE symbol=? AND date=? ORDER BY created_at DESC,source_id DESC LIMIT 1', (symbol, stamp)).fetchone()[0]
                selected.append((symbol, stamp, best))
            db.executemany('INSERT INTO fund_nav VALUES(?,?,?) ON CONFLICT(symbol,date) DO UPDATE SET nav=excluded.nav', selected)
            db.execute('UPDATE funds SET history_updated_at=?,history_error=NULL WHERE symbol=?', (datetime.now(timezone.utc).isoformat(), symbol))
    finally:
        db.close()


def yearly_returns(points):
    result = []
    previous = None
    for year in sorted({point['date'][:4] for point in points}):
        rows = [point for point in points if point['date'].startswith(year)]
        first, last = rows[0], rows[-1]
        base = previous if previous and int(previous['date'][:4]) == int(year) - 1 else first
        result.append({'year': int(year), 'start_date': base['date'], 'end_date': last['date'],
                       'start_nav': base['nav'], 'end_nav': last['nav'],
                       'return_pct': (last['nav'] / base['nav'] - 1) * 100,
                       'partial': base is first, 'ytd': int(year) == datetime.now(ZoneInfo('Asia/Ho_Chi_Minh')).year})
        previous = last
    return result[::-1]


def fund_detail(symbol):
    db = connect()
    try:
        fund = db.execute('SELECT * FROM funds WHERE symbol=?', (symbol.upper(),)).fetchone()
        if fund is None:
            return None
        points = [dict(row) for row in db.execute('SELECT date,nav FROM fund_nav WHERE symbol=? ORDER BY date', (symbol.upper(),))]
        conflicts = db.execute('SELECT COUNT(*) FROM (SELECT date FROM fund_nav_observations WHERE symbol=? GROUP BY date HAVING COUNT(DISTINCT nav)>1)', (symbol.upper(),)).fetchone()[0]
        stamp = fund['history_updated_at']
        stale = not stamp or (datetime.now(timezone.utc) - datetime.fromisoformat(stamp)).total_seconds() > 172800
        return {'success': True, 'fund': json.loads(fund['metadata']), 'history': points,
                'yearly_returns': yearly_returns(points), 'history_updated_at': stamp,
                'history_stale': stale, 'history_available': bool(stamp), 'conflicting_dates': conflicts, 'source': 'Fmarket'}
    finally:
        db.close()
