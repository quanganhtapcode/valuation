import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch
import unittest

from scripts.fetchers.fetch_vci_screener import ensure_schema, upsert_items, sync_financial_metrics


class ScreenerQuoteRefresh(unittest.TestCase):
    def test_price_refresh_preserves_unavailable_enrichment(self):
        with sqlite3.connect(':memory:') as conn:
            conn.row_factory = sqlite3.Row
            ensure_schema(conn)
            old = {'ticker': 'PNJ', 'exchange': 'HSX', 'marketPrice': 26600,
                   'refPrice': 28600, 'matchPriceTime': '2026-09-30T08:00:00',
                   'ttmPe': 15, 'ttmPb': 2, 'netMargin': 0.1,
                   'viSector': 'Bán lẻ', 'marketCap': 1000000}
            upsert_items(conn, [old], '2026-10-01T00:00:00+00:00')
            fresh = {'ticker': 'PNJ', 'exchange': 'HSX', 'marketPrice': 30600,
                     'refPrice': 30000, 'matchPriceTime': '2026-10-16T08:00:00',
                     'ttmPe': None, 'viSector': ''}
            upsert_items(conn, [fresh], '2026-10-16T08:01:00+00:00')
            row = conn.execute("SELECT * FROM screening_data WHERE ticker='PNJ'").fetchone()
            self.assertEqual((row['marketPrice'], row['refPrice']), (30600, 30000))
            self.assertEqual(row['matchPriceTime'][:10], '2026-10-16')
            self.assertEqual((row['ttmPe'], row['ttmPb'], row['netMargin']), (15, 2, 0.1))
            self.assertEqual((row['viSector'], row['marketCap']), ('Bán lẻ', 1000000))
            upsert_items(conn, [{**fresh, 'ttmPe': 12, 'ttmPb': 0}], '2026-10-16T08:02:00+00:00')
            row = conn.execute("SELECT ttmPe,ttmPb FROM screening_data WHERE ticker='PNJ'").fetchone()
            self.assertEqual(tuple(row), (12, 0))

    def test_new_quote_cannot_inherit_old_reference(self):
        with sqlite3.connect(':memory:') as conn:
            ensure_schema(conn)
            upsert_items(conn, [{'ticker': 'PNJ', 'marketPrice': 26600, 'refPrice': 28600}], 'old')
            upsert_items(conn, [{'ticker': 'PNJ', 'marketPrice': 30600}], 'new')
            self.assertIsNone(conn.execute("SELECT refPrice FROM screening_data WHERE ticker='PNJ'").fetchone()[0])

    def test_financial_sync_fills_missing_values_without_erasing_known_metrics(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / 'vci_screening.sqlite'
            stats = Path(directory) / 'vci_stats_financial.sqlite'
            with sqlite3.connect(stats) as conn:
                conn.execute('CREATE TABLE stats_financial (ticker,pe,pb,roe,after_tax_margin,gross_margin)')
                conn.executemany('INSERT INTO stats_financial VALUES (?,?,?,?,?,?)',
                                 [('PNJ', 9, 1, 0.1, 0.2, 0.3), ('FPT', 12, 2, 0.2, 0.3, 0.4)])
            with sqlite3.connect(db) as conn:
                ensure_schema(conn)
                upsert_items(conn, [{'ticker': 'PNJ', 'ttmPe': 15}, {'ticker': 'FPT'},
                                    {'ticker': 'AAA', 'ttmPb': 3}], 'now')
            with patch('os.path.exists', side_effect=lambda value: Path(value) == stats):
                sync_financial_metrics(str(db))
            with sqlite3.connect(db) as conn:
                rows = dict(conn.execute('SELECT ticker,ttmPe FROM screening_data'))
                self.assertEqual(rows['PNJ'], 15)
                self.assertEqual(rows['FPT'], 12)
                self.assertEqual(conn.execute("SELECT ttmPb FROM screening_data WHERE ticker='AAA'").fetchone()[0], 3)


if __name__ == '__main__':
    unittest.main()
