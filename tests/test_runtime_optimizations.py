"""Regression coverage for latency isolation and ingestion continuation."""
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import telemetry
from backend.updater import batch_news
from scripts.fetchers import fetch_vci_financial_statement as financial


class RuntimeOptimizationsTests(unittest.TestCase):
    def test_http_percentiles_ignore_websocket_lifetimes(self):
        with patch.object(telemetry, '_ROUTE_LATENCY', {}):
            telemetry.record_request_latency('GET /ws/market/prices', 3600000)
            telemetry.record_request_latency('GET /api/stock/FPT', 25)
            metrics = telemetry.get_latency_metrics()
            self.assertEqual(metrics['summary']['sample_count'], 1)
            self.assertEqual(metrics['summary']['p99_ms'], 25)

    def test_resume_refreshes_aged_data_and_retries_latest_error(self):
        with sqlite3.connect(':memory:') as conn:
            conn.executescript("""CREATE TABLE fetch_log(ticker,status,fetched_at);
                INSERT INTO fetch_log VALUES ('AAA','ok','2026-10-25'),
                    ('BBB','ok','2026-10-01'),('CCC','ok','2026-10-24'),
                    ('CCC','error','2026-10-25');""")
            self.assertEqual(financial._latest_successful_symbols(conn, '2026-10-20'), {'AAA'})

    def test_failed_news_requests_do_not_starve_following_tasks(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'news.sqlite'
            with sqlite3.connect(Path(directory) / 'vci_screening.sqlite') as conn:
                conn.executescript("CREATE TABLE screening_data(ticker); INSERT INTO screening_data VALUES ('AAA'),('BBB');")
            attempted = []

            def failure(symbol, tab, retries):
                attempted.append((symbol, tab))
                return symbol, tab, 0, 'timeout', []

            with patch.object(batch_news, '_db_path', return_value=str(path)), patch.object(batch_news, '_work', side_effect=failure):
                for _ in range(2):
                    self.assertEqual(batch_news.run(incremental=True, workers=1, max_consecutive_errors=1), 75)
            self.assertNotEqual(attempted[0], attempted[1])
            with sqlite3.connect(path) as conn:
                self.assertEqual(conn.execute('SELECT COUNT(*) FROM fetch_meta').fetchone()[0], 0)
