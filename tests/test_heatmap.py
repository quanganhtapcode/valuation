import unittest
from unittest.mock import patch

from backend.routes.market import heatmap, overview_refresh


class HeatmapQuotes(unittest.TestCase):
    def setUp(self):
        self.row = {'marketPrice': 100000, 'dailyPriceChangePercent': -2.5}

    def test_complete_quote_uses_its_own_reference(self):
        price, change = heatmap.resolve_quote(self.row, {'c': 105000, 'ref': 100000})
        self.assertEqual((price, change), (105000, 5))

    def test_reset_or_partial_quote_keeps_entire_daily_snapshot(self):
        for quote in ({}, {'c': 0, 'ref': 99000}, {'c': 110000},
                      {'c': float('nan'), 'ref': 100000},
                      {'c': 110000, 'ref': -1}):
            with self.subTest(quote=quote):
                self.assertEqual(heatmap.resolve_quote(self.row, quote), (100000, -2.5))

    def test_closed_market_does_not_consume_reset_ram_quotes(self):
        from contextlib import contextmanager

        row = dict(self.row, ticker='AAA', viSector='Test', marketCap=100,
                   viOrganShortName='Company', enOrganShortName='Company')

        class Connection:
            def execute(self, *args):
                return self

            def fetchall(self):
                return [row]

        @contextmanager
        def connection(*args):
            yield Connection()

        with patch.object(heatmap.os.path, 'exists', return_value=True), \
             patch.object(heatmap, 'read_connection', connection), \
             patch.object(heatmap.VCIClient, 'ensure_background_refresh'), \
             patch.object(heatmap.VCIClient, '_is_trading_hours', return_value=False), \
             patch.object(heatmap.VCIClient, 'get_all_prices') as prices:
            result = heatmap.fetch_heatmap('HSX', 200)
        prices.assert_not_called()
        sector = result['sectors'][0]
        self.assertEqual(sector['stocks'][0]['change'], -2.5)
        self.assertEqual(sector['avgChange'], -2.5)

    def test_overview_shares_heatmap_implementation(self):
        self.assertIs(overview_refresh._fetch_heatmap, heatmap.fetch_heatmap)


if __name__ == '__main__':
    unittest.main()
