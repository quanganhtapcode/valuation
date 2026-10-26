"""Historical chart requests must not refetch bars already in SQLite."""
import unittest
from unittest.mock import patch

from backend.routes.market import valuation_chart as chart
from backend.routes.market.chart_payload import CHART_COLUMNS, compact_chart_payload


class IndexSnapshotPerformance(unittest.TestCase):
    def test_compact_chart_keeps_all_values_stats_and_original_payload(self):
        rows = [{column: ('2026-10-23' if column == 'date' else 12.345678901234)
                 for column in CHART_COLUMNS}]
        saved = {'success': True, 'data': rows, 'stats': {'pe': {'average': 12.3}}}
        compact = compact_chart_payload(saved)
        restored = [dict(zip(compact['columns'], row)) for row in compact['data']]
        self.assertEqual(restored, rows)
        self.assertEqual(compact['stats'], saved['stats'])
        self.assertIsInstance(saved['data'][0], dict)

    def test_complete_session_uses_sqlite_without_provider_call(self):
        saved = {'data': [{'date': '2026-10-23', 'vnindex': 1700}], 'stats': {}}
        with patch.object(chart, '_read_valuation_from_sqlite', return_value=saved), \
             patch.object(chart, 'expected_session_date', return_value='2026-10-23'), \
             patch.object(chart, '_fetch_vnindex_ohlc_series') as provider:
            result = chart.fetch_vci_index_valuation_payload()
        provider.assert_not_called()
        self.assertEqual(result['data'], saved['data'])

    def test_missing_session_still_patches_recent_bars(self):
        saved = {'data': [{'date': '2026-10-22', 'vnindex': 1700}], 'stats': {}}
        recent = [{'date': '2026-10-23', 'value': 1720, 'close': 1720}]
        with patch.object(chart, '_read_valuation_from_sqlite', return_value=saved), \
             patch.object(chart, 'expected_session_date', return_value='2026-10-23'), \
             patch.object(chart, '_fetch_vnindex_ohlc_series', return_value=recent) as provider:
            result = chart.fetch_vci_index_valuation_payload()
        provider.assert_called_once_with(count_back=5)
        self.assertEqual(result['data'][-1]['date'], '2026-10-23')

    def snapshot_client(self):
        from flask import Blueprint, Flask
        app = Flask(__name__)
        bp = Blueprint('snapshot_test', __name__)
        chart.register(bp)
        app.register_blueprint(bp)
        return app.test_client()

    def test_interactive_snapshot_never_waits_for_provider_even_when_stale(self):
        saved = {'data': [{'date': '2026-10-22', 'vnindex': 1700, 'pe': 12.345}], 'stats': {'pe': {'average': 12}}}
        with patch.object(chart, '_read_valuation_from_sqlite', return_value=saved), \
             patch.object(chart, 'expected_session_date', return_value='2026-10-23'), \
             patch.object(chart, 'fetch_vci_index_valuation_payload', side_effect=AssertionError('network path used')):
            response = self.snapshot_client().get('/pe-chart?snapshot=1&compact=1&timeFrame=1Y')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json['stale'])
        self.assertEqual(response.json['data_as_of'], '2026-10-22')
        self.assertEqual(response.json['source'], 'SQLite')
        self.assertEqual(response.json['stats'], saved['stats'])
        self.assertEqual(dict(zip(response.json['columns'], response.json['data'][0]))['pe'], 12.345)

    def test_empty_snapshot_is_uncached_and_does_not_call_external_provider(self):
        with patch.object(chart, '_read_valuation_from_sqlite', return_value=None), \
             patch.object(chart, 'fetch_vci_index_valuation_payload', side_effect=AssertionError('network path used')):
            response = self.snapshot_client().get('/pe-chart?snapshot=1')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
