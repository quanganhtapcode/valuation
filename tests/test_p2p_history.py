import sqlite3
import tempfile
import unittest
from pathlib import Path

from automation.update_p2p_history import save_snapshot


class P2PHistoryTest(unittest.TestCase):
    def test_deduplicates_and_fills_missing_quotes(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / 'history.sqlite'
            snapshot = {
                'fetchedAt': 1793456100000,
                'okx': {'buy': {'offer': {'price': 26400, 'id': '1'}}, 'sell': {'offer': None}},
                'binance': {'buy': {'offer': None}, 'sell': {'offer': None}},
                'cashUsd': {'buy': 26000, 'sell': 25900},
                'bankUsd': None,
            }
            save_snapshot(snapshot, db)
            snapshot['okx']['buy']['offer']['price'] = 27000
            snapshot['binance']['sell']['offer'] = {'price': 25700}
            save_snapshot(snapshot, db)
            with sqlite3.connect(db) as conn:
                rows = conn.execute('SELECT source, direction, price_vnd FROM price_snapshots ORDER BY source, direction').fetchall()
            self.assertEqual(rows, [('binance', 'sell', 25700), ('cashUsd', 'buy', 26000),
                                    ('cashUsd', 'sell', 25900), ('okx', 'buy', 26400)])

    def test_rejects_empty_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                save_snapshot({'fetchedAt': 1793456100000}, Path(directory) / 'history.sqlite')


if __name__ == '__main__':
    unittest.main()
