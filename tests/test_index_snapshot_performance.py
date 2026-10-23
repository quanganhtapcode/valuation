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
