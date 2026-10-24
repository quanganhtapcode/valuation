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

    def test_fast_snapshot_serves_expired_adjusted_rows_without_waiting_for_provider(self):
        rows = [{'date': '2026-10-06', 'open': 21600, 'high': 22350,
                 'low': 20150, 'close': 20150, 'volume': 10}]
        (Path(self.tmp.name) / 'FPT_260_ONE_DAY.json').write_text(
            json.dumps({'saved_at': 0, 'rows': rows}))
        with patch.object(history, '_fetch_gap_chart', side_effect=AssertionError('Blocking provider call')), \
             patch.object(history, '_REFRESHING', set()), \
             patch.object(history, '_REFRESH_SLOTS', MagicMock()), \
             patch.object(history.threading, 'Thread') as thread:
            response = self.app.test_client().get('/api/stock/history/FPT?period=1Y&snapshot=1')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['data'], rows)
        self.assertIn('s-maxage=5', response.headers['Cache-Control'])
        thread.return_value.start.assert_called_once()

    def test_empty_fast_snapshot_is_retryable_without_calling_any_provider(self):
        with patch.object(history, '_fetch_gap_chart', side_effect=AssertionError('Blocking provider call')), \
             patch.object(history.VCIClient, 'fetch_price_history_batch', side_effect=AssertionError('Blocking VCI call')), \
             patch.object(history, '_REFRESHING', set()), \
             patch.object(history, '_REFRESH_SLOTS', MagicMock()), \
             patch.object(history.threading, 'Thread'):
            response = self.app.test_client().get('/api/stock/history/VCB?period=1Y&snapshot=1')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers['Retry-After'], '2')
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_fast_snapshot_retains_sqlite_fallback_after_known_provider_failure(self):
        db = Path(self.tmp.name) / 'prices.sqlite'
        with sqlite3.connect(db) as conn:
            conn.execute('INSERT INTO stock_price_history VALUES (?,?,?,?,?,?,?)',
                         ('VCB', '2026-10-06', 100, 110, 90, 105, 1000))
        self.cache[('vietcapHistoryFailure', 'VCB:260:ONE_DAY')] = True
        with patch.object(history, '_fetch_gap_chart', side_effect=AssertionError('Blocking provider call')), \
             patch.object(history, '_REFRESHING', set()), \
             patch.object(history, '_REFRESH_SLOTS', MagicMock()), \
             patch.object(history.threading, 'Thread'):
            response = self.app.test_client().get('/api/stock/history/VCB?period=1Y&snapshot=1')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['source'], 'sqlite')
        self.assertEqual(response.json['data'][-1]['close'], 105)

    def response(self):
        r = MagicMock()
        r.json.return_value = [{'t': [1791244800], 'o': [21600], 'h': [22350], 'l': [20150], 'c': [20150], 'v': [16274800]}]
        return r

    def transport(self, effects):
        session = MagicMock()
        session.__enter__.return_value = session
        session.post.side_effect = effects
        return session

    def test_chrome_transport_retry_and_shared_cache(self):
        with patch.object(history.chart_requests, 'Session', return_value=self.transport([TimeoutError('read timeout'), self.response()])) as factory:
            result = self.app.test_client().get('/api/stock/history/PNJ?period=1Y').get_json()
            self.assertEqual(result['source'], 'vietcap')
            self.assertEqual(result['data'][-1]['date'], '2026-10-06')
            self.assertEqual(factory.return_value.post.call_count, 2)
            self.assertEqual(factory.return_value.post.call_args.kwargs['timeout'], 2)
            self.assertEqual(factory.call_args.kwargs['impersonate'], 'chrome124')
        self.cache.clear()  # A second worker has no in-memory cache.
        with patch.object(history.chart_requests, 'Session') as call:
            self.assertEqual(self.app.test_client().get('/api/stock/history/PNJ?period=1Y').get_json()['count'], 1)
            call.assert_not_called()

    def test_failure_cooldown_preserves_adjusted_history(self):
        rows = [{'date': '2026-10-06', 'open': 21600, 'high': 22350, 'low': 20150, 'close': 20150, 'volume': 1}]
        Path(self.tmp.name, 'PNJ_260_ONE_DAY.json').write_text(json.dumps({'saved_at': 1, 'rows': rows}))
        with patch.object(history.chart_requests, 'Session', return_value=self.transport([TimeoutError('read timeout'), TimeoutError('read timeout')])) as call:
            client = self.app.test_client()
            self.assertEqual(client.get('/api/stock/history/PNJ?period=1Y').get_json()['data'], rows)
            self.assertEqual(client.get('/api/stock/history/PNJ?period=1Y').get_json()['data'], rows)
            self.assertEqual(call.return_value.post.call_count, 2)

    def test_fallback_starts_background_retry_and_recovers(self):
        rows = [{'date': '2026-10-05', 'open': 21600, 'high': 22350, 'low': 20150, 'close': 20150, 'volume': 1}]
        with sqlite3.connect(history.resolve_price_history_db_path()) as conn:
            conn.execute("INSERT INTO stock_price_history VALUES ('PNJ', '2026-10-05', 21600, 22350, 20150, 20150, 1)")
        with patch.object(history.chart_requests, 'Session', return_value=self.transport([TimeoutError(), TimeoutError(), self.response()])) as call, patch.object(history.threading, 'Thread') as thread:
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
            self.assertEqual(call.return_value.post.call_count, 3)


if __name__ == '__main__':
    unittest.main()
