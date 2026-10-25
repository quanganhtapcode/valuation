"""Offline checks for market SQLite reader cleanup and snapshot paths."""
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import date
from pathlib import Path
from unittest.mock import patch

from flask import Blueprint, Flask

from backend.routes.market import valuation_chart
from scripts.fetchers.fetch_vci_screener import ensure_schema, upsert_items


class MarketReadConnectionTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / 'market.sqlite'
        self.patcher = patch.object(valuation_chart, '_VALUATION_SQLITE', self.path)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def assert_connections_closed(self, call):
        connections = []
        real_connect = sqlite3.connect

        def tracked(*args, **kwargs):
            conn = real_connect(*args, **kwargs)
            connections.append(conn)
            self.addCleanup(conn.close)
            return conn

        with patch('sqlite3.connect', side_effect=tracked):
            result = call()
        self.assertTrue(connections)
        for conn in connections:
            with self.assertRaises(sqlite3.ProgrammingError):
                conn.execute('SELECT 1')
        return result

    def test_valuation_reader_closes_after_success(self):
        with closing(sqlite3.connect(self.path)) as conn, conn:
            conn.executescript('''
                CREATE TABLE valuation_history(date,pe,pb,vnindex,open,high,low,close,ema50,volume);
                INSERT INTO valuation_history VALUES('2026-10-20',10,2,1200,1190,1210,1180,1200,1195,100);
            ''')
        result = self.assert_connections_closed(
            lambda: valuation_chart._read_valuation_from_sqlite(date(2026, 10, 20)))
        self.assertEqual(result['data'][0]['date'], '2026-10-20')
        self.assertEqual(result['data'][0]['pe'], 10)

    def test_readers_close_on_missing_tables_and_query_errors(self):
        with closing(sqlite3.connect(self.path)) as conn, conn:
            conn.execute('CREATE TABLE valuation_history(date)')
        self.assertEqual(self.assert_connections_closed(
            valuation_chart._read_ema_breadth_from_sqlite), [])
        self.assertIsNone(self.assert_connections_closed(
            valuation_chart._read_valuation_from_sqlite))

    def test_screener_supports_readonly_attachments_with_quoted_paths(self):
        company_path = self.path.with_name("company's snapshot #1.sqlite")
        with closing(sqlite3.connect(self.path)) as conn, conn:
            ensure_schema(conn)
            upsert_items(conn, [{'ticker': 'FPT', 'exchange': 'HSX', 'marketPrice': 100000,
                                 'ttmPe': 10}], '2026-10-20T00:00:00Z')
        with closing(sqlite3.connect(company_path)) as conn, conn:
            conn.executescript('''
                CREATE TABLE companies(ticker,icb_name1,icb_name2,icb_name3,icb_name4,
                                       icb_code1,icb_code2,icb_code3,icb_code4);
                INSERT INTO companies VALUES('FPT','Technology','Software','','',1,2,3,4);
                CREATE VIEW active_stocks AS SELECT * FROM companies;
            ''')
        app = Flask(__name__)
        bp = Blueprint('market_read_test', __name__)
        valuation_chart.register(bp)
        app.register_blueprint(bp)
        missing = str(self.path.with_name('missing.sqlite'))
        patches = [
            patch.object(valuation_chart, 'resolve_vci_screening_db_path', return_value=str(self.path)),
            patch.object(valuation_chart, 'resolve_vci_company_db_path', return_value=str(company_path)),
            patch.object(valuation_chart, 'resolve_valuation_cache_db_path', return_value=missing),
            patch.object(valuation_chart, 'resolve_vci_ratio_daily_db_path', return_value=missing),
            patch.object(valuation_chart, 'resolve_vci_stats_financial_db_path', return_value=missing),
            patch.object(valuation_chart, 'cache_func', return_value=lambda key, ttl, fetch: (fetch(), False)),
        ]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)
        client = app.test_client()
        response = self.assert_connections_closed(lambda: client.get('/screener?tickers=FPT'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['items'][0]['sector'], 'Software')
        self.assertEqual(response.json['items'][0]['ttmPe'], 10)
        sectors = self.assert_connections_closed(lambda: client.get('/screener/icb-sectors'))
        self.assertEqual(sectors.status_code, 200)
        self.assertEqual(sectors.json['sectors'][0]['icb_name2'], 'Software')
        self.assertFalse(Path(missing).exists())

    def test_numeric_filters_reject_nonfinite_values(self):
        self.path.touch()
        app = Flask(__name__)
        bp = Blueprint('market_numeric_test', __name__)
        valuation_chart.register(bp)
        app.register_blueprint(bp)
        with patch.object(valuation_chart, 'resolve_vci_screening_db_path', return_value=str(self.path)), \
                patch.object(valuation_chart, 'cache_func') as cache:
            for value in ('NaN', 'inf', '-inf', '1e999', 'not-a-number'):
                with self.subTest(value=value):
                    response = app.test_client().get('/screener', query_string={'pe_min': value})
                    self.assertEqual(response.status_code, 400)
                    self.assertFalse(response.json['success'])
            cache.assert_not_called()
