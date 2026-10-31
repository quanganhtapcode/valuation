import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.routes.market.p2p_cash import read_cash_usd


class CashUsdTest(unittest.TestCase):
    def test_uses_latest_complete_fresh_snapshot_only(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'history.sqlite'
            now = 1793457000000
            with sqlite3.connect(path) as conn:
                conn.execute('CREATE TABLE price_snapshots (bucket_utc INTEGER, fetched_at_ms INTEGER, source TEXT, direction TEXT, price_vnd REAL)')
                conn.executemany('INSERT INTO price_snapshots VALUES (?, ?, ?, ?, ?)', [
                    (100, now - 1000, 'cashUsd', 'buy', 26090),
                    (100, now - 1000, 'cashUsd', 'sell', 25990),
                    (200, now - 500, 'cashUsd', 'buy', 27000),
                ])
            self.assertEqual(read_cash_usd(path, now), {'buy': 26090, 'sell': 25990, 'fetchedAt': now - 1000})
            self.assertIsNone(read_cash_usd(path, now + 600000))
            self.assertIsNone(read_cash_usd(Path(directory) / 'missing.sqlite', now))


if __name__ == '__main__':
    unittest.main()
