import os
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from backend.fund_store import save_listing, save_history, fund_detail, connect


class FundStoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'FUNDS_DB_PATH': str(Path(self.directory.name) / 'funds.sqlite')})
        self.env.start()
        save_listing([{'short_name': 'TEST', 'fund_id_fmarket': 11, 'nav_update_at': '2026-10-12', 'nav': 150, 'management_fee': 1.75}])

    def tearDown(self):
        self.env.stop()
        self.directory.cleanup()

    def test_upsert_chronology_and_calendar_return(self):
        rows = [{'navDate': '2024-12-31', 'nav': 100}, {'navDate': '2024-06-01', 'nav': 80}, {'navDate': '2025-01-02', 'nav': 110}, {'navDate': '2025-12-31', 'nav': 120}]
        save_history('TEST', rows)
        save_history('TEST', rows)
        detail = fund_detail('test')
        self.assertEqual(len(detail['history']), 5)
        self.assertEqual(detail['history'][0]['date'], '2024-06-01')
        returns = {row['year']: row for row in detail['yearly_returns']}
        self.assertAlmostEqual(returns[2025]['return_pct'], 20)
        self.assertEqual(returns[2025]['start_date'], '2024-12-31')
        self.assertTrue(returns[2024]['partial'])
        self.assertFalse(detail['history_stale'])
        self.assertEqual(detail['fund']['management_fee'], 1.75)
        self.assertIsNone(fund_detail('UNKNOWN'))

    def test_invalid_batch_never_replaces_valid_history(self):
        save_history('TEST', [{'navDate': '2025-12-31', 'nav': 120}])
        before = fund_detail('TEST')['history']
        for rows in [[], [{'navDate': '2025-12-31', 'nav': float('nan')}], [{'navDate': '2025-12-31', 'nav': 100}, {'navDate': '2025-12-31', 'nav': 110}]]:
            with self.assertRaises(ValueError):
                save_history('TEST', rows)
            self.assertEqual(fund_detail('TEST')['history'], before)

    def test_source_duplicates_retained_and_selected_deterministically(self):
        rows = [{'id': 1, 'navDate': '2025-12-31', 'nav': 110}, {'id': 2, 'navDate': '2025-12-31', 'nav': 120}]
        save_history('TEST', rows[::-1])
        self.assertEqual(fund_detail('TEST')['history'][0]['nav'], 120)
        self.assertEqual(fund_detail('TEST')['conflicting_dates'], 1)
        save_history('TEST', rows[:1])
        self.assertEqual(fund_detail('TEST')['history'][0]['nav'], 120)
        db = connect()
        self.assertEqual(db.execute('SELECT COUNT(*) FROM fund_nav_observations').fetchone()[0], 2)
        db.close()


if __name__ == '__main__':
    unittest.main()
