"""Read the latest complete USD cash snapshot collected on the VPS."""
from __future__ import annotations

from contextlib import closing
from pathlib import Path
import sqlite3
import time

from flask import Blueprint, jsonify

DB_PATH = Path(__file__).resolve().parents[3] / 'data' / 'sqlite' / 'p2p_history.sqlite'
MAX_AGE_MS = 10 * 60 * 1000


def read_cash_usd(path: Path = DB_PATH, now_ms: int | None = None) -> dict | None:
    now = int(time.time() * 1000) if now_ms is None else now_ms
    try:
        with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=2)) as conn:
            rows = conn.execute('''
                SELECT bucket_utc, MAX(fetched_at_ms),
                       MAX(CASE WHEN direction = 'buy' THEN price_vnd END),
                       MAX(CASE WHEN direction = 'sell' THEN price_vnd END)
                FROM price_snapshots
                WHERE source = 'cashUsd' AND direction IN ('buy', 'sell')
                  AND fetched_at_ms BETWEEN ? AND ?
                GROUP BY bucket_utc
                HAVING COUNT(DISTINCT direction) = 2
                ORDER BY bucket_utc DESC LIMIT 1
            ''', (now - MAX_AGE_MS, now)).fetchone()
        if rows is None or rows[2] <= 0 or rows[3] <= 0:
            return None
        return {'buy': rows[2], 'sell': rows[3], 'fetchedAt': rows[1]}
    except (OSError, sqlite3.Error, TypeError):
        return None


def register(market_bp: Blueprint) -> None:
    @market_bp.route('/p2p/cash-usd', methods=['GET'])
    def get_cash_usd():
        data = read_cash_usd()
        response = jsonify(data if data else {'error': 'USD cash rate unavailable'})
        response.status_code = 200 if data else 503
        response.headers['Cache-Control'] = 'no-store'
        return response
