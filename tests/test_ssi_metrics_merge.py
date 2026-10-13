"""SSI backfill protects VCI values and survives subsequent VCI refreshes."""
import sqlite3
import tempfile
import unittest
from pathlib import Path

from scripts.fetchers.fetch_vci_stats_financial import ensure_schema, upsert_history_rows
from scripts.financials.merge_ssi_metrics import merge


class SSIMetricsMergeTests(unittest.TestCase):
    def test_merge_refresh_idempotence_and_period_specific_mapping(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'ssi.sqlite'
            with sqlite3.connect(source) as s:
                s.execute('CREATE TABLE metadata(key TEXT,value TEXT)')
                s.executemany('INSERT INTO metadata VALUES (?,?)', [
                    ('endpoint', 'https://fiin-fundamental.ssi.com.vn/FinancialAnalysis/GetFinancialRatioV2'),
                    ('download_date', '2026-10-11')])
                for table in ('annual', 'quarterly'):
                    s.execute(f'CREATE TABLE {table}(symbol TEXT,yearReport INTEGER,lengthReport INTEGER,timeline TEXT,ryq12 REAL,ryq25 REAL)')
                s.execute("INSERT INTO annual VALUES ('AAA',2007,5,'2007_5',.2,.3)")
                s.execute("INSERT INTO quarterly VALUES ('AAA',2018,1,'2018_1',.4,.8)")
            c = sqlite3.connect(':memory:')
            ensure_schema(c)
            upsert_history_rows(c, 'AAA', [{'yearReport': 2018, 'quarter': 1, 'pe': 12}], 'vci')
            c.commit()
            mapping = {'approved': {'annual': {'roe': {'field': 'ryq12', 'scale': 1}, 'gross_margin': {'field': 'ryq25', 'scale': 1}}, 'quarterly': {'roe': {'field': 'ryq12', 'scale': 1}}}}
            result = merge(c, source, mapping)
            self.assertEqual(result['inserted_periods'], 1)
            self.assertEqual(result['filled_cells'], 1)
            self.assertEqual(c.execute('SELECT pe,roe,gross_margin FROM stats_financial_history WHERE year_report=2018').fetchone(), (12, .4, None))
            self.assertEqual(merge(c, source, mapping)['inserted_periods'], 0)
            self.assertEqual(merge(c, source, mapping)['filled_cells'], 0)
            upsert_history_rows(c, 'AAA', [{'yearReport': 2018, 'quarter': 1, 'pe': 15}], 'vci-new')
            self.assertEqual(c.execute('SELECT pe,roe FROM stats_financial_history WHERE year_report=2018').fetchone(), (15, .4))
            self.assertEqual(c.execute("SELECT data_source FROM stock_metrics_provenance WHERE year_report=2018 AND field='roe'").fetchone(), ('SSI',))
            upsert_history_rows(c, 'AAA', [{'yearReport': 2018, 'quarter': 1, 'roe': .6}], 'vci-new')
            self.assertEqual(c.execute('SELECT roe FROM stats_financial_history WHERE year_report=2018').fetchone(), (.6,))
            self.assertIsNone(c.execute("SELECT 1 FROM stock_metrics_provenance WHERE year_report=2018 AND field='roe'").fetchone())
            self.assertEqual(c.execute('SELECT roe,gross_margin FROM stats_financial_history WHERE year_report=2007').fetchone(), (.2, .3))
            c.close()


if __name__ == '__main__':
    unittest.main()
