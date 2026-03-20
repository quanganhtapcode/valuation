"""Tests for backend/services/source_priority.py"""
import pytest
from backend.services.source_priority import (
    _to_json_number,
    _normalize_percent_value,
    apply_source_priority,
    apply_peer_source_priority,
)


class TestToJsonNumber:
    def test_normal_value(self):
        assert _to_json_number(25.5) == 25.5

    def test_none_returns_default(self):
        assert _to_json_number(None) == 0.0
        assert _to_json_number(None, default=99.0) == 99.0

    def test_nan_returns_default(self):
        import math
        assert _to_json_number(float('nan')) == 0.0

    def test_inf_returns_default(self):
        assert _to_json_number(float('inf')) == 0.0

    def test_string_number(self):
        assert _to_json_number("12.5") == 12.5

    def test_invalid_string_returns_default(self):
        assert _to_json_number("abc") == 0.0


class TestNormalizePercentValue:
    def test_decimal_form_converted(self):
        # 0.28 → 28.0
        result = _normalize_percent_value(0.28)
        assert result == pytest.approx(28.0)

    def test_percentage_form_unchanged(self):
        # 28.27 → 28.27 (already in percent)
        result = _normalize_percent_value(28.27)
        assert result == pytest.approx(28.27)

    def test_boundary_value_one(self):
        # abs(v) <= 1 → multiply by 100
        assert _normalize_percent_value(1.0) == pytest.approx(100.0)
        assert _normalize_percent_value(-1.0) == pytest.approx(-100.0)

    def test_none_returns_none(self):
        assert _normalize_percent_value(None) is None

    def test_nan_returns_none(self):
        assert _normalize_percent_value(float('nan')) is None

    def test_zero(self):
        assert _normalize_percent_value(0.0) == pytest.approx(0.0)


class TestApplySourcePriority:
    def test_returns_copy_not_mutate(self):
        original = {'pe': 10, 'name': 'test'}
        result = apply_source_priority(original, 'VCB')
        assert result is not original

    def test_non_dict_returned_unchanged(self):
        assert apply_source_priority("not_a_dict", 'VCB') == "not_a_dict"

    def test_adds_source_priority_label(self):
        result = apply_source_priority({'pe': 5}, 'VCB')
        assert 'source_priority' in result

    def test_screening_overrides_pe_when_positive(self):
        """When screening has a positive PE, it should override DB value.
        Stats-financial is mocked empty so it doesn't override screening."""
        screening = {
            'pe': 15.5, 'pb': 2.1, 'roe': 18.0,
            'market_cap': 50000.0, 'source': 'vci_screening.sqlite',
            'gross_margin': None, 'revenue_growth': None,
            'net_margin': None, 'profit_growth': None,
        }
        data = {'pe': 5.0, 'pb': 1.0}

        def fake_cache_get(key):
            if 'screening_metrics_VCB' in key:
                return screening
            if 'stats_financial_VCB' in key:
                return {}   # empty dict — non-None prevents DB hit, falsy skips overlay
            return None

        result = apply_source_priority(data, 'VCB', cache_get=fake_cache_get)
        assert result['pe'] == pytest.approx(15.5)
        assert result['pe_ratio'] == pytest.approx(15.5)


class TestApplyPeerSourcePriority:
    def test_no_screening_returns_copy_with_label(self):
        peer = {'pe': 10, 'symbol': 'ACB'}
        result = apply_peer_source_priority(peer, None)
        assert result is not peer
        assert result['pe'] == 10
        assert 'source_priority' in result

    def test_screening_overrides_pe_pb(self):
        peer = {'pe': 10, 'pb': 1.5}
        screening = {'pe': 12.0, 'pb': 2.0, 'source': 'vci_screening.sqlite'}
        result = apply_peer_source_priority(peer, screening)
        assert result['pe'] == 12.0
        assert result['pb'] == 2.0

    def test_screening_sets_source_label(self):
        peer = {}
        screening = {'pe': 8.0, 'source': 'vci_screening.sqlite'}
        result = apply_peer_source_priority(peer, screening)
        assert result['fresh_metrics_source'] == 'vci_screening.sqlite'
        assert 'source_priority' in result

    def test_stats_financial_overrides_screening(self):
        peer = {'pe': 10, 'pb': 1.5}
        screening = {'pe': 12.0, 'pb': 2.0, 'source': 'vci_screening.sqlite'}
        stats_fin = {'pe': 14.0, 'pb': 2.5, 'roa': 8.0, 'source': 'vci_stats_financial.sqlite'}
        result = apply_peer_source_priority(peer, screening, stats_fin)
        assert result['pe'] == 14.0
        assert result['pb'] == 2.5
        assert result['roa'] == 8.0
        assert result['fresh_metrics_source'] == 'vci_stats_financial.sqlite'
