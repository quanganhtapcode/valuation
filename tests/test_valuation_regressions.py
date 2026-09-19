"""Offline regression checks for statement inputs and valuation consistency."""
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import vci_financial_adapter as adapter
from backend.services import valuation_service as service
from backend.services import beta_calculator as beta


class StatementTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = str(Path(self.directory.name) / 'statements.sqlite')
        self.conn = sqlite3.connect(self.path)
        self.conn.executescript('''
            CREATE TABLE income_statement (
                ticker TEXT, period_kind TEXT, year_report INT, quarter_report INT,
                isa20 REAL, isa22 REAL, isa8 REAL, isa23 REAL);
            CREATE TABLE cash_flow (
                ticker TEXT, period_kind TEXT, year_report INT, quarter_report INT,
                cfa2 REAL, cfa18 REAL, cfa19 REAL, cfa20 REAL, cfa29 REAL, cfa30 REAL);
        ''')
        for year, quarter, eps in [(2026, 2, 308), (2026, 1, 217),
                                   (2025, 4, -81), (2025, 3, 36)]:
            self.conn.execute('INSERT INTO income_statement VALUES (?,?,?,?,?,?,?,?)',
                              ('AAA', 'QUARTER', year, quarter, 120, -10, 5, eps))
            self.conn.execute('INSERT INTO cash_flow VALUES (?,?,?,?,?,?,?,?,?,?)',
                              ('AAA', 'QUARTER', year, quarter, 2, 100, -30, 4, 50, -20))
        self.conn.commit()
        self.patcher = patch.object(adapter, '_get_db_path', return_value=self.path)
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()
        self.conn.close()
        self.directory.cleanup()

    def test_eps_includes_loss(self):
        self.assertEqual(adapter.load_ttm_eps('AAA'), 480)

    def test_zero_and_negative_eps_are_not_missing(self):
        self.conn.execute('UPDATE income_statement SET isa23=0')
        self.conn.commit()
        self.assertEqual(adapter.load_ttm_eps('AAA'), 0)
        self.conn.execute('UPDATE income_statement SET isa23=-1')
        self.conn.commit()
        self.assertEqual(adapter.load_ttm_eps('AAA'), -4)
        self.assertIsNone(adapter.load_ttm_eps('MISSING'))

    def test_gap_does_not_make_ttm(self):
        self.conn.execute('UPDATE income_statement SET quarter_report=2 WHERE year_report=2025 AND quarter_report=3')
        self.conn.commit()
        self.assertIsNone(adapter.load_ttm_eps('AAA'))
        self.assertEqual(adapter.load_ttm_financial_components('AAA')['source'], 'missing')

    def test_cashflow_mapping_and_parent_loss(self):
        result = adapter.load_ttm_financial_components('AAA')
        self.assertEqual(result['operating_cf'], 400)
        self.assertEqual(result['capex_net'], 104)
        self.assertEqual(result['net_borrowing'], 120)
        self.assertEqual(result['financial_expense'], 20)
        self.assertEqual(result['net_income'], -40)

    def test_zero_capex_not_replaced_with_depreciation(self):
        self.conn.execute('UPDATE cash_flow SET cfa19=0,cfa20=0')
        self.conn.commit()
        self.assertEqual(adapter.load_ttm_financial_components('AAA')['capex_net'], 0)

    def test_mismatched_periods_do_not_make_ttm(self):
        self.conn.execute('UPDATE cash_flow SET year_report=year_report-1')
        self.conn.commit()
        self.assertEqual(adapter.load_ttm_financial_components('AAA')['source'], 'missing')

    def test_fallback_uses_annual_not_single_quarter(self):
        self.conn.execute("DELETE FROM cash_flow WHERE quarter_report=3")
        self.conn.execute("INSERT INTO income_statement VALUES ('AAA','YEAR',2025,0,100,80,10,800)")
        self.conn.execute("INSERT INTO cash_flow VALUES ('AAA','YEAR',2025,0,20,1000,-300,40,500,-200)")
        self.conn.commit()
        result = adapter.load_ttm_financial_components('AAA')
        self.assertEqual(result['operating_cf'], 1000)
        self.assertEqual(result['period_quarter'], 0)


class ValuationTests(unittest.TestCase):
    def setUp(self):
        self.inputs = {
            'success': True, 'symbol': 'AAA', 'industry': 'Software technology',
            'industry_screening_key': 'TECH', 'industry_screening_name': 'Technology',
            'current_price': 10000, 'current_price_source': 'test', 'eps_ttm': 1000,
            'eps_source': 'test', 'bvps': 5000, 'bvps_source': 'test',
            'shares_outstanding': 100, 'net_income_ttm': 100000,
            'market_cap': 1000000, 'screening_roe': 20,
            'cashflow_components': {'operating_cf': 200000, 'capex_net': 20000,
                                    'net_borrowing': 0, 'financial_expense': 1000},
            'balance_sheet_components': {'net_debt': 50000, 'total_debt': 60000},
            'eps_growth_3y': {'cagr': .1}, 'eps_growth_suggestion': {'cagr': .1},
            'analyst_forecast': {'selected': {'year': 2026, 'eps': 1800}},
        }
        self.patchers = [
            patch.object(service, 'load_inputs_from_sqlite', return_value=self.inputs),
            patch.object(service, '_suggest_wacc', return_value={'wacc': .12, 'ke': .14}),
            patch.object(service._screening_industry_cache, 'get_rows',
                         return_value=[('BBB', 12, 2, 1000000)]),
            patch.object(service, 'summarize_symbol_news_signal', return_value={}),
        ]
        for p in self.patchers:
            p.start()

    def tearDown(self):
        for p in reversed(self.patchers):
            p.stop()

    def test_base_matches_main_including_forward_eps(self):
        result = service.calculate_valuation('AAA', {})
        self.assertEqual(result['valuations'], result['scenarios']['base']['valuations'])
        self.assertEqual(result['fair_value_range']['mid_pe'],
                         round(result['valuations']['justified_pe'], 2))

    def test_missing_forecast_growth_keeps_history(self):
        result = service.calculate_valuation('AAA', {})
        self.assertEqual(result['inputs']['growth_used'], 10)
        self.assertNotIn('analyst_profit_growth', result['inputs']['growth_suggestion'])

    def test_reported_zero_forecast_growth_is_used(self):
        self.inputs['analyst_forecast']['selected']['profit_growth'] = 0
        result = service.calculate_valuation('AAA', {})
        self.assertEqual(result['inputs']['growth_used'], 4)

    def test_explicit_zero_growth_override_is_used(self):
        result = service.calculate_valuation('AAA', {'revenueGrowth': 0})
        self.assertEqual(result['inputs']['growth_used'], 0)


class BetaTests(unittest.TestCase):
    def test_returns_match_both_interval_endpoints(self):
        stock, index = beta._aligned_returns(
            {'2026-01-01': 10, '2026-01-03': 12, '2026-01-04': 15},
            {'2026-01-01': 100, '2026-01-02': 300,
             '2026-01-03': 120, '2026-01-04': 150}, 2)
        self.assertEqual(stock, index)
        self.assertEqual(len(stock), 2)

    def test_loader_selects_latest_observations(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'prices.sqlite')
            conn = sqlite3.connect(path)
            conn.execute('CREATE TABLE prices (symbol TEXT, day TEXT, close REAL)')
            conn.executemany('INSERT INTO prices VALUES (?,?,?)',
                             [('AAA', f'2026-01-{day:02d}', day) for day in range(1, 10)])
            conn.commit()
            conn.close()
            rows = beta._get_dated_closes(path, 'prices', 'day', 'close', 'AAA', 3)
            self.assertEqual(sorted(rows), ['2026-01-07', '2026-01-08', '2026-01-09'])

    def test_insufficient_overlap_is_fallback(self):
        with patch.object(beta, '_get_beta_from_sqlite', return_value=None), \
                patch.object(beta, '_get_fireant_beta', return_value=None), \
                patch.object(beta, '_get_dated_closes', return_value={'2026-01-01': 10}):
            self.assertTrue(beta.calculate_beta('AAA')['is_fallback'])


class BatchCacheTests(unittest.TestCase):
    def test_full_refresh_removes_stale_and_skipped_rows(self):
        from backend.updater import batch_valuations as batch
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'cache.sqlite')
            conn = sqlite3.connect(path)
            conn.execute(batch._CREATE_TABLE)
            conn.executemany('INSERT INTO valuations(symbol,intrinsic_value) VALUES (?,?)',
                             [('OLD', 10), ('SKIP', 20)])
            conn.commit()
            result = {'success': True, 'valuations': {'weighted_average': 120},
                      'inputs': {'current_price': 100}, 'quality': {'score': 80, 'grade': 'B'}}
            with patch.object(batch, 'resolve_valuation_cache_db_path', return_value=path), \
                    patch.object(batch, '_get_symbols', return_value=['AAA', 'SKIP']), \
                    patch.object(service, 'calculate_valuation', side_effect=[result, {'success': False}]):
                summary = batch.run_batch_valuations()
            self.assertEqual(summary['computed'], 1)
            self.assertEqual(conn.execute('SELECT symbol, intrinsic_value FROM valuations').fetchall(),
                             [('AAA', 120)])
            conn.close()

    def test_failure_preserves_previous_cache(self):
        from backend.updater import batch_valuations as batch
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'cache.sqlite')
            conn = sqlite3.connect(path)
            conn.execute(batch._CREATE_TABLE)
            conn.execute("INSERT INTO valuations(symbol,intrinsic_value) VALUES ('OLD',10)")
            conn.commit()
            with patch.object(batch, 'resolve_valuation_cache_db_path', return_value=path), \
                    patch.object(batch, '_get_symbols', return_value=['AAA']), \
                    patch.object(service, 'calculate_valuation', side_effect=ValueError('bad input')):
                with self.assertRaises(RuntimeError):
                    batch.run_batch_valuations()
            self.assertEqual(conn.execute('SELECT symbol FROM valuations').fetchall(), [('OLD',)])
            conn.close()


if __name__ == '__main__':
    unittest.main()
