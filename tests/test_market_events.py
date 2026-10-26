"""Regression checks for calendar errors, pagination and export responses."""
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch

import requests
from flask import Blueprint, Flask

from backend.routes.market import events


def upstream(items, **metadata):
    return Mock(json=Mock(return_value={
        'successful': True, 'status': 200,
        'data': {'content': items, **metadata},
    }))


class MarketEventsTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        bp = Blueprint('events_test', __name__, url_prefix='/api/market')
        events.register(bp)
        app.register_blueprint(bp)
        self.client = app.test_client()
        self.saved = {}

        def cached(key, ttl, fetch):
            if key not in self.saved:
                self.saved[key] = fetch()
            return self.saved[key], False

        self.cache_patch = patch.object(events, 'cache_func', return_value=cached)
        self.cache_patch.start()
        self.addCleanup(self.cache_patch.stop)

    def test_timeout_does_not_poison_cache_and_retry_recovers(self):
        with patch.object(events.http_requests, 'get', side_effect=[
            requests.Timeout('upstream timeout'), upstream([{'id': 'ok'}], last=True),
        ]) as get:
            failed = self.client.get('/api/market/events?date=20261026')
            self.assertEqual(failed.status_code, 504)
            self.assertIn('error', failed.json)
            self.assertEqual(self.saved, {})
            recovered = self.client.get('/api/market/events?date=20261026')
            self.assertEqual(recovered.json, [{'id': 'ok'}])
            self.assertEqual(self.client.get('/api/market/events?date=20261026').json, recovered.json)
            self.assertEqual(get.call_count, 2)

    def test_upstream_errors_are_not_empty_success(self):
        responses = [
            Mock(raise_for_status=Mock(side_effect=requests.HTTPError('400'))),
            Mock(json=Mock(return_value={'successful': False, 'data': {'content': []}})),
            Mock(json=Mock(return_value={'status': 500, 'data': {'content': []}})),
            Mock(json=Mock(return_value={'data': None})),
            Mock(json=Mock(return_value={'data': {'content': [None]}})),
            Mock(json=Mock(side_effect=ValueError('not JSON'))),
        ]
        for response in responses:
            with self.subTest(response=response), patch.object(events.http_requests, 'get', return_value=response):
                self.assertEqual(self.client.get('/api/market/events?date=20261026').status_code, 502)
                self.assertEqual(self.saved, {})

    def test_successful_empty_day_is_cacheable(self):
        with patch.object(events.http_requests, 'get', return_value=upstream([], last=True)) as get:
            for _ in range(2):
                response = self.client.get('/api/market/events?date=20261025')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json, [])
            self.assertEqual(get.call_count, 1)

    def test_week_range_and_daily_cache_are_separate(self):
        with patch.object(events.http_requests, 'get', return_value=upstream([{'id': 'week'}], last=True)) as get:
            response = self.client.get('/api/market/events?fromDate=20261026&toDate=20261101')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(get.call_args.kwargs['params']['toDate'], '20261101')
            self.client.get('/api/market/events?date=20261026')
            self.assertEqual(get.call_count, 2)

    def test_rejects_invalid_or_excessive_week_ranges(self):
        with patch.object(events.http_requests, 'get') as get:
            for query in ['fromDate=20261026&toDate=20261102',
                          'fromDate=20261026&toDate=20261025',
                          'fromDate=20261026&toDate=20260230']:
                self.assertEqual(self.client.get('/api/market/events?' + query).status_code, 400)
            get.assert_not_called()

    def test_reads_all_pages_and_rejects_partial_failure(self):
        pages = [upstream([{'id': 'a'}], totalPages=2, last=False),
                 upstream([{'id': 'b'}], totalPages=2, last=True)]
        with patch.object(events.http_requests, 'get', side_effect=pages) as get:
            self.assertEqual(events._fetch_events('20261026'), [{'id': 'a'}, {'id': 'b'}])
            self.assertEqual([call.kwargs['params']['page'] for call in get.call_args_list], [0, 1])
        with patch.object(events.http_requests, 'get', side_effect=[pages[0], requests.Timeout()]):
            self.assertEqual(self.client.get('/api/market/events?date=20261026').status_code, 504)
            self.assertEqual(self.saved, {})

    def test_validates_calendar_dates_and_export_ranges(self):
        with patch.object(events.http_requests, 'get') as get:
            for date in ['20260230', '20261301', '2026011', 'abcdefgh', '２０２６１０２６']:
                self.assertEqual(self.client.get('/api/market/events', query_string={'date': date}).status_code, 400)
            for query in ['fromDate=20261027&toDate=20261026', 'fromDate=20260230', 'fromDate=1']:
                self.assertEqual(self.client.get('/api/market/events/export?' + query).status_code, 400)
            get.assert_not_called()

    def test_default_date_uses_vietnam_timezone(self):
        instant = datetime(2026, 10, 25, 18, tzinfo=timezone.utc)
        with patch.object(events, 'datetime') as clock:
            clock.now.side_effect = lambda tz: instant.astimezone(tz)
            self.assertEqual(events._today_yyyymmdd(), '20261026')

    def test_export_rejects_json_and_closes_upstream(self):
        response = Mock(status_code=200, headers={'Content-Type': 'application/json'})
        with patch.object(events.http_requests, 'get', return_value=response):
            result = self.client.get('/api/market/events/export?fromDate=20261026')
            self.assertEqual(result.status_code, 502)
            response.close.assert_called_once()

    def test_export_stream_and_timeout(self):
        response = Mock(status_code=200, headers={'Content-Type': 'application/octet-stream'})
        response.iter_content.return_value = iter([b'PK', b'xlsx'])
        with patch.object(events.http_requests, 'get', return_value=response):
            result = self.client.get('/api/market/events/export?fromDate=20261026')
            self.assertEqual(result.data, b'PKxlsx')
            self.assertIn('events_20261026_20261026.xlsx', result.headers['Content-Disposition'])
            result.close()
            response.close.assert_called_once()
        with patch.object(events.http_requests, 'get', side_effect=requests.Timeout()):
            self.assertEqual(self.client.get('/api/market/events/export?fromDate=20261026').status_code, 504)


if __name__ == '__main__':
    unittest.main()
