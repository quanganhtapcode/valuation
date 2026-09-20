"""Offline regression tests for snapshot reads, writer isolation and API behavior."""
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

from flask import Flask, Blueprint
from backend.sqlite_utils import read_connection, row_dict
from backend.vci_data_access import _connect, VCIDataAccess
from backend.updater import batch_news
from backend.routes.stock import news_events, loan_breakdown
from backend.routes.health_routes import _check_ingestion
from backend import db_path


class TempDBCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'data.sqlite'

    def tearDown(self):
        self.tmp.cleanup()


class SQLiteTests(TempDBCase):
    def test_reader_never_creates_database(self):
        with self.assertRaises(sqlite3.OperationalError):
            with read_connection(self.path):
                pass
        self.assertFalse(self.path.exists())

    def test_reader_is_closed_after_query_failure(self):
        sqlite3.connect(self.path).close()
        with self.assertRaisesRegex(sqlite3.OperationalError, 'no such table'):
            with _connect(str(self.path)) as conn:
                conn.execute('SELECT * FROM absent')
        with self.assertRaises(sqlite3.ProgrammingError):
            conn.execute('SELECT 1')

    def test_reader_disallows_writes_and_preserves_values(self):
        sqlite3.connect(self.path).close()
        with read_connection(self.path) as conn:
            row = conn.execute("SELECT NULL AS a, 0 AS b, -1.5 AS c, 'Việt Nam' AS d").fetchone()
            self.assertEqual(row_dict(row), dict(row))
            with self.assertRaises(sqlite3.OperationalError):
                conn.execute('CREATE TABLE forbidden (a)')
        with self.assertRaises(sqlite3.ProgrammingError):
            conn.execute('SELECT 1')

    def test_explicit_missing_path_does_not_fall_back(self):
        self.assertEqual(db_path.resolve_vci_company_db_path(str(self.path)), str(self.path))
        with patch.dict('os.environ', {'VCI_FINANCIAL_STATEMENT_DB_PATH': str(self.path)}):
            self.assertEqual(db_path.resolve_vci_financial_statement_db_path(), str(self.path))

    def test_financial_results_keep_both_period_types(self):
        conn = sqlite3.connect(self.path)
        conn.executescript('CREATE TABLE balance_sheet(ticker, period_kind, year_report, quarter_report, value);'
                           "INSERT INTO balance_sheet VALUES ('VCB','YEAR',2025,0,NULL),('VCB','QUARTER',2026,1,0);")
        conn.close()
        with patch('backend.vci_data_access.resolve_vci_financial_statement_db_path', return_value=str(self.path)):
            result = VCIDataAccess().get_financial_statement('VCB', 'balance')
        self.assertEqual([r['period_kind'] for r in result], ['QUARTER', 'YEAR'])
        self.assertEqual([r['value'] for r in result], [0, None])

    def test_freshness_uses_metadata_not_file_mtime(self):
        conn = sqlite3.connect(self.path)
        conn.executescript("CREATE TABLE meta(k,v); INSERT INTO meta VALUES ('last_run_finished','2020-01-01T00:00:00Z');")
        conn.close()
        result = _check_ingestion(self.path, finished_key='last_run_finished', max_age_minutes=60)
        self.assertEqual(result['status'], 'warn')


class SnapshotTests(TempDBCase):
    def setUp(self):
        super().setUp()
        self.conn = sqlite3.connect(self.path)
        batch_news._init_db(self.conn)
        self.path_patch = patch.object(news_events, 'resolve_vci_news_events_db_path', return_value=str(self.path))
        self.path_patch.start()
        app = Flask(__name__)
        bp = Blueprint('test_stock', __name__)
        news_events.register(bp)
        app.register_blueprint(bp)
        self.client = app.test_client()

    def tearDown(self):
        self.path_patch.stop()
        self.conn.close()
        super().tearDown()

    def seed(self, tab='news', items=None):
        batch_news._store_result(self.conn, 'VCB', tab, items if items is not None else [
            {'id': '1', 'title': 'Test event', 'publicDate': '2026-09-20 10:00:00', 'eventCode': 'DIV'}])

    def test_successful_write_is_committed_before_next_fetch(self):
        self.seed()
        self.assertFalse(self.conn.in_transaction)
        with read_connection(self.path) as reader:
            self.assertEqual(reader.execute('SELECT COUNT(*) FROM items').fetchone()[0], 1)
        self.assertEqual(self.conn.execute('PRAGMA journal_mode').fetchone()[0], 'wal')

    def test_wal_reader_sees_previous_committed_snapshot_during_write(self):
        self.seed()
        self.conn.execute("UPDATE items SET title='pending'")
        with read_connection(self.path, timeout=.05) as reader:
            self.assertEqual(reader.execute('SELECT title FROM items').fetchone()[0], '')
        self.conn.rollback()

    def test_failed_store_rolls_back_items_and_metadata(self):
        self.seed()
        self.conn.execute("CREATE TRIGGER fail_meta BEFORE INSERT ON fetch_meta BEGIN SELECT RAISE(ABORT, 'fail'); END")
        self.conn.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            batch_news._store_result(self.conn, 'VCB', 'news', [{'id': '2'}])
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM items').fetchone()[0], 1)
        self.assertFalse(self.conn.in_transaction)

    def test_known_empty_snapshot_does_not_fetch_again(self):
        self.seed(items=[])
        with patch.object(news_events, '_schedule_refresh') as refresh:
            response = self.client.get('/vci-feed/VCB?tab=news')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['data'], [])
        self.assertFalse(response.json['stale'])
        refresh.assert_not_called()

    def test_missing_snapshot_returns_retryable_error_without_network_wait(self):
        with patch.object(news_events, '_schedule_refresh', return_value=True) as refresh:
            response = self.client.get('/vci-feed/VCB?tab=news')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers['Retry-After'], '10')
        self.assertFalse(response.json['success'])
        self.assertTrue(response.json['refresh_pending'])
        refresh.assert_called_once_with('VCB')

    def test_stale_snapshot_returns_data_and_schedules_refresh(self):
        self.seed()
        self.conn.execute("UPDATE fetch_meta SET last_fetched='2020-01-01'")
        self.conn.commit()
        with patch.object(news_events, '_schedule_refresh', return_value=True):
            response = self.client.get('/vci-feed/VCB?tab=news')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json['stale'])
        self.assertEqual(response.json['data'][0]['id'], '1')

    def test_events_preserve_response_fields_without_upstream(self):
        for tab in news_events._EVENT_TABS:
            self.seed(tab, [] if tab != 'dividend' else None)
        with patch.object(news_events, '_schedule_refresh') as refresh:
            response = self.client.get('/events/VCB')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['data'], [{'event_name': 'Test event', 'event_code': 'DIV',
                                                 'notify_date': '2026-09-20', 'url': '#'}])
        refresh.assert_not_called()

    def test_malformed_json_is_not_a_successful_empty_snapshot(self):
        self.seed()
        self.conn.execute("UPDATE items SET raw_json='invalid'")
        self.conn.commit()
        with patch.object(news_events, '_schedule_refresh', return_value=True):
            response = self.client.get('/vci-feed/VCB?tab=news')
        self.assertEqual(response.status_code, 503)

    def test_refresh_is_deduplicated(self):
        news_events._REFRESH_PENDING.clear()
        news_events._REFRESH_ATTEMPTS.clear()
        with patch.object(news_events._REFRESH_POOL, 'submit') as submit:
            self.assertTrue(news_events._schedule_refresh('VCB'))
            self.assertTrue(news_events._schedule_refresh('VCB'))
            submit.assert_called_once()
        news_events._REFRESH_PENDING.clear()
        news_events._REFRESH_SLOTS.release()

    def test_invalid_upstream_response_is_not_published_as_empty(self):
        response = Mock()
        response.json.return_value = {'error': 'unavailable'}
        with patch.object(batch_news.requests, 'get', return_value=response):
            with self.assertRaises(ValueError):
                batch_news._fetch_tab('VCB', 'news')


class MaintenanceTests(TempDBCase):
    def test_only_redundant_index_is_removed_and_rows_preserved(self):
        from automation.optimize_sqlite import migrate
        conn = sqlite3.connect(self.path)
        conn.executescript("CREATE TABLE shareholders(ticker,owner_code,PRIMARY KEY(ticker,owner_code));"
                           "CREATE INDEX idx_shareholders_ticker ON shareholders(ticker);"
                           "INSERT INTO shareholders VALUES('VCB','owner');")
        result = migrate(conn, 'vci_shareholders.sqlite', '2026-01-01')
        self.assertEqual(result['indexes_removed'], ['idx_shareholders_ticker'])
        self.assertEqual(conn.execute('SELECT * FROM shareholders').fetchall(), [('VCB', 'owner')])
        self.assertTrue(conn.execute('PRAGMA index_list(shareholders)').fetchall())
        conn.close()

    def test_changed_index_is_not_dropped(self):
        from automation.optimize_sqlite import migrate
        conn = sqlite3.connect(self.path)
        conn.executescript("CREATE TABLE shareholders(ticker,owner_code,PRIMARY KEY(ticker,owner_code));"
                           "CREATE INDEX idx_shareholders_ticker ON shareholders(owner_code);")
        with self.assertRaises(RuntimeError):
            migrate(conn, 'vci_shareholders.sqlite', '2026-01-01')
        conn.close()


class FetcherTests(TempDBCase):
    def test_fetcher_schemas_do_not_recreate_redundant_indexes(self):
        from scripts.fetchers.fetch_vci_shareholders import ensure_schema
        from scripts.fetchers.fetch_fireant_macro import _ensure_schema
        conn = sqlite3.connect(self.path)
        ensure_schema(conn)
        _ensure_schema(conn)
        names = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
        self.assertNotIn('idx_shareholders_ticker', names)
        self.assertNotIn('idx_md_indicator', names)
        self.assertIn('sqlite_autoindex_shareholders_1', names)
        conn.close()

    def test_market_news_commits_before_next_http_request(self):
        from scripts.fetchers import fetch_vci_market_news as fetcher
        def fetch_page(**kwargs):
            if kwargs['page'] == 1:
                return [{'id': 'one', 'ticker': 'VCB', 'news_title': 'Saved page'}]
            with read_connection(self.path) as reader:
                self.assertEqual(reader.execute('SELECT COUNT(*) FROM news_items').fetchone()[0], 1)
                self.assertIsNone(reader.execute("SELECT value FROM news_meta WHERE key='last_fetch_utc'").fetchone())
            raise RuntimeError('second page unavailable')
        with patch.object(fetcher, 'fetch_news_page', side_effect=fetch_page):
            with self.assertRaisesRegex(RuntimeError, 'second page'):
                fetcher.fetch_to_sqlite(db_path=str(self.path), ticker='', pages=2, page_size=50,
                                        days_back=30, timeout_s=1, retries=0, backoff_base_s=0,
                                        verify_ssl=True, workers=1, prune_days=0)
        with read_connection(self.path) as reader:
            self.assertEqual(reader.execute('PRAGMA journal_mode').fetchone()[0], 'wal')
            self.assertEqual(reader.execute('SELECT COUNT(*) FROM news_items').fetchone()[0], 1)


class LoanTests(TempDBCase):
    def test_projection_supports_partial_legacy_schema(self):
        conn = sqlite3.connect(self.path)
        conn.executescript("CREATE TABLE note(ticker,period_kind,year_report,nob12,nob40);"
                           "INSERT INTO note VALUES('VCB','YEAR',2025,100,0);")
        conn.close()
        app = Flask(__name__)
        bp = Blueprint('loan', __name__)
        loan_breakdown.register(bp)
        app.register_blueprint(bp)
        with patch.object(loan_breakdown, 'resolve_vci_financial_statement_db_path', return_value=str(self.path)):
            response = app.test_client().get('/stock/VCB/loan-breakdown')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {'years': [2025], 'year': 2025,
                                        'industry': [{'name': 'Thương mại', 'value': 100}], 'npl': []})


if __name__ == '__main__':
    unittest.main()
