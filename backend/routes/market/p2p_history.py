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
        try:
            with closing(sqlite3.connect(DB_PATH.resolve().as_uri() + '?mode=ro', uri=True, timeout=2)) as conn:
                rows = conn.execute('''SELECT bucket_utc, price_vnd FROM price_snapshots
                    WHERE source = ? AND direction = ? AND bucket_utc >= ? ORDER BY bucket_utc''',
                    (source, direction, int(time.time()) - int(days) * 86400 if days != '0' else 0)).fetchall()
            return jsonify([{'time': row[0] * 1000, 'price': row[1]} for row in rows])
        except (OSError, sqlite3.Error):
            return jsonify({'error': 'P2P history unavailable'}), 503
