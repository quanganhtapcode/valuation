import gzip
import json
import sqlite3
import unittest
import tempfile
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from flask import Blueprint, Flask

from automation.optimize_sqlite import migrate, verify_index
from backend.routes.stock.history import _valid_candles, _vietcap_cache_ttl
from backend.routes.stock import history
from backend.updater.update_price_history import PriceHistoryUpdater, PRICE_HISTORY_SCHEMA
from scripts.fetchers.fetch_vci_short_financials import decode_payload, upsert_payload


class SQLiteOptimizationTests(unittest.TestCase):
    def test_cache_ttl(self):
        for stamp, expected in [
            ('2026-09-11T10:00:00+07:00', 900),
            ('2026-09-11T16:00:00+07:00', 3600),
            ('2026-09-12T10:00:00+07:00', 3600),
            ('2026-09-14T08:55:00+07:00', 300),
            ('2026-09-14T02:00:00+00:00', 900),
        ]:
            with self.subTest(stamp=stamp):
                self.assertEqual(_vietcap_cache_ttl(datetime.fromisoformat(stamp)), expected)

    def test_invalid_candles(self):
        valid = dict(open=10, high=12, low=9, close=11, volume=0)
        rows = [valid] + [dict(valid, close=value) for value in (None, 0, -1, float('nan'), float('inf'))]
        self.assertEqual(_valid_candles(rows), [valid])

    def test_sqlite_fallback_endpoint_and_invalid_upsert(self):
        with tempfile.TemporaryDirectory() as folder:
            database = str(Path(folder) / 'prices.sqlite')
            with sqlite3.connect(database) as conn:
                conn.executescript(PRICE_HISTORY_SCHEMA)
                conn.executemany('INSERT INTO stock_price_history VALUES (?,?,?,?,?,?,?)', [
                    ('VCB', '2026-01-01', 10, 12, 9, 11, 100),
                    ('VCB', '2026-01-02', 10, 12, 9, None, 100),
                ])
            updater = PriceHistoryUpdater.__new__(PriceHistoryUpdater)
            updater.price_db_path = database
            self.assertEqual(updater.insert_price_records('VCB', [
                dict(time='2026-01-01', open=10, high=12, low=9, close=None)
            ]), 0)
            app = Flask(__name__)
            bp = Blueprint('history_test', __name__)
            history.register(bp)
            app.register_blueprint(bp)
            with patch.object(history, 'resolve_price_history_db_path', return_value=database), \
                 patch.object(history, 'cache_get_ns', return_value=None), \
                 patch.object(history.urllib.request, 'urlopen', side_effect=OSError('offline')):
                response = app.test_client().get('/history/VCB?start=2026-01-01&end=2026-01-03')
            self.assertEqual(response.status_code, 200)
            rows = response.get_json()['data']
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['close'], 11)

    def test_index_removal_preserves_query(self):
        with sqlite3.connect(':memory:') as conn:
            conn.executescript('''
                CREATE TABLE macro_prices(symbol TEXT, date TEXT, close REAL, PRIMARY KEY(symbol,date));
                CREATE INDEX idx_macro_symbol_date ON macro_prices(symbol,date);
                INSERT INTO macro_prices VALUES ('A','2026-09-01',12),('A','2026-09-02',13);
            ''')
            query = "SELECT date,close FROM macro_prices WHERE symbol='A' ORDER BY date DESC"
            before = conn.execute(query).fetchall()
            self.assertTrue(verify_index(conn, 'idx_macro_symbol_date'))
            migrate(conn, 'macro_history.sqlite', '')
            self.assertEqual(conn.execute(query).fetchall(), before)
            self.assertFalse(verify_index(conn, 'idx_macro_symbol_date'))

    def test_retention_preserves_last_success_and_errors(self):
        with sqlite3.connect(':memory:') as conn:
            conn.executescript('''
                CREATE TABLE fetch_log(ticker TEXT,status TEXT,fetched_at TEXT,PRIMARY KEY(ticker,fetched_at));
                INSERT INTO fetch_log VALUES
                ('A','ok','2025-01-01'),('A','ok','2025-02-01'),
                ('A','error','2025-03-01'),('B','ok','2026-09-01');
            ''')
            result = migrate(conn, 'vci_financials.sqlite', '2026-08-01')
            self.assertEqual(result['success_logs_archived'], 1)
            self.assertEqual(conn.execute('SELECT count(*) FROM fetch_log').fetchone()[0], 3)

    def test_payload_migration_and_future_upserts(self):
        with sqlite3.connect(':memory:') as conn:
            conn.execute('''CREATE TABLE short_financial_payload(
                ticker TEXT PRIMARY KEY,row_count INT,response_successful INT,response_status INT,
                server_datetime TEXT,trace_id TEXT,raw_json TEXT NOT NULL,fetched_at TEXT)''')
            payload = {'data': [{'revenue': 123, 'name': 'Ngân hàng'}], 'successful': True}
            raw = json.dumps(payload, ensure_ascii=False)
            conn.execute("INSERT INTO short_financial_payload(ticker,raw_json) VALUES ('A',?)", (raw,))
            migrate(conn, 'vci_short_financials.sqlite', '')
            packed = conn.execute('SELECT raw_json FROM short_financial_payload').fetchone()[0]
            self.assertEqual(gzip.decompress(packed).decode(), raw)
            self.assertEqual(decode_payload(packed), payload)
            self.assertEqual(decode_payload(raw), payload)
            self.assertEqual(migrate(conn, 'vci_short_financials.sqlite', '')['payloads_compressed'], 0)
            upsert_payload(conn, 'A', payload, payload['data'], '2026-09-12')
            self.assertEqual(decode_payload(conn.execute('SELECT raw_json FROM short_financial_payload').fetchone()[0]), payload)


if __name__ == '__main__':
    unittest.main()
