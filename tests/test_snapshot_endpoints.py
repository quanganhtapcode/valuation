"""Exercise the HTTP contract without making external provider calls."""
import unittest
from unittest.mock import Mock, patch

from flask import Blueprint, Flask

from backend.routes.market import gold
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
        ]
        with patch.object(gold, 'gold_service', return_value=service):
            cold = app.test_client().get('/gold')
            self.assertEqual(cold.status_code, 503)
            self.assertEqual(cold.headers['Retry-After'], '5')
            warm = app.test_client().get('/gold')
            self.assertEqual(warm.status_code, 200)
            self.assertTrue(warm.json['stale'])
        service.fetch_with_retry.assert_not_called()

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
