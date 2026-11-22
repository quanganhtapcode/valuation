"""Historical P2P observations collected at five-minute intervals."""
from contextlib import closing
import sqlite3
import time

from flask import Blueprint, jsonify, request

from .p2p_cash import DB_PATH


def register(market_bp: Blueprint) -> None:
    @market_bp.route('/p2p/history', methods=['GET'])
    def get_p2p_history():
        source = request.args.get('source', '')
        direction = request.args.get('direction', '')
        days = request.args.get('days', '1')
        if source not in ('okx', 'binance') or direction not in ('buy', 'sell') or days not in ('1', '7', '30', '0'):
            return jsonify({'error': 'Invalid history parameters'}), 400
        since = int(time.time()) - int(days) * 86400 if days != '0' else 0
        try:
            with closing(sqlite3.connect(DB_PATH.resolve().as_uri() + '?mode=ro', uri=True, timeout=2)) as conn:
                if request.args.get('resolution') == 'auto':
                    conn.execute('BEGIN')  # Keep the summary and buckets on the same snapshot.
                    summary = conn.execute("""
                        SELECT MIN(bucket_utc), MAX(bucket_utc), MIN(price_vnd), MAX(price_vnd)
                        FROM price_snapshots WHERE source = ? AND direction = ? AND bucket_utc >= ?
                    """, (source, direction, since)).fetchone()
                    start, end, low, high = summary
                    interval = 300
                    while start is not None and end // interval - start // interval >= 300:
                        interval *= 2
                    rows = conn.execute("""
                        SELECT MAX(bucket_utc), AVG(price_vnd),
                               MAX(CASE WHEN bucket_utc = ? THEN price_vnd END)
                        FROM price_snapshots
                        WHERE source = ? AND direction = ? AND bucket_utc >= ?
                        GROUP BY bucket_utc / ? ORDER BY MAX(bucket_utc)
                    """, (end, source, direction, since, interval)).fetchall()
                    return jsonify({
                        'points': [{'time': stamp * 1000, 'price': price} for stamp, price, _ in rows],
                        'intervalMinutes': interval // 60,
                        'low': low, 'high': high, 'latest': rows[-1][2] if rows else None,
                    })
                rows = conn.execute('''SELECT bucket_utc, price_vnd FROM price_snapshots
                    WHERE source = ? AND direction = ? AND bucket_utc >= ? ORDER BY bucket_utc''',
                    (source, direction, since)).fetchall()
            return jsonify([{'time': row[0] * 1000, 'price': row[1]} for row in rows])
        except (OSError, sqlite3.Error):
            return jsonify({'error': 'P2P history unavailable'}), 503
