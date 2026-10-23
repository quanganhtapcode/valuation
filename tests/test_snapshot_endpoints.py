"""Exercise the HTTP contract without making external provider calls."""
import unittest
from unittest.mock import Mock, patch

from flask import Blueprint, Flask

from backend.routes.market import gold, ai_takeaways
from backend.routes.stock import ai_analysis


class SnapshotEndpoints(unittest.TestCase):
    def test_gold_cold_start_is_retryable_then_snapshot_loads(self):
        app = Flask(__name__)
        bp = Blueprint('gold_test', __name__)
        gold.register(bp)
        app.register_blueprint(bp)
        service = Mock()
        service.snapshot.side_effect = [
            {'success': False, 'data': []},
            {'success': True, 'data': [{'Id': 1}, {'Id': 2}], 'stale': True},
            {'success': True, 'data': [{'Id': 1}, {'Id': 2}], 'stale': False},
        ]
        with patch.object(gold, 'gold_service', return_value=service):
            cold = app.test_client().get('/gold')
            self.assertEqual(cold.status_code, 503)
            self.assertEqual(cold.headers['Retry-After'], '5')
            warm = app.test_client().get('/gold')
            self.assertEqual(warm.status_code, 200)
            self.assertTrue(warm.json['stale'])
            self.assertEqual(warm.headers['Cache-Control'], 'no-store')
            fresh = app.test_client().get('/gold')
            self.assertIn('s-maxage=5', fresh.headers['Cache-Control'])
        service.fetch_with_retry.assert_not_called()

    def test_ai_compact_preserves_bilingual_content_and_publisher_links(self):
        app = Flask(__name__)
        bp = Blueprint('ai_test', __name__)
        ai_takeaways.register(bp)
        app.register_blueprint(bp)
        saved = {'available': True, 'news_summary': ['English'], 'news_summary_vi': ['Tiếng Việt'],
                 'generated_at': '2026-10-24T00:00:00Z',
                 'news_sources': [{'url': 'https://example.org', 'title_en': 'Headline',
                                   'title_vi': 'Tiêu đề', 'excerpt': 'Large excerpt' * 100}],
                 'recent_news': [{'url': 'https://example.org', 'source': 'Publisher',
                                  'symbol': 'FPT', 'excerpt': 'Large excerpt' * 100}],
                 'movers': []}
        with patch.object(ai_takeaways, 'read_market_ai_takeaways', return_value=saved):
            full = app.test_client().get('/ai-takeaways')
            compact = app.test_client().get('/ai-takeaways?compact=1')
        self.assertIn('excerpt', full.json['news_sources'][0])
        self.assertNotIn('excerpt', compact.json['news_sources'][0])
        self.assertEqual(compact.json['news_sources'][0]['title_en'], 'Headline')
        self.assertEqual(compact.json['news_summary_vi'], saved['news_summary_vi'])
        self.assertEqual(compact.json['recent_news'][0]['url'], 'https://example.org')
        self.assertLess(len(compact.data), len(full.data) / 2)
        self.assertIn('s-maxage=30', compact.headers['Cache-Control'])
        self.assertIn('excerpt', saved['news_sources'][0])

    def test_stock_ai_database_failure_closes_connection_and_hides_details(self):
        app = Flask(__name__)
        bp = Blueprint('stock_test', __name__)
        ai_analysis.register(bp)
        app.register_blueprint(bp)
        conn = Mock()
        conn.execute.side_effect = RuntimeError('/private/database/path')
        with patch.object(ai_analysis.sqlite3, 'connect', return_value=conn):
            response = app.test_client().get('/FPT/ai-analysis')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('/private', response.get_data(as_text=True))
        conn.close.assert_called_once()
