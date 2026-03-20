"""Tests for pure data-processing methods in backend/models.py (no external API calls)."""
import sys
import os
import pytest
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import only the class — __init__ calls Vnstock() so we patch it out
from unittest.mock import patch, MagicMock


@pytest.fixture
def model(monkeypatch):
    """ValuationModels instance with Vnstock stubbed out."""
    mock_vnstock = MagicMock()
    with patch("backend.models.Vnstock", return_value=mock_vnstock):
        from backend.models import ValuationModels
        m = ValuationModels(
            stock_data={"eps": 3000, "bvps": 20000, "shares_outstanding": 1_000_000_000},
        )
    return m


# ==================== find_financial_value ====================

class TestFindFinancialValue:
    def _df(self, columns, rows):
        return pd.DataFrame(rows, columns=columns)

    def test_returns_latest_year_value(self, model):
        df = self._df(["Net Profit For the Year"], [[500_000]])
        assert model.find_financial_value(df, ["Net Profit For the Year"]) == pytest.approx(500_000)

    def test_returns_zero_for_empty_df(self, model):
        df = pd.DataFrame()
        assert model.find_financial_value(df, ["Net Profit For the Year"]) == 0

    def test_sums_quarterly_values(self, model):
        df = self._df(["Net Profit For the Year"], [[100_000], [200_000], [150_000], [50_000]])
        result = model.find_financial_value(df, ["Net Profit For the Year"], is_quarterly=True)
        assert result == pytest.approx(500_000)

    def test_column_with_unit_suffix_stripped(self, model):
        # Column name "Revenue (Bn. VND)" should match target "revenue"
        df = self._df(["Revenue (Bn. VND)"], [[1_000_000]])
        assert model.find_financial_value(df, ["Revenue"]) == pytest.approx(1_000_000)

    def test_missing_column_returns_zero(self, model):
        df = self._df(["SomeOtherColumn"], [[999]])
        assert model.find_financial_value(df, ["Net Profit For the Year"]) == 0

    def test_all_nan_returns_zero(self, model):
        import numpy as np
        df = self._df(["Net Profit For the Year"], [[np.nan]])
        assert model.find_financial_value(df, ["Net Profit For the Year"]) == 0

    def test_first_match_wins(self, model):
        """When multiple alias candidates listed, first match wins."""
        df = pd.DataFrame({"Revenue": [1_000], "Total Revenue": [2_000]})
        result = model.find_financial_value(df, ["Revenue", "Total Revenue"])
        assert result == pytest.approx(1_000)


# ==================== check_data_frequency ====================

class TestCheckDataFrequency:
    def test_quarterly_returns_4_rows(self, model):
        df = pd.DataFrame({
            "yearReport": [2024, 2024, 2024, 2024, 2023],
            "lengthReport": [4, 3, 2, 1, 4],
            "value": [1, 2, 3, 4, 5],
        })
        freq, result = model.check_data_frequency(df, "quarter")
        assert freq == "quarter"
        assert len(result) == 4

    def test_yearly_returns_1_row(self, model):
        df = pd.DataFrame({
            "yearReport": [2024, 2023, 2022],
            "lengthReport": [4, 4, 4],
            "value": [10, 20, 30],
        })
        freq, result = model.check_data_frequency(df, "year")
        assert freq == "year"
        assert len(result) == 1
        assert result.iloc[0]["yearReport"] == 2024

    def test_db_format_quarter(self, model):
        """Test snake_case DB format (year + quarter columns)."""
        df = pd.DataFrame({
            "year": [2024, 2024, 2024, 2024, 2023],
            "quarter": [4, 3, 2, 1, 4],
            "value": [10, 20, 30, 40, 50],
        })
        freq, result = model.check_data_frequency(df, "quarter")
        assert freq == "quarter"
        assert len(result) == 4

    def test_db_format_year(self, model):
        """Test snake_case DB format year extraction (quarter == 4)."""
        df = pd.DataFrame({
            "year": [2024, 2024, 2023],
            "quarter": [4, 2, 4],
            "value": [100, 50, 90],
        })
        freq, result = model.check_data_frequency(df, "year")
        assert freq == "year"
        assert result.iloc[0]["year"] == 2024
        assert result.iloc[0]["quarter"] == 4


# ==================== calculate_all_models weighted average ====================

class TestCalculateAllModelsWeighting:
    def test_weighted_average_equal_weights(self, model):
        """All 4 models valid with equal 0.25 weight → simple mean."""
        model.calculate_fcfe = lambda a: {"shareValue": 40_000}
        model.calculate_fcff = lambda a, **kw: {"shareValue": 60_000}
        model.calculate_justified_pe = lambda a, **kw: 50_000
        model.calculate_justified_pb = lambda a, **kw: 30_000

        assumptions = {"model_weights": {"fcfe": 0.25, "fcff": 0.25, "justified_pe": 0.25, "justified_pb": 0.25}}
        result = model.calculate_all_models(assumptions)
        expected = (40_000 + 60_000 + 50_000 + 30_000) / 4
        assert result["weighted_average"] == pytest.approx(expected)

    def test_bank_sector_uses_pe_pb_only(self, model):
        """Bank sector: FCFE/FCFF weights zero → only P/E + P/B used."""
        model.calculate_fcfe = lambda a: {"shareValue": 100_000}
        model.calculate_fcff = lambda a, **kw: {"shareValue": 100_000}
        model.calculate_justified_pe = lambda a, **kw: 40_000
        model.calculate_justified_pb = lambda a, **kw: 60_000
        model.stock_data = {"sector": "Ngân hàng", "shares_outstanding": 1_000_000_000}

        result = model.calculate_all_models({}, known_sector="Ngân hàng")
        assert result["weighted_average"] == pytest.approx(50_000)
        assert result.get("is_bank") is True

    def test_zero_model_value_excluded(self, model):
        """Models returning 0 must not skew the weighted average."""
        model.calculate_fcfe = lambda a: {"shareValue": 0}
        model.calculate_fcff = lambda a, **kw: {"shareValue": 0}
        model.calculate_justified_pe = lambda a, **kw: 50_000
        model.calculate_justified_pb = lambda a, **kw: 50_000

        assumptions = {"model_weights": {"fcfe": 0.25, "fcff": 0.25, "justified_pe": 0.25, "justified_pb": 0.25}}
        result = model.calculate_all_models(assumptions)
        assert result["weighted_average"] == pytest.approx(50_000)
        assert result["summary"]["models_used"] == 2

    def test_all_models_zero_returns_zero(self, model):
        model.calculate_fcfe = lambda a: 0
        model.calculate_fcff = lambda a, **kw: 0
        model.calculate_justified_pe = lambda a, **kw: 0
        model.calculate_justified_pb = lambda a, **kw: 0

        result = model.calculate_all_models({})
        assert result["weighted_average"] == 0
