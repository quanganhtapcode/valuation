"""Regression checks for shared macro history and current FX snapshots."""
import datetime as dt
import json
import sqlite3
import unittest
from io import BytesIO
from unittest.mock import Mock, patch

from backend.routes.market import macro
from scripts.fetchers import fetch_macro_history as history


class MacroHistoryTests(unittest.TestCase):
    def test_prune_preserves_economic_history_and_only_prunes_owned_symbols(self):
        with sqlite3.connect(':memory:') as conn:
            conn.execute('CREATE TABLE macro_prices (symbol TEXT, date TEXT, close REAL)')
            today = dt.datetime.now(dt.timezone.utc).date().isoformat()
            conn.executemany('INSERT INTO macro_prices VALUES (?, ?, ?)', [
                ('ECONOMICS:VNGDPYY', '2000-06-01', 5.63),
                ('OTHER:SERIES', '2000-06-01', 1),
                ('USDVND=X', '2000-06-01', 10000),
                ('JPYVND=X', '2000-06-01', 100),
                ('USDVND=X', today, 25959),
            ])
            history.prune(conn)
            rows = conn.execute('SELECT symbol, date FROM macro_prices ORDER BY symbol').fetchall()
        self.assertEqual(rows, [
            ('ECONOMICS:VNGDPYY', '2000-06-01'),
            ('OTHER:SERIES', '2000-06-01'),
            ('USDVND=X', today),
        ])

    def test_fx_history_uses_market_day_for_candles_at_2300_utc(self):
        timestamp = int(dt.datetime(2026, 9, 29, 23, tzinfo=dt.timezone.utc).timestamp())
        body = {'chart': {'result': [{
            'meta': {'exchangeTimezoneName': 'Europe/London'},
            'timestamp': [timestamp], 'indicators': {'quote': [{'close': [25970]}]},
        }]}}
        with patch.object(history.urllib.request, 'urlopen', return_value=BytesIO(json.dumps(body).encode())):
            self.assertEqual(history.fetch_history('USDVND=X'), {'2026-09-30': 25970})

    def test_fx_window_replaces_shifted_dates_without_touching_other_history(self):
        with sqlite3.connect(':memory:') as conn:
            conn.execute('CREATE TABLE macro_prices (symbol TEXT, date TEXT, close REAL, PRIMARY KEY (symbol, date))')
            conn.executemany('INSERT INTO macro_prices VALUES (?, ?, ?)', [
                ('USDVND=X', '2026-09-24', 25000),
                ('USDVND=X', '2026-09-27', 26000),
                ('ECONOMICS:VNGDPYY', '2000-06-01', 5.63),
            ])
            history.upsert(conn, 'USDVND=X', {'2026-09-25': 25990, '2026-09-28': 25974}, replace_window=True)
            rows = conn.execute('SELECT symbol, date FROM macro_prices ORDER BY symbol, date').fetchall()
        self.assertEqual(rows, [
            ('ECONOMICS:VNGDPYY', '2000-06-01'),
            ('USDVND=X', '2026-09-24'), ('USDVND=X', '2026-09-25'), ('USDVND=X', '2026-09-28'),
        ])


class MacroQuoteTests(unittest.TestCase):
    def response(self, price=25959):
        def timestamp(day, hour):
            return int(dt.datetime(2026, 9, day, hour, tzinfo=dt.timezone.utc).timestamp())
        return Mock(status_code=200, json=lambda: {'chart': {'result': [{
            'meta': {'regularMarketPrice': price, 'regularMarketTime': timestamp(30, 21),
                     'exchangeTimezoneName': 'Europe/London', 'chartPreviousClose': 25990},
            'timestamp': [timestamp(28, 23), timestamp(29, 23)],
            'indicators': {'quote': [{'close': [25969, 25970]}]},
        }]}})

    def test_quote_uses_previous_session_not_window_start_or_current_session(self):
        with patch.object(macro.http_requests, 'get', return_value=self.response()):
            quote = macro._fetch_yahoo('USDVND=X')
        self.assertEqual(quote['price'], 25959)
        self.assertEqual(quote['change'], -10)
        self.assertEqual(quote['updatedAt'], '2026-09-30')
        self.assertEqual(quote['changePercent'], -0.04)

    def test_invalid_upstream_price_does_not_replace_local_quote(self):
        for price in (0, -1, float('nan'), float('inf')):
            with self.subTest(price=price), patch.object(macro.http_requests, 'get', return_value=self.response(price)):
                self.assertIsNone(macro._fetch_yahoo('USDVND=X'))

    def test_partial_refresh_keeps_missing_pairs_and_newer_local_quotes(self):
        base = {'exchange_rates': [
            {'symbol': 'USDVND=X', 'price': 25970, 'updatedAt': '2026-09-30'},
            {'symbol': 'CNYVND=X', 'price': 3865, 'updatedAt': '2026-09-30'},
        ], 'commodities': [{'symbol': 'GC=F', 'price': 4190, 'updatedAt': '2026-09-30'}]}
        fresh = {'exchange_rates': [
            {'symbol': 'USDVND=X', 'price': 20000, 'updatedAt': '2026-09-29'},
            {'symbol': 'JPYVND=X', 'price': 164, 'updatedAt': '2026-09-30'},
        ], 'commodities': []}
        merged = macro._merge_rates(base, fresh)
        self.assertEqual(merged['commodities'], base['commodities'])
        self.assertEqual({item['symbol']: item['price'] for item in merged['exchange_rates']}, {
            'USDVND=X': 25970, 'CNYVND=X': 3865, 'JPYVND=X': 164,
        })

    def test_cny_and_jpy_quotes_use_the_same_crosses_as_history(self):
        quotes = {
            'USDVND=X': {'price': 100, 'change': 10, 'updatedAt': '2026-09-30'},
            'USDCNY=X': {'price': 2, 'change': -1, 'updatedAt': '2026-10-01'},
            'USDJPY=X': {'price': 4, 'change': -1, 'updatedAt': '2026-10-01'},
        }
        with patch.object(macro, '_fetch_yahoo', side_effect=lambda symbol: quotes.get(symbol)) as fetch:
            result = macro._fetch_rates_data()
        rates = {item['symbol']: item for item in result['exchange_rates']}
        self.assertEqual(rates['CNYVND=X']['price'], 50)
        self.assertEqual(rates['CNYVND=X']['change'], 20)
        self.assertEqual(rates['JPYVND=X']['price'], 25)
        self.assertEqual(rates['JPYVND=X']['change'], 7)
        self.assertEqual(rates['CNYVND=X']['updatedAt'], '2026-09-30')
        self.assertNotIn(('CNYVND=X',), [call.args for call in fetch.call_args_list])
        self.assertNotIn(('JPYVND=X',), [call.args for call in fetch.call_args_list])

    def test_refresh_loads_new_local_history_even_when_yahoo_is_unavailable(self):
        seed = {'exchange_rates': [
            {'symbol': 'USDVND=X', 'price': 25959, 'updatedAt': '2026-10-01'},
        ], 'commodities': []}
        with patch.object(macro, '_rates_cache', {'exchange_rates': [], 'commodities': []}), \
                patch.object(macro, '_rates_cache_updated_at', 0), \
                patch.object(macro, '_rates_cache_refreshing', True), \
                patch.object(macro, '_fetch_rates_data', return_value={'exchange_rates': [], 'commodities': []}), \
                patch.object(macro, '_read_rates_seed', return_value=seed):
            macro._refresh_rates_cache()
            self.assertEqual(macro._rates_cache, seed)
            self.assertGreater(macro._rates_cache_updated_at, 0)
            self.assertFalse(macro._rates_cache_refreshing)


if __name__ == '__main__':
    unittest.main()
