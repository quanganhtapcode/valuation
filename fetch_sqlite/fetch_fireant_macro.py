"""
Fetch ALL FireAnt macro-economic indicators into fireant_macro.sqlite.

Fetches 9 data types: GDP, Prices, Business, Trade, Labour, Money, Consumer, Taxes, InterestRate
Each /info endpoint returns metadata + historicalValue embedded — no separate historical endpoint needed.

Usage:
    python3 fetch_sqlite/fetch_fireant_macro.py          # update all
    python3 fetch_sqlite/fetch_fireant_macro.py --types GDP,Trade
    python3 fetch_sqlite/fetch_fireant_macro.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any

import requests

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    handlers=[logging.StreamHandler()],
)
logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

_DB_PATH = os.path.join(os.path.dirname(__file__), 'fireant_macro.sqlite')

_BEARER = (
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
_HEADERS = {
    'authorization': f'Bearer {_BEARER}',
    'origin': 'https://fireant.vn',
    'accept': 'application/json',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
}

# All available types from /macro-data/types
ALL_TYPES = [
    'GDP', 'Prices', 'Business', 'Trade',
    'Labour', 'Money', 'Consumer', 'Taxes', 'InterestRate',
]

# ── Schema ────────────────────────────────────────────────────────────────────

_SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;

CREATE TABLE IF NOT EXISTS macro_indicators (
    id          INTEGER PRIMARY KEY,
    type        TEXT    NOT NULL,
    name        TEXT,
    name_vn     TEXT,
    unit        TEXT,
    frequency   TEXT,
    source      TEXT,
    last_value  REAL,
    last_date   TEXT,
    fetched_at  TEXT
);

CREATE TABLE IF NOT EXISTS macro_data (
    indicator_id  INTEGER NOT NULL,
    date          TEXT    NOT NULL,
    value         REAL,
    PRIMARY KEY (indicator_id, date)
);

CREATE INDEX IF NOT EXISTS idx_md_indicator ON macro_data(indicator_id);
CREATE INDEX IF NOT EXISTS idx_mi_type      ON macro_indicators(type);
"""


def _ensure_schema(conn: sqlite3.Connection) -> None:
    for stmt in _SCHEMA.strip().split(';'):
        stmt = stmt.strip()
        if stmt:
            conn.execute(stmt)
    conn.commit()


# ── Parsing ───────────────────────────────────────────────────────────────────

def _parse_date(raw: Any) -> str | None:
    """Normalise FireAnt Date field to a display string.

    - Annual  : integer year → "2025"
    - Others  : already a formatted string (e.g. "Q2/25", "11/25", "2025-03-31")
    """
    if raw is None:
        return None
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return str(int(raw))
    s = str(raw).strip()
    # ISO date: keep YYYY-MM-DD, drop time
    if len(s) >= 10 and s[4] == '-':
        return s[:10]
    return s  # already formatted (Q2/25, 11/25, etc.)


def _parse_indicators(raw_list: list, macro_type: str) -> list[dict]:
    """Convert raw API list into structured indicator dicts."""
    result = []
    for item in raw_list:
        hist_raw = item.get('historicalValue') or []
        data_points = []
        for pt in hist_raw:
            d = _parse_date(pt.get('Date') or pt.get('date'))
            v = pt.get('Value') or pt.get('value')
            if d and v is not None:
                try:
                    data_points.append({'date': d, 'value': float(v)})
                except (ValueError, TypeError):
                    pass

        last_date_raw = item.get('lastDate') or ''
        result.append({
            'id':        item['id'],
            'type':      macro_type,
            'name':      item.get('name') or '',
            'name_vn':   item.get('nameVN') or '',
            'unit':      item.get('unit') or '',
            'frequency': item.get('frequency') or '',
            'source':    item.get('source') or '',
            'last_value': item.get('lastValue'),
            'last_date':  last_date_raw[:10] if last_date_raw else '',
            'data':      data_points,
        })
    return result


# ── Fetch ─────────────────────────────────────────────────────────────────────

def fetch_type(macro_type: str, timeout: int = 15) -> list[dict]:
    url = f'https://restv2.fireant.vn/macro-data/{macro_type}/info'
    try:
        r = requests.get(url, headers=_HEADERS, timeout=timeout)
        if r.status_code != 200:
            logger.warning('%s: HTTP %s', macro_type, r.status_code)
            return []
        raw = r.json()
        if not isinstance(raw, list):
            logger.warning('%s: unexpected response shape', macro_type)
            return []
        indicators = _parse_indicators(raw, macro_type)
        logger.info('%s: %d indicators fetched', macro_type, len(indicators))
        return indicators
    except Exception as exc:
        logger.error('%s: %s', macro_type, exc)
        return []


# ── Store ─────────────────────────────────────────────────────────────────────

def store_indicators(conn: sqlite3.Connection, indicators: list[dict], dry_run: bool = False) -> tuple[int, int]:
    """Upsert indicators and their data points. Returns (indicators_upserted, data_points_upserted)."""
    now = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    ind_count = data_count = 0

    for ind in indicators:
        if dry_run:
            logger.info('  [dry] %s id=%d n=%d', ind['type'], ind['id'], len(ind['data']))
            continue

        conn.execute(
            """
            INSERT INTO macro_indicators
                (id, type, name, name_vn, unit, frequency, source, last_value, last_date, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, name_vn=excluded.name_vn,
                unit=excluded.unit, frequency=excluded.frequency,
                source=excluded.source, last_value=excluded.last_value,
                last_date=excluded.last_date, fetched_at=excluded.fetched_at
            """,
            (ind['id'], ind['type'], ind['name'], ind['name_vn'],
             ind['unit'], ind['frequency'], ind['source'],
             ind['last_value'], ind['last_date'], now),
        )
        ind_count += 1

        for pt in ind['data']:
            conn.execute(
                """
                INSERT INTO macro_data (indicator_id, date, value)
                VALUES (?, ?, ?)
                ON CONFLICT(indicator_id, date) DO UPDATE SET value=excluded.value
                """,
                (ind['id'], pt['date'], pt['value']),
            )
            data_count += 1

    if not dry_run:
        conn.commit()

    return ind_count, data_count


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description='Fetch FireAnt macro data into SQLite')
    parser.add_argument('--types', help='Comma-separated list of types (default: all)', default='')
    parser.add_argument('--dry-run', action='store_true', help='Fetch but do not write to DB')
    parser.add_argument('--workers', type=int, default=3, help='Parallel fetch workers (default: 3)')
    parser.add_argument('--db', default=_DB_PATH, help='SQLite DB path')
    args = parser.parse_args()

    types_to_fetch = [t.strip() for t in args.types.split(',') if t.strip()] if args.types else ALL_TYPES
    unknown = [t for t in types_to_fetch if t not in ALL_TYPES]
    if unknown:
        logger.error('Unknown types: %s. Available: %s', unknown, ALL_TYPES)
        sys.exit(1)

    logger.info('Fetching %d types: %s', len(types_to_fetch), types_to_fetch)

    conn = sqlite3.connect(args.db)
    _ensure_schema(conn)

    total_ind = total_data = 0
    t0 = time.time()

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(fetch_type, t): t for t in types_to_fetch}
        for future in as_completed(futures):
            macro_type = futures[future]
            indicators = future.result()
            if indicators:
                ind_c, data_c = store_indicators(conn, indicators, dry_run=args.dry_run)
                total_ind  += ind_c
                total_data += data_c

    conn.close()
    elapsed = time.time() - t0
    logger.info('Done in %.1fs — %d indicators, %d data points upserted', elapsed, total_ind, total_data)


if __name__ == '__main__':
    main()
