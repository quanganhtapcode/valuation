import gzip
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

from flask import Flask, Blueprint
from backend.routes.stock import history


class ChartHistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = Flask(__name__)
        bp = Blueprint('chart_test', __name__)
        history.register(bp)
        self.app.register_blueprint(bp, url_prefix='/api')
        self.cache = {}
        db_path = Path(self.tmp.name) / 'prices.sqlite'
        with sqlite3.connect(db_path) as conn:
            conn.execute('CREATE TABLE stock_price_history (symbol TEXT, time TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL)')
        self.patches = [
            patch.object(history, '_expected_session_date', return_value='2026-10-06'),
            patch.object(history, '_HISTORY_CACHE_DIR', Path(self.tmp.name)),
            patch.object(history, 'resolve_price_history_db_path', return_value=str(db_path)),
            patch.object(history, 'cache_get_ns', side_effect=lambda ns, key: self.cache.get((ns, key))),
            patch.object(history, 'cache_set_ns', side_effect=lambda ns, key, value, ttl: self.cache.__setitem__((ns, key), value)),
        ]
        for p in self.patches:
            p.start()
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(lambda: [p.stop() for p in reversed(self.patches)])

    def response(self):
        r = MagicMock()
        r.__enter__.return_value = r
        r.headers = {'Content-Encoding': 'gzip'}
        r.read.return_value = gzip.compress(json.dumps([{'t': [1791244800], 'o': [21600], 'h': [22350], 'l': [20150], 'c': [20150], 'v': [16274800]}]).encode())
        return r

    def test_timeout_retry_gzip_and_shared_cache(self):
        with patch.object(history.urllib.request, 'urlopen', side_effect=[TimeoutError('read timeout'), self.response()]) as call:
            result = self.app.test_client().get('/api/stock/history/PNJ?period=1Y').get_json()
            self.assertEqual(result['source'], 'vietcap')
            self.assertEqual(result['data'][-1]['date'], '2026-10-06')
            self.assertEqual(call.call_count, 2)
            self.assertEqual(call.call_args.kwargs['timeout'], 2)
        self.cache.clear()  # A second worker has no in-memory cache.
        with patch.object(history.urllib.request, 'urlopen') as call:
            self.assertEqual(self.app.test_client().get('/api/stock/history/PNJ?period=1Y').get_json()['count'], 1)
            call.assert_not_called()

    def test_failure_cooldown_preserves_adjusted_history(self):
        rows = [{'date': '2026-10-06', 'open': 21600, 'high': 22350, 'low': 20150, 'close': 20150, 'volume': 1}]
        Path(self.tmp.name, 'PNJ_260_ONE_DAY.json').write_text(json.dumps({'saved_at': 1, 'rows': rows}))
        with patch.object(history.urllib.request, 'urlopen', side_effect=TimeoutError('read timeout')) as call:
            client = self.app.test_client()
            self.assertEqual(client.get('/api/stock/history/PNJ?period=1Y').get_json()['data'], rows)
            self.assertEqual(client.get('/api/stock/history/PNJ?period=1Y').get_json()['data'], rows)
            self.assertEqual(call.call_count, 2)

    def test_fallback_starts_background_retry_and_recovers(self):
        rows = [{'date': '2026-10-05', 'open': 21600, 'high': 22350, 'low': 20150, 'close': 20150, 'volume': 1}]
        with sqlite3.connect(history.resolve_price_history_db_path()) as conn:
            conn.execute("INSERT INTO stock_price_history VALUES ('PNJ', '2026-10-05', 21600, 22350, 20150, 20150, 1)")
        with patch.object(history.urllib.request, 'urlopen', side_effect=[TimeoutError(), TimeoutError(), self.response()]) as call, patch.object(history.threading, 'Thread') as thread:
            client = self.app.test_client()
            first = client.get('/api/stock/history/PNJ?period=1Y').get_json()
            self.assertEqual(first['source'], 'sqlite')
            self.assertEqual(first['data'], rows)
            thread.return_value.start.assert_called_once()
            thread.call_args.kwargs['target']()
            second = client.get('/api/stock/history/PNJ?period=1Y')
            self.assertEqual(second.get_json()['latest_date'], '2026-10-06')
            self.assertEqual(second.get_json()['source'], 'vietcap')
            self.assertEqual(second.headers['Cache-Control'], 'no-store')
            self.assertEqual(call.call_count, 3)


if __name__ == '__main__':
    unittest.main()
