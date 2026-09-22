"""Upstream failures must not look like successful or up-to-date ingestion."""
import json
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

    def test_valid_old_candle_is_up_to_date(self):
        with patch.object(VCIClient, 'fetch_price_history', return_value=page([candle('2026-09-18')])):
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

    def test_run_records_partial_status_and_subset_scope(self):
        with patch.object(VCIClient, 'fetch_price_history', return_value=None), patch.object(price.time, 'sleep'):
            stats = self.updater.run(['FPT'])
        self.assertEqual(stats['failed'], 1)
        health = _check_ingestion(self.path, finished_key='last_run_finished', max_age_minutes=60)
        self.assertEqual((health['status'], health['run_status'], health['scope']), ('warn', 'partial', 'subset'))


class NewsTests(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
