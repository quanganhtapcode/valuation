import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from flask import Blueprint, Flask
from backend.routes.market import p2p


class P2PEndpointTest(unittest.TestCase):
    def setUp(self):
        p2p._cached = None
        p2p._cached_at = 0
        app = Flask(__name__)
        bp = Blueprint('test_p2p', __name__, url_prefix='/api/market')
        p2p.register(bp)
        app.register_blueprint(bp)
        self.client = app.test_client()

    def test_cache_and_cash_fallback(self):
        payload = {'okx': {}, 'binance': {}, 'cashUsd': None, 'bankUsd': None, 'fetchedAt': 123}
        with patch.object(p2p.subprocess, 'run', return_value=SimpleNamespace(stdout=json.dumps(payload))) as run, \
                patch.object(p2p, 'read_cash_usd', return_value={'buy': 26090, 'sell': 25990, 'fetchedAt': 123}):
            first = self.client.get('/api/market/p2p')
            second = self.client.get('/api/market/p2p')
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.get_json()['cashUsd'], {'buy': 26090, 'sell': 25990})
        self.assertEqual(second.status_code, 200)
        self.assertEqual(run.call_count, 1)

    def test_failure_returns_503(self):
        with patch.object(p2p.subprocess, 'run', side_effect=OSError('unavailable')):
            response = self.client.get('/api/market/p2p')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')


if __name__ == '__main__':
    unittest.main()
