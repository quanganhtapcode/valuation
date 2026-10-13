import json
import sqlite3
import unittest

from scripts.fetchers.fetch_vietnam_macro import decode_messages, normalize_bars, save_series


class VietnamMacroTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('CREATE TABLE macro_prices(symbol TEXT,date TEXT,close REAL,PRIMARY KEY(symbol,date))')
        self.db.execute('CREATE TABLE macro_fetch_status(symbol TEXT PRIMARY KEY,fetched_at TEXT,last_date TEXT,point_count INTEGER)')
        self.db.executemany('INSERT INTO macro_prices VALUES (?,?,?)', [('ECONOMICS:VNCPI', '2026-05-01', 100), ('ECONOMICS:VNCPI', '2026-06-01', 101)])
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_frames_and_partial_payload(self):
        body = json.dumps({'m': 'series_completed', 'p': []})
        frame = f'~m~{len(body)}~m~{body}'
        messages, pending = decode_messages(frame + '~m~5~m~ab')
        self.assertEqual(messages, [body])
        self.assertEqual(pending, '~m~5~m~ab')
        self.assertEqual(decode_messages(pending + 'cde'), (['abcde'], ''))

    def test_normalize_observation_dates_not_fetch_dates(self):
        rows = normalize_bars([{'v': [1780272000, 1, 1, 1, 101]}, {'v': [1780272000, 1, 1, 1, 102]}])
        self.assertEqual(rows, [('2026-06-01', 102)])

    def test_upsert_preserves_old_history_and_records_freshness(self):
        self.assertEqual(save_series(self.db, 'ECONOMICS:VNCPI', [('2026-06-01', 102), ('2026-07-01', 103)]), 1)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM macro_prices').fetchone()[0], 3)
        self.assertEqual(self.db.execute('SELECT last_date FROM macro_fetch_status').fetchone()[0], '2026-07-01')

    def test_refuses_unit_changes_and_keeps_existing_rows(self):
        with self.assertRaises(ValueError):
            save_series(self.db, 'ECONOMICS:VNCPI', [('2026-06-01', 101000), ('2026-07-01', 103000)])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM macro_prices').fetchone()[0], 2)

    def test_refuses_older_source_or_nonoverlapping_histories(self):
        for rows in [[('2026-05-01', 100)], [('2026-07-01', 103)]]:
            with self.assertRaises(ValueError):
                save_series(self.db, 'ECONOMICS:VNCPI', rows)


if __name__ == '__main__':
    unittest.main()
