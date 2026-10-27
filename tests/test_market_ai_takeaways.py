import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from backend.routes.handlers.top_movers import top_movers_from_screener_sqlite
from backend.services import market_ai_takeaways as ai
from backend.services.market_sessions import expected_session_date
from backend.services.vci_news_sqlite import compact_news_item, query_recent_market_news

NOW = datetime(2026, 10, 16, 5, 10, tzinfo=timezone.utc)


class FixedDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW.astimezone(tz) if tz else NOW.replace(tzinfo=None)


class MarketAIValidation(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db = str(Path(self.directory.name) / 'market.sqlite')
        with sqlite3.connect(self.db) as conn:
            conn.execute('''CREATE TABLE screening_data (
                ticker TEXT, exchange TEXT, viOrganName TEXT, enOrganName TEXT,
                marketPrice REAL, refPrice REAL, dailyPriceChangePercent REAL,
                accumulatedValue REAL, matchPriceTime TEXT, fetched_at TEXT)''')
            conn.execute('CREATE TABLE news_items (raw_json TEXT, update_date TEXT)')

    def quote(self, symbol, price, ref, date, stored_change=-6.99):
        with sqlite3.connect(self.db) as conn:
            conn.execute('INSERT INTO screening_data VALUES (?,?,?,?,?,?,?,?,?,?)',
                         (symbol, 'HSX', symbol, symbol, price, ref, stored_change,
                          100, date + 'T04:00:00', NOW.isoformat()))

    def article(self, symbol='FPT', date='2026-10-16 09:00:00', url='https://example.org/fpt'):
        return {'ticker': symbol, 'news_title': f'{symbol}: Lợi nhuận tăng 20%',
                'news_short_content': 'Lợi nhuận quý 3 tăng 20% so với cùng kỳ.',
                'news_source_link': url, 'update_date': date, 'sentiment': 'Negative'}

    def news(self, **kwargs):
        return compact_news_item(self.article(**kwargs))

    def test_old_quotes_remain_invalid_even_if_fetched_today(self):
        self.quote('PNJ', 26600, 28600, '2026-09-30')
        self.quote('TSC', 1740, 1870, '2026-09-30')
        result = top_movers_from_screener_sqlite(db_path=self.db, move_type='DOWN', now=NOW)
        self.assertEqual(result['Data'], [])
        self.assertFalse(result['available'])

    def test_valid_quote_recalculates_from_same_snapshot_reference(self):
        self.quote('PNJ', 102, 100, '2026-10-16')
        self.quote('TSC', 98, 100, '2026-10-16', stored_change=10)
        up = top_movers_from_screener_sqlite(db_path=self.db, move_type='UP', now=NOW)['Data']
        down = top_movers_from_screener_sqlite(db_path=self.db, move_type='DOWN', now=NOW)['Data']
        self.assertEqual([(x['Symbol'], round(x['ChangePricePercent'], 2)) for x in up], [('PNJ', 2)])
        self.assertEqual([(x['Symbol'], round(x['ChangePricePercent'], 2)) for x in down], [('TSC', -2)])

    def test_nonfinite_zero_and_wrong_sign_are_not_ranked(self):
        self.quote('AAA', float('inf'), 10, '2026-10-16')
        self.quote('BBB', 10, 0, '2026-10-16')
        self.quote('CCC', 10, 10, '2026-10-16')
        self.assertEqual(top_movers_from_screener_sqlite(db_path=self.db, move_type='DOWN', now=NOW)['Data'], [])

    def test_session_boundary_and_weekend(self):
        self.assertEqual(expected_session_date(datetime(2026, 10, 16, 1, tzinfo=timezone.utc)), '2026-10-15')
        self.assertEqual(expected_session_date(datetime(2026, 10, 17, 5, tzinfo=timezone.utc)), '2026-10-16')

    def test_news_window_uses_vietnam_timezone_and_rejects_future(self):
        items = [self.article(date='2026-10-15 00:06:00'),
                 self.article(date='2026-10-15 12:10:00'),
                 self.article(date='2026-10-16 12:11:00'),
                 self.article(date='2026-10-16T05:00:00+00:00'),
                 self.article(date='not-a-date')]
        with sqlite3.connect(self.db) as conn:
            conn.executemany('INSERT INTO news_items VALUES (?,?)', [(json.dumps(x), x['update_date']) for x in items])
        rows = query_recent_market_news(self.db, since=NOW - timedelta(hours=24), until=NOW)
        self.assertEqual(len(rows), 2)

    def test_prompt_uses_excerpt_sources_not_sentiment_or_old_mover_news(self):
        fresh = self.news()
        old = self.news(symbol='PNJ', date='2026-10-15 00:06:00', url='https://example.org/pnj')
        payload = ai._llm_input([{'symbol': 'PNJ', 'change_pct': -6.99, 'news': [old]}], [old, fresh], NOW)
        self.assertEqual(len(payload['recent_news_24h']), 1)
        self.assertIn('20%', payload['recent_news_24h'][0]['excerpt'])
        self.assertIn('url', payload['recent_news_24h'][0])
        self.assertNotIn('sentiment', payload['recent_news_24h'][0])
        self.assertNotIn('-6.99', json.dumps(payload))

    def test_news_deduplicates_tracking_urls(self):
        first, second = self.news(), self.news(url='https://example.org/fpt?utm_source=other')
        self.assertEqual(len(ai._eligible_news([first, second], NOW)), 1)

    def test_news_ranks_sentiment_strength_then_recency(self):
        neutral = {**self.news(url='https://example.org/neutral'), 'score': 5}
        strong = {**self.news(date='2026-10-16 08:00:00', url='https://example.org/strong'), 'score': 0}
        missing = {**self.news(url='https://example.org/missing'), 'score': None}
        invalid = {**self.news(url='https://example.org/invalid'), 'score': 11}
        ranked = ai._rank_news([missing, neutral, invalid, strong], NOW)
        self.assertEqual([x['url'] for x in ranked], [strong['url'], neutral['url'], missing['url'], invalid['url']])
        self.assertEqual(compact_news_item({**self.article(), 'Score': 0})['score'], 0)

    def compute(self, generated):
        fresh = self.news()
        mover = {'symbol': 'PNJ', 'price': 102, 'ref_price': 100, 'change_pct': -6.99,
                 'direction': 'down', 'session_date': '2026-10-16'}
        def generate(prompt):
            payload = json.loads(prompt.split('INPUT_JSON:\n', 1)[1])
            return json.dumps(generated(payload)), 'test-model'
        with patch.object(ai, 'datetime', FixedDatetime), \
             patch.object(ai, '_load_movers_with_news', return_value=[mover]), \
             patch.object(ai, '_load_recent_market_news', return_value=[fresh]), \
             patch.object(ai, 'generate', side_effect=generate):
            return ai.compute_ai_takeaways()

    def test_retries_rejected_english_summary_once(self):
        calls = []

        def response(payload):
            calls.append(payload)
            return {'news': [{
                'source_id': payload['recent_news_24h'][0]['source_id'],
                'title': 'Profit growth', 'title_vi': 'Lợi nhuận tăng',
                'summary': 'Lợi nhuận tăng 20%.' if len(calls) == 1 else 'Profit increased 20%.',
                'summary_vi': 'Lợi nhuận tăng 20%.',
            }]}

        data = self.compute(response)
        self.assertEqual(len(calls), 2)
        self.assertTrue(data['available'])
        self.assertEqual(data['news_summary'], ['Profit increased 20%.'])
        self.assertEqual(data['news_sources'][0]['title_en'], 'Profit growth')

    def test_does_not_retry_complete_valid_translation(self):
        calls = []

        def response(payload):
            calls.append(payload)
            return {'news': [{
                'source_id': payload['recent_news_24h'][0]['source_id'],
                'summary': 'Profit increased 20%.', 'summary_vi': 'Lợi nhuận tăng 20%.',
            }]}

        self.assertTrue(self.compute(response)['available'])
        self.assertEqual(len(calls), 1)

    def test_llm_cannot_override_calculated_price_bullets(self):
        data = self.compute(lambda payload: {
            'market_summary_vi': ['PNJ -6.99%'], 'headline_vi': 'PNJ giảm sàn',
            'news': [{'source_id': payload['recent_news_24h'][0]['source_id'],
                      'summary': 'Profit increased 20%.', 'summary_vi': 'Lợi nhuận tăng 20%.'}],
        })
        self.assertTrue(data['available'])
        self.assertIn('PNJ tăng 2,00%', ' '.join(data['market_summary_vi']))
        self.assertNotIn('-6.99', ' '.join(data['summary_vi']))
        self.assertNotIn('PNJ giảm sàn', data['headline_vi'])
        self.assertEqual(data['news_sources'][0]['url'], 'https://example.org/fpt')
        self.assertIn('input_snapshot', data)

    def test_five_latest_news_keep_order_when_model_reorders(self):
        articles = [self.news(url=f'https://example.org/article-{i}',
                              date=(NOW - timedelta(minutes=i)).isoformat())
                    for i in range(6)]
        def generate(prompt):
            payload = json.loads(prompt.split('INPUT_JSON:\n', 1)[1])
            return json.dumps({'news': [{
                'source_id': row['source_id'], 'title': 'Profit growth',
                'title_vi': 'Lợi nhuận tăng',
                'summary': 'Profit increased 20%.', 'summary_vi': 'Lợi nhuận tăng 20%.',
            } for row in reversed(payload['recent_news_24h'])]}), 'test-model'
        with patch.object(ai, 'datetime', FixedDatetime), \
             patch.object(ai, '_load_movers_with_news', return_value=[]), \
             patch.object(ai, '_load_recent_market_news', return_value=articles), \
             patch.object(ai, 'generate', side_effect=generate):
            data = ai.compute_ai_takeaways()
        self.assertEqual(len(data['news_summary']), 5)
        self.assertEqual([row['url'] for row in data['news_sources']],
                         [row['url'] for row in articles[:5]])

    def test_short_bilingual_titles_are_separate_and_grounded(self):
        for title, accepted in [('Profit growth', True), ('Profit rises 99%', False)]:
            with self.subTest(title=title):
                data = self.compute(lambda payload: {'news': [{
                    'source_id': payload['recent_news_24h'][0]['source_id'],
                    'title': title, 'title_vi': 'Lợi nhuận tăng',
                    'summary': 'Profit increased 20%.',
                    'summary_vi': 'Lợi nhuận tăng 20%.',
                }]})
                self.assertTrue(data['available'])
                self.assertEqual(data['news_sources'][0]['title_en'],
                                 title if accepted else 'Profit increased 20%.')
                self.assertEqual(data['news_sources'][0]['title_vi'], 'Lợi nhuận tăng')

    def test_unknown_source_or_invented_number_uses_safe_fallback(self):
        for source, number in [('unknown', '20'), ('valid', '99')]:
            with self.subTest(source=source, number=number):
                data = self.compute(lambda payload: {'news': [{
                    'source_id': payload['recent_news_24h'][0]['source_id'] if source == 'valid' else source,
                    'summary': f'Profit increased {number}%.', 'summary_vi': f'Lợi nhuận tăng {number}%.',
                }]})
                self.assertFalse(data['available'])
                self.assertNotIn('99%', ' '.join(data['summary_vi']))

    def test_news_cannot_substitute_a_different_stock_for_the_cited_source(self):
        data = self.compute(lambda payload: {'news': [{
            'source_id': payload['recent_news_24h'][0]['source_id'],
            'summary': 'PNJ declined 20%.', 'summary_vi': 'PNJ giảm 20%.',
        }]})
        self.assertFalse(data['available'])
        self.assertNotIn('PNJ giảm', ' '.join(data['news_summary_vi']))

    def test_fallback_keeps_languages_separate_and_uses_excerpt(self):
        article = self.news()
        data = ai._fallback_takeaways([], [article], NOW)
        self.assertNotEqual(data['news_summary'], data['news_summary_vi'])
        self.assertEqual(data['news_summary_vi'], [article['summary']])
        self.assertNotEqual(data['news_summary_vi'][0], data['news_sources'][0]['title'])
        self.assertFalse(ai._has_vietnamese(data['news_summary'][0]))

    def test_missing_or_duplicate_excerpt_does_not_repeat_headline(self):
        for excerpt in ('', self.news()['title']):
            article = {**self.news(), 'summary': excerpt}
            data = ai._fallback_takeaways([], [article], NOW)
            self.assertNotEqual(data['news_summary_vi'][0], article['title'])
            self.assertIn('Xem bài gốc', data['news_summary_vi'][0])

    def test_vietnamese_summary_in_english_field_is_rejected(self):
        data = self.compute(lambda payload: {'news': [{
            'source_id': payload['recent_news_24h'][0]['source_id'],
            'summary': 'Lợi nhuận tăng 20%.', 'summary_vi': 'Lợi nhuận tăng 20%.',
        }]})
        self.assertFalse(data['available'])
        self.assertFalse(ai._has_vietnamese(data['news_summary'][0]))

    def test_no_current_quote_does_not_claim_market_decline(self):
        stale = {'symbol': 'PNJ', 'price': 26600, 'ref_price': 28600, 'change_pct': -6.99,
                 'direction': 'down', 'session_date': '2026-09-30'}
        data = ai._fallback_takeaways([stale], [], NOW)
        self.assertFalse(data['market_data_available'])
        self.assertNotIn('PNJ', ' '.join(data['summary_vi']))

    def test_read_repairs_legacy_vietnamese_fallback_without_provider(self):
        article = self.news()
        data = ai._fallback_takeaways([], [article], NOW)
        data['news_summary'] = data['news_summary_vi'] = [article['title']]
        with sqlite3.connect(self.db) as conn:
            ai._ensure_schema(conn)
            conn.execute('INSERT INTO market_ai_takeaways VALUES (?,?,?,?,?,?)',
                         (ai._CACHE_KEY, json.dumps(data), 0, 'fallback', NOW.isoformat(), NOW.isoformat()))
        with patch.object(ai, 'resolve_valuation_cache_db_path', return_value=self.db), \
             patch.object(ai, 'datetime', FixedDatetime), patch.object(ai, 'generate') as generate:
            repaired = ai.read_market_ai_takeaways()
        generate.assert_not_called()
        self.assertFalse(ai._has_vietnamese(repaired['news_summary'][0]))
        self.assertEqual(repaired['news_summary_vi'][0], article['summary'])

    def test_provider_failure_preserves_bilingual_news_with_original_timestamp(self):
        previous = ai._fallback_takeaways([], [], NOW)
        previous.update(available=True, news_summary=['English summary'],
                        news_summary_vi=['Tóm tắt'], news_sources=[self.news()])
        fallback = ai._fallback_takeaways([], [], NOW)
        with patch.object(ai, 'resolve_valuation_cache_db_path', return_value=self.db), \
             patch.object(ai, 'datetime', FixedDatetime), \
             patch.object(ai, 'read_market_ai_takeaways', return_value=previous), \
             patch.object(ai, 'compute_ai_takeaways', return_value=fallback):
            result = ai.refresh_market_ai_takeaways()
        self.assertEqual(result['news_summary'], ['English summary'])
        self.assertEqual(result['news_generated_at'], NOW.isoformat())
        self.assertTrue(result['news_stale'])
        with sqlite3.connect(self.db) as conn:
            persisted = json.loads(conn.execute('SELECT payload_json FROM market_ai_takeaways').fetchone()[0])
        self.assertEqual(persisted['news_summary'], ['English summary'])

    def test_persisted_snapshot_keeps_bounded_stale_data(self):
        with sqlite3.connect(self.db) as conn:
            ai._ensure_schema(conn)
        good = ai._fallback_takeaways([], [], NOW)
        for updates, accepted, stale in [({'schema_version': 2}, False, False),
                ({'market_session_date': '2026-09-30'}, True, True),
                ({'generated_at': (NOW - timedelta(hours=7)).isoformat()}, True, True),
                ({'generated_at': (NOW - timedelta(days=8)).isoformat()}, False, False),
                ({}, True, False)]:
            with sqlite3.connect(self.db) as conn:
                conn.execute('INSERT OR REPLACE INTO market_ai_takeaways VALUES (?,?,?,?,?,?)',
                             (ai._CACHE_KEY, json.dumps({**good, **updates}), 0, 'test', NOW.isoformat(), NOW.isoformat()))
            with patch.object(ai, 'resolve_valuation_cache_db_path', return_value=self.db), \
                 patch.object(ai, 'datetime', FixedDatetime):
                result = ai.read_market_ai_takeaways()
                self.assertEqual(result is not None, accepted)
                if accepted:
                    self.assertEqual(result['stale'], stale)
                    self.assertEqual(result['generated_at'], updates.get('generated_at', good['generated_at']))


if __name__ == '__main__':
    unittest.main()
