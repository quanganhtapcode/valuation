import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask
from backend.routes import download_routes as exports
from scripts.fetchers.fetch_vci_stats_financial import ensure_schema


class BankMetricExportTests(unittest.TestCase):
    def test_bank_columns_and_values_follow_catalog_for_both_datasets(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'metrics.sqlite'
            with sqlite3.connect(path) as conn:
                ensure_schema(conn)
                fields = sorted(exports.BANK_ONLY_METRICS)
                for ticker, value in [('FPT',0),('VCB',.15)]:
                    conn.execute('INSERT INTO stats_financial(ticker,fetched_at) VALUES (?,?)',(ticker,'test'))
                    conn.execute('INSERT INTO stats_financial_history(ticker,year_report,quarter_report,fetched_at) VALUES (?,2024,5,?)',(ticker,'test'))
                    for table in ['stats_financial','stats_financial_history']:
                        available = {r[1] for r in conn.execute(f'PRAGMA table_info({table})')}
                        for field in fields:
                            if field in available:
                                conn.execute(f'UPDATE {table} SET {field}=? WHERE ticker=?',(value,ticker))
            app = Flask(__name__)
            with patch.object(exports,'resolve_vci_stats_financial_db_path',return_value=str(path)), app.test_request_context('/?from_year=2024&to_year=2024&period_kind=year'):
                for read in [exports._stats_financial_rows,exports._stats_financial_history_rows]:
                    fields, _ = read(['FPT'])
                    self.assertFalse(exports.BANK_ONLY_METRICS.intersection(fields))
                    fields, rows = read(['FPT','VCB'])
                    metrics = exports.BANK_ONLY_METRICS.intersection(fields)
                    self.assertTrue(metrics)
                    nonbank = next(r for r in rows if r['ticker']=='FPT')
                    bank = next(r for r in rows if r['ticker']=='VCB')
                    self.assertTrue(all(nonbank[f] is None for f in metrics))
                    self.assertTrue(all(bank[f]==.15 for f in metrics))
                    fields, rows = read(['VCB'])
                    self.assertIn('net_interest_margin',fields)
                    self.assertEqual(rows[0]['net_interest_margin'],.15)


if __name__ == '__main__':
    unittest.main()
