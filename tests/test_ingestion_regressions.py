"""Upstream failures must not look like successful or up-to-date ingestion."""
import json
import os
import shlex
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import Mock, patch

from backend.data_sources.vci import VCIClient
from backend.updater import batch_news, update_price_history as price
from backend.routes.health_routes import _check_ingestion
from scripts.fetchers import fetch_vci_financial_statement as financial
from scripts.fetchers import fetch_vci_stats_financial as stats_financial
from scripts.fetchers import fetch_vci_index_history as index_history


def candle(day):
    return {'tradingDate': day, 'open': 10, 'high': 12, 'low': 9, 'close': 11, 'volume': 100}


def page(rows):
    return {'successful': True, 'status': 200, 'data': {'content': rows}}


class PriceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'price.sqlite'
        with patch.object(price, 'resolve_price_history_db_path', return_value=str(self.path)):
            self.updater = price.PriceHistoryUpdater(retries=1, delay=0, recent_page_size=2, pages_per_symbol=2)
        self.updater.insert_price_records('FPT', [candle('2026-09-18')])

    def test_error_envelope_is_retried_not_up_to_date(self):
        with patch.object(VCIClient, 'fetch_price_history', return_value={'successful': False, 'data': {'content': []}}) as fetch, patch.object(price.time, 'sleep'):
            result = self.updater.fetch_and_store_symbol('FPT')
        self.assertFalse(result['success'])
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(self.updater.get_latest_date('FPT'), '2026-09-18')

    def test_retry_recovers_and_commits_new_record(self):
        with patch.object(VCIClient, 'fetch_price_history', side_effect=[None, page([candle('2026-09-21')])]), patch.object(price.time, 'sleep'):
            result = self.updater.fetch_and_store_symbol('FPT')
        self.assertTrue(result['success'])
        self.assertEqual(result['inserted'], 1)
        self.assertEqual(self.updater.get_latest_date('FPT'), '2026-09-21')

    def test_empty_page_cannot_confirm_existing_history_freshness(self):
        with patch.object(VCIClient, 'fetch_price_history', return_value=page([])):
            self.assertFalse(self.updater.fetch_and_store_symbol('FPT')['success'])

    def test_latest_candle_is_refreshed_after_intraday_update(self):
        updated = {**candle('2026-09-18'), 'close': 12, 'volume': 200}
        with patch.object(VCIClient, 'fetch_price_history', return_value=page([updated])):
            result = self.updater.fetch_and_store_symbol('FPT')
        self.assertTrue(result['success'])
        self.assertEqual(result['inserted'], 1)
        with closing(sqlite3.connect(self.path)) as conn:
            self.assertEqual(conn.execute("SELECT close, volume FROM stock_price_history WHERE symbol='FPT'").fetchone(), (12, 200))

    def test_older_candle_is_up_to_date(self):
        with patch.object(VCIClient, 'fetch_price_history', return_value=page([candle('2026-09-17')])):
            self.assertTrue(self.updater.fetch_and_store_symbol('FPT')['up_to_date'])

    def test_later_page_failure_does_not_commit_incomplete_backfill(self):
        self.updater.incremental = False
        with patch.object(VCIClient, 'fetch_price_history', side_effect=[page([candle('2026-09-21'), candle('2026-09-20')]), None, None]), patch.object(price.time, 'sleep'):
            self.assertFalse(self.updater.fetch_and_store_symbol('FPT')['success'])
        self.assertEqual(self.updater.get_latest_date('FPT'), '2026-09-18')

    def test_write_failure_rolls_back_and_is_not_reported_as_inserted(self):
        with closing(sqlite3.connect(self.path)) as conn:
            conn.execute("CREATE TRIGGER fail_price BEFORE INSERT ON stock_price_history WHEN NEW.time='2026-09-22' BEGIN SELECT RAISE(ABORT,'test failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.updater.insert_price_records('FPT', [candle('2026-09-21'), candle('2026-09-22')])
        self.assertEqual(self.updater.get_latest_date('FPT'), '2026-09-18')

    def test_invalid_later_candle_does_not_commit_earlier_candle(self):
        with self.assertRaises(ValueError):
            self.updater.insert_price_records('FPT', [candle('2026-09-21'),
                {**candle('2026-09-22'), 'close': 0}])
        self.assertEqual(self.updater.get_latest_date('FPT'), '2026-09-18')

    def test_zero_volume_is_preserved_and_unchanged_candle_is_not_rewritten(self):
        with closing(sqlite3.connect(self.path)) as conn:
            conn.execute("CREATE TRIGGER unchanged BEFORE UPDATE ON stock_price_history BEGIN SELECT RAISE(ABORT,'redundant update'); END")
        self.assertEqual(self.updater.insert_price_records('FPT', [candle('2026-09-18')]), 1)
        self.updater.insert_price_records('FPT', [{**candle('2026-09-21'), 'totalVolume': 0}])
        with closing(sqlite3.connect(self.path)) as conn:
            self.assertEqual(conn.execute("SELECT volume FROM stock_price_history WHERE time='2026-09-21'").fetchone()[0], 0)

    def test_request_delay_applies_across_symbols(self):
        self.updater.delay = 1.2
        with patch.object(price.time, 'monotonic', return_value=10), patch.object(price.time, 'sleep') as sleep, patch.object(VCIClient, 'fetch_price_history', return_value=page([candle('2026-09-18')])):
            self.assertTrue(self.updater.fetch_and_store_symbol('FPT')['success'])
            self.assertTrue(self.updater.fetch_and_store_symbol('VCB')['success'])
        self.assertAlmostEqual(sleep.call_args.args[0], 1.2)

    def test_run_records_partial_status_and_subset_scope(self):
        with patch.object(VCIClient, 'fetch_price_history', return_value=None), patch.object(price.time, 'sleep'):
            stats = self.updater.run(['FPT'])
        self.assertEqual(stats['failed'], 1)
        health = _check_ingestion(self.path, finished_key='last_run_finished', max_age_minutes=60)
        self.assertEqual((health['status'], health['run_status'], health['scope']), ('warn', 'partial', 'subset'))


class IndexHistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'index.sqlite'
        with closing(sqlite3.connect(self.path)) as conn:
            index_history.ensure_schema(conn)
            index_history.upsert_items(conn, index_code='VNINDEX', items=[
                {'tradingDate': '2026-09-18', 'indexValue': 100},
                {'tradingDate': '2026-09-10', 'indexValue': 90},
            ], fetched_at='old')

    def run_fetch(self):
        index_history.fetch_pages_to_sqlite(index_code='VNINDEX', start_page=0, end_page=45,
            size=3, db_path=str(self.path), device_id='test', timeout_s=1, retries=0,
            backoff_base_s=0, workers=10, sleep_between_pages_s=0, incremental=True)

    def test_overlap_refreshes_existing_candle_and_stops_before_old_pages(self):
        response = page([{'tradingDate': '2026-09-21', 'indexValue': 110},
                         {'tradingDate': '2026-09-18', 'indexValue': 105},
                         {'tradingDate': '2026-09-11', 'indexValue': 95}])
        with patch.object(index_history, 'request_json', return_value=response) as fetch:
            self.run_fetch()
        self.assertEqual(fetch.call_count, 1)
        with closing(sqlite3.connect(self.path)) as conn:
            self.assertEqual(conn.execute('SELECT tradingDate,indexValue FROM market_index_history ORDER BY tradingDate').fetchall(),
                [('2026-09-10', 90), ('2026-09-11', 95), ('2026-09-18', 105), ('2026-09-21', 110)])

    def test_gap_fetches_more_than_one_page_until_overlap(self):
        first = page([{'tradingDate': day, 'indexValue': 110}
                      for day in ['2026-09-24', '2026-09-23', '2026-09-22']])
        second = page([{'tradingDate': day, 'indexValue': 100}
                       for day in ['2026-09-18', '2026-09-11', '2026-09-10']])
        with patch.object(index_history, 'request_json', side_effect=[first, second]) as fetch:
            self.run_fetch()
        self.assertEqual(fetch.call_count, 2)

    def test_empty_database_bootstraps_until_short_page(self):
        with closing(sqlite3.connect(self.path)) as conn:
            conn.execute('DELETE FROM market_index_history')
            conn.commit()
        response = page([{'tradingDate': '2026-09-21', 'indexValue': 110}])
        with patch.object(index_history, 'request_json', return_value=response) as fetch:
            self.run_fetch()
        self.assertEqual(fetch.call_count, 1)
        with closing(sqlite3.connect(self.path)) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM market_index_history').fetchone()[0], 1)

    def test_unsorted_page_is_rejected_before_price_writes(self):
        response = page([{'tradingDate': '2026-09-18', 'indexValue': 105},
                         {'tradingDate': '2026-09-21', 'indexValue': 110}])
        with patch.object(index_history, 'request_json', return_value=response):
            with self.assertRaisesRegex(ValueError, 'newest-first'):
                self.run_fetch()
        with closing(sqlite3.connect(self.path)) as conn:
            self.assertEqual(conn.execute('SELECT MAX(tradingDate) FROM market_index_history').fetchone()[0], '2026-09-18')

    def test_application_failure_does_not_look_like_empty_success(self):
        with patch.object(index_history, 'request_json', return_value={'status': 200, 'successful': False, 'data': {'content': []}}):
            with self.assertRaises(RuntimeError):
                self.run_fetch()

    def test_page_limit_cannot_silently_leave_a_gap(self):
        response = page([{'tradingDate': day, 'indexValue': 110}
                         for day in ['2026-09-24', '2026-09-23', '2026-09-22']])
        with patch.object(index_history, 'request_json', return_value=response):
            with self.assertRaisesRegex(ValueError, 'page limit'):
                index_history.fetch_pages_to_sqlite(index_code='VNINDEX', start_page=0, end_page=0,
                    size=3, db_path=str(self.path), device_id='test', timeout_s=1, retries=0,
                    backoff_base_s=0, workers=1, sleep_between_pages_s=0, incremental=True)
        with closing(sqlite3.connect(self.path)) as conn:
            self.assertEqual(conn.execute('SELECT MAX(tradingDate) FROM market_index_history').fetchone()[0], '2026-09-18')


class NewsTests(unittest.TestCase):
    def test_worker_reuses_http_session_and_closes_it(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'news.sqlite'
            with closing(sqlite3.connect(Path(directory) / 'vci_screening.sqlite')) as conn:
                conn.executescript("CREATE TABLE screening_data(ticker); INSERT INTO screening_data VALUES ('FPT'),('VCB');")
            response = Mock()
            response.json.return_value = {'successful': True, 'data': {'content': []}}
            session = Mock()
            session.get.return_value = response
            session.__enter__ = Mock(return_value=session)
            session.__exit__ = Mock(return_value=False)
            with patch.object(batch_news, '_db_path', return_value=str(path)), patch.object(batch_news.requests, 'Session', return_value=session) as factory:
                self.assertEqual(batch_news.run(workers=1), 0)
            factory.assert_called_once_with()
            self.assertEqual(session.get.call_count, 10)
            session.__exit__.assert_called_once()

    def test_breaker_does_not_start_queued_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'news.sqlite'
            with closing(sqlite3.connect(Path(directory) / 'vci_screening.sqlite')) as conn:
                conn.executescript("CREATE TABLE screening_data(ticker); INSERT INTO screening_data VALUES ('FPT'),('VCB');")
            with patch.object(batch_news, '_db_path', return_value=str(path)), patch.object(batch_news, '_work', return_value=('FPT', 'news', 0, 'timeout', [])) as work:
                self.assertEqual(batch_news.run(workers=1, max_consecutive_errors=1), 75)
            self.assertEqual(work.call_count, 1)

    def test_budget_and_failure_streak_leave_unprocessed_work_visible(self):
        for timed_out in [False, True]:
            with self.subTest(timed_out=timed_out), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'news.sqlite'
                with closing(sqlite3.connect(Path(directory) / 'vci_screening.sqlite')) as conn:
                    conn.executescript("CREATE TABLE screening_data(ticker); INSERT INTO screening_data VALUES ('FPT');")
                with patch.object(batch_news, '_db_path', return_value=str(path)), patch.object(batch_news, '_work', return_value=('FPT', 'news', 0, 'timeout', [])), patch.object(batch_news.time, 'monotonic', side_effect=[0] + [10 if timed_out else 0] * 20):
                    self.assertEqual(batch_news.run(workers=1, max_runtime=1, max_consecutive_errors=1), 75)
                with closing(sqlite3.connect(path)) as conn:
                    meta = dict(conn.execute('SELECT k,v FROM meta'))
                self.assertEqual(meta['last_run_status'], 'partial')
                self.assertEqual(meta['last_run_reason'], 'time_budget' if timed_out else 'consecutive_errors')
                self.assertEqual(int(meta['last_run_unprocessed']), 5 if timed_out else 4)
                self.assertEqual(int(meta['last_run_failed']), 0 if timed_out else 1)

    def test_transient_failure_retries(self):
        with patch.object(batch_news, '_fetch_tab', side_effect=[TimeoutError('timeout'), []]) as fetch, patch.object(batch_news.time, 'sleep'):
            result = batch_news._work('FPT', 'news', retries=1)
        self.assertIsNone(result[3])
        self.assertEqual(fetch.call_count, 2)

    def test_failed_application_envelope_is_not_empty_success(self):
        response = Mock()
        response.json.return_value = {'successful': False, 'data': {'content': []}}
        with patch.object(batch_news.requests, 'get', return_value=response):
            with self.assertRaises(ValueError):
                batch_news._fetch_tab('FPT', 'news')

    def test_partial_run_preserves_old_snapshot_and_retry_skips_successes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'news.sqlite'
            with closing(sqlite3.connect(Path(directory) / 'vci_screening.sqlite')) as conn:
                conn.executescript("CREATE TABLE screening_data(ticker); INSERT INTO screening_data VALUES ('FPT');")
            with closing(sqlite3.connect(path)) as conn:
                batch_news._init_db(conn)
                batch_news._store_result(conn, 'FPT', 'news', [{'id': 'old'}])
                conn.execute("UPDATE fetch_meta SET last_fetched='2020-01-01'")
                conn.commit()
            def work(symbol, tab, retries):
                return (symbol, tab, 0, 'timeout' if tab == 'news' else None, [])
            with patch.object(batch_news, '_db_path', return_value=str(path)), patch.object(batch_news, '_work', side_effect=work):
                self.assertEqual(batch_news.run(incremental=True, retries=0), 75)
            with closing(sqlite3.connect(path)) as conn:
                self.assertEqual(conn.execute("SELECT last_fetched FROM fetch_meta WHERE tab='news'").fetchone()[0], '2020-01-01')
                self.assertEqual(conn.execute('SELECT COUNT(*) FROM items').fetchone()[0], 1)
            with patch.object(batch_news, '_db_path', return_value=str(path)), patch.object(batch_news, '_work', return_value=('FPT', 'news', 0, None, [])) as retry:
                self.assertEqual(batch_news.run(incremental=True, retries=0), 0)
                retry.assert_called_once_with('FPT', 'news', 0)


class StatsFinancialTests(unittest.TestCase):
    def test_symbol_write_failure_rolls_back_and_incremental_retry_skips_success(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'stats.sqlite'
            argv = ['fetch', '--db', str(path), '--symbols', 'FPT,BAD', '--workers', '1', '--incremental']
            data = [{'yearReport': 2025, 'quarter': 4, 'pe': 10}]
            original = stats_financial.upsert_history_rows
            def write_history(conn, symbol, rows, fetched_at):
                if symbol == 'BAD':
                    raise ValueError('bad history')
                return original(conn, symbol, rows, fetched_at)
            with patch.object(sys, 'argv', argv), patch.object(stats_financial, '_fetch_symbol', return_value=data), patch.object(stats_financial, 'upsert_history_rows', side_effect=write_history):
                self.assertEqual(stats_financial.main(), 75)
            with closing(sqlite3.connect(path)) as conn:
                self.assertEqual(conn.execute('SELECT ticker FROM stats_financial').fetchall(), [('FPT',)])
                self.assertEqual(dict(conn.execute('SELECT k,v FROM meta'))['last_run_failed'], '1')
            with patch.object(sys, 'argv', argv), patch.object(stats_financial, '_fetch_symbol', return_value=data) as fetch:
                self.assertEqual(stats_financial.main(), 0)
                self.assertEqual(fetch.call_count, 1)
                self.assertEqual(fetch.call_args.args[1], 'BAD')

    def test_fetch_does_not_hold_writer_lock_between_batches(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'stats.sqlite'
            argv = ['fetch', '--db', str(path), '--symbols', 'FPT,VCB', '--workers', '1', '--batch-commit', '2']
            def fetch(*args, **kwargs):
                with closing(sqlite3.connect(path, timeout=0)) as writer:
                    writer.execute('BEGIN IMMEDIATE')
                    writer.rollback()
                return [{'yearReport': 2025, 'quarter': 4, 'pe': 10}]
            with patch.object(sys, 'argv', argv), patch.object(stats_financial, '_fetch_symbol', side_effect=fetch):
                self.assertEqual(stats_financial.main(), 0)


class FinancialTests(unittest.TestCase):
    def test_latest_error_is_retried_despite_older_success(self):
        with closing(sqlite3.connect(':memory:')) as conn:
            conn.executescript("""
                CREATE TABLE fetch_log(ticker, status, fetched_at);
                INSERT INTO fetch_log VALUES ('FPT','ok','2026-09-20'),('FPT','error','2026-09-21'),
                    ('VCB','error','2026-09-20'),('VCB','ok','2026-09-21');
            """)
            self.assertEqual(financial._latest_successful_symbols(conn), {'VCB'})

    def test_exhausted_budget_does_not_start_network_request(self):
        opener = Mock()
        with patch.object(financial, 'REQUEST_DEADLINE', 1), patch.object(financial.time, 'monotonic', return_value=2):
            with self.assertRaisesRegex(TimeoutError, 'time budget'):
                financial._request_json(opener, 'https://example.invalid')
        opener.open.assert_not_called()

    def test_main_stops_after_repeated_failures(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / 'financials.sqlite'
            metrics = {section: [{'field': 'isa20'}] for section in financial.SECTIONS}
            argv = ['fetch', '--db-path', str(db), '--out-dir', directory,
                    '--symbols', ','.join(f'BAD{i}' for i in range(20)), '--mapping-symbols', 'FPT',
                    '--keep-normalized-values', '--workers', '1', '--max-consecutive-errors', '2']
            with patch.object(sys, 'argv', argv), patch.object(financial, '_fetch_metrics', return_value=metrics), patch.object(financial, '_fetch_symbol_all_sections', side_effect=TimeoutError('upstream failed')):
                self.assertEqual(financial.main(), 75)
            with closing(sqlite3.connect(db)) as conn:
                meta = dict(conn.execute('SELECT k,v FROM meta'))
            self.assertEqual(meta['last_run_failed'], '2')
            self.assertEqual(meta['last_run_unprocessed'], '18')
            self.assertEqual(meta['last_run_reason'], 'consecutive_errors')

    def test_missing_period_shape_is_not_success(self):
        for data in [None, {}, {'years': [], 'quarters': 'bad'}]:
            with patch.object(financial, '_request_json', return_value={'data': data}):
                with self.assertRaises(ValueError):
                    financial._fetch_section(Mock(), 'FPT', 'INCOME_STATEMENT')

    def test_real_writer_main_keeps_success_and_reports_partial(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / 'financials.sqlite'
            metrics = {section: [{'field': 'isa20'}] for section in financial.SECTIONS}
            def fetch(symbol):
                if symbol == 'BAD':
                    raise TimeoutError('upstream failed')
                return {section: {'years': [{'yearReport': 2025, 'isa20': 100}], 'quarters': []}
                        for section in financial.SECTIONS}
            argv = ['fetch', '--db-path', str(db), '--out-dir', directory,
                    '--symbols', 'FPT,BAD', '--mapping-symbols', 'FPT', '--keep-normalized-values']
            with patch.object(sys, 'argv', argv), patch.object(financial, '_fetch_metrics', return_value=metrics), patch.object(financial, '_fetch_symbol_all_sections', side_effect=fetch):
                self.assertEqual(financial.main(), 75)
            with closing(sqlite3.connect(db)) as conn:
                self.assertEqual(conn.execute("SELECT isa20 FROM income_statement WHERE ticker='FPT'").fetchone()[0], 100)
                meta = dict(conn.execute('SELECT k,v FROM meta'))
                self.assertEqual(meta['last_run_status'], 'partial')
                self.assertEqual(meta['last_run_failed'], '1')

    def test_workers_do_not_hold_global_lock_during_network_io(self):
        import threading
        from concurrent.futures import ThreadPoolExecutor
        barrier = threading.Barrier(2)
        response = Mock()
        response.read.return_value = b'{"data": {}}'
        response.headers = {}
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        opener = Mock()
        def open_response(*args, **kwargs):
            barrier.wait(timeout=2)
            return response
        opener.open.side_effect = open_response
        with patch.object(financial, 'REQUEST_DELAY_S', 0), ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(financial._request_json, opener, 'https://example.invalid', retries=0) for _ in range(2)]
            self.assertEqual([f.result() for f in futures], [{'data': {}}, {'data': {}}])

    def test_configured_retry_count_is_honored(self):
        opener = Mock()
        opener.open.side_effect = TimeoutError('test timeout')
        with patch.object(financial, 'REQUEST_RETRIES', 1), patch.object(financial.time, 'sleep'):
            with self.assertRaises(TimeoutError):
                financial._request_json(opener, 'https://example.invalid')
        self.assertEqual(opener.open.call_count, 2)
        self.assertEqual(opener.open.call_args.kwargs['timeout'], financial.REQUEST_TIMEOUT_S)


class SafeRunTests(unittest.TestCase):
    def test_missing_database_does_not_restore_stale_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            db = root / 'vci_price_history.sqlite'
            backups = root / 'backups'
            backups.mkdir()
            stale = backups / (db.name + '.last_good.bak')
            with closing(sqlite3.connect(stale)) as conn:
                conn.execute('CREATE TABLE stale_data(value)')
            result = subprocess.run(['bash', 'automation/vci_safe_run.sh', '--name', 'test', '--db', str(db),
                '--backup-dir', str(backups), '--command', 'exit 1', '--retries', '1', '--retry-sleep', '0'],
                capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertFalse(db.exists())

    def run_case(self, body, retries=0):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        db = root / 'vci_price_history.sqlite'
        with closing(sqlite3.connect(db)) as conn:
            conn.executescript('CREATE TABLE stock_price_history(symbol,close); INSERT INTO stock_price_history VALUES ("OLD",10);')
        script = root / 'writer.py'
        script.write_text('import sqlite3,sys\nfrom pathlib import Path\nc=sqlite3.connect(sys.argv[1])\n' + body)
        command = shlex.join([sys.executable, str(script), str(db)])
        result = subprocess.run(['bash', 'automation/vci_safe_run.sh', '--name', 'test', '--db', str(db), '--backup-dir', str(root / 'backups'), '--command', command, '--retries', str(retries), '--retry-sleep', '0'], capture_output=True, text=True, timeout=20)
        with closing(sqlite3.connect(db)) as conn:
            rows = conn.execute('SELECT symbol FROM stock_price_history ORDER BY symbol').fetchall()
        return result, rows

    def test_partial_run_preserves_successful_rows_but_exits_nonzero(self):
        result, rows = self.run_case("c.execute('INSERT INTO stock_price_history VALUES (\"NEW\",11)')\nc.commit()\nsys.exit(75)\n")
        self.assertEqual(result.returncode, 75, result.stdout + result.stderr)
        self.assertEqual(rows, [('NEW',), ('OLD',)])
        self.assertNotIn('health check passed', result.stdout)

    def test_partial_retry_does_not_restore_and_lose_progress(self):
        result, rows = self.run_case("n=c.execute('SELECT COUNT(*) FROM stock_price_history').fetchone()[0]\nc.execute('INSERT INTO stock_price_history VALUES (?,11)',(str(n),))\nc.commit()\nsys.exit(75 if n==1 else 0)\n", retries=1)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(rows, [('1',), ('2',), ('OLD',)])

    def test_partial_cannot_bypass_row_loss_protection(self):
        result, rows = self.run_case("c.execute('DELETE FROM stock_price_history')\nc.commit()\nsys.exit(75)\n")
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertEqual(rows, [('OLD',)])

    def test_fatal_failure_still_restores_snapshot(self):
        result, rows = self.run_case("c.execute('DELETE FROM stock_price_history')\nc.commit()\nsys.exit(1)\n")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual(rows, [('OLD',)])


class CronInstallerTests(unittest.TestCase):
    def test_dry_run_preserves_unrelated_jobs_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'
            unrelated = '0 2 * * * /var/www/store/scripts/backup-store.sh'
            source.write_text(unrelated + '\n0 18 * * * python scripts/fetchers/fetch_vci_financial_statement.py\n')
            crontab = root / 'crontab'
            crontab.write_text('#!/bin/sh\n[ "$1" = "-l" ] || exit 99\ncat "$TEST_CRONTAB_SOURCE"\n')
            crontab.chmod(0o755)
            env = {**os.environ, 'PATH': f'{root}:{os.environ["PATH"]}',
                   'TEST_CRONTAB_SOURCE': str(source), 'VCI_BACKUP_REMOTE': ''}
            def render():
                result = subprocess.run(['bash', 'automation/setup_cron_vps.sh', '--dry-run'],
                    env=env, capture_output=True, text=True, check=True)
                return result.stdout
            first = render()
            source.write_text(first)
            self.assertEqual(render(), first)
            lines = first.splitlines()
            self.assertEqual(lines[0], unrelated)
            # Includes the daily Vietnam economic history job added alongside
            # the existing Yahoo macro history refresh.
            self.assertEqual(len(lines), 18)
            self.assertEqual(sum('--name\\ vietnam_macro' in line for line in lines), 1)
            for line in lines[1:]:
                argv = shlex.split(line.split(maxsplit=5)[5])
                self.assertEqual(argv[:5], ['systemd-run', '--scope', '--quiet', '--collect', '--slice=valuation.slice'])
                self.assertEqual(argv[5:7], ['/bin/bash', '-lc'])
                self.assertEqual(len(argv), 8)
            stats = next(line for line in lines if '--name\\ stats_financial' in line)
            body = shlex.split(stats.split(maxsplit=5)[5])[-1]
            self.assertTrue(body.startswith('cd /var/www/valuation && bash automation/vci_safe_run.sh'))
            self.assertIn('--incremental', body)


if __name__ == '__main__':
    unittest.main()
