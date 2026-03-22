"""Smoke tests for Flask routes — no real DB or external APIs required."""
import sys
import os
import json
import sqlite3
import pytest
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ---------------------------------------------------------------------------
# App factory that skips real DB/VCI initialisation
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def app():
    """Create Flask test app with all heavy I/O mocked out."""
    mock_vnstock = MagicMock()

    with (
        patch("backend.models.Vnstock", return_value=mock_vnstock),
        patch("backend.extensions.StockDataProvider", MagicMock()),
        patch("backend.extensions.FinancialRepository", MagicMock()),
        patch("backend.extensions.ValuationService", MagicMock()),
        patch("backend.extensions.FinancialService", MagicMock()),
        patch("backend.extensions.StockService", MagicMock()),
        patch("backend.extensions.SQLiteDB", MagicMock()),
        patch("backend.extensions.resolve_stocks_db_path", return_value="/tmp/fake.db"),
        patch("backend.data_sources.vci.VCIClient", MagicMock()),
        patch("backend.telemetry.record_request_latency", MagicMock()),
    ):
        from backend.server import app as flask_app
        flask_app.config["TESTING"] = True
        flask_app.config["WTF_CSRF_ENABLED"] = False
        yield flask_app


@pytest.fixture
def client(app):
    return app.test_client()


# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------

class TestHealthEndpoint:
    def test_health_returns_json(self, client):
        resp = client.get("/health")
        assert resp.status_code in (200, 207)
        data = resp.get_json()
        assert "status" in data
        assert "checks" in data

    def test_health_has_timestamp(self, client):
        resp = client.get("/health")
        data = resp.get_json()
        assert "timestamp" in data

    def test_health_status_string(self, client):
        resp = client.get("/health")
        data = resp.get_json()
        # Valid statuses: ok, warn, degraded, error
        assert data["status"] in ("ok", "warn", "degraded", "error")


# ---------------------------------------------------------------------------
# /api/stock/<symbol>  — routes registered at /api prefix
# ---------------------------------------------------------------------------

class TestStockEndpoint:
    def test_stock_route_registered(self, client):
        """Route exists — returns JSON (may be 404/500 with mocked DB, not HTML)."""
        resp = client.get("/api/stock/VCB")
        assert "application/json" in resp.content_type

    def test_stock_returns_json_body(self, client):
        resp = client.get("/api/stock/VCB")
        data = resp.get_json()
        assert data is not None


# ---------------------------------------------------------------------------
# /api/current-price/<symbol>
# ---------------------------------------------------------------------------

class TestCurrentPriceEndpoint:
    def test_current_price_endpoint_registered(self, client):
        """Route is registered — returns JSON response."""
        resp = client.get("/api/current-price/VCB")
        assert "application/json" in resp.content_type

    def test_current_price_returns_json_body(self, client):
        resp = client.get("/api/current-price/VCB")
        assert resp.get_json() is not None

    @patch("backend.routes.stock.prices.get_provider")
    def test_current_price_keeps_low_vci_ram_price_unscaled(self, mock_get_provider, client):
        provider = MagicMock()
        provider._stock_data_cache = {"CPH": {"shares_outstanding": None}}
        provider.get_current_price_with_change.return_value = {
            "current_price": 300,
            "price_change": 0,
            "price_change_percent": 0,
            "source": "VCI_RAM",
            "open": 0,
            "high": 0,
            "low": 0,
            "volume": 0,
            "ceiling": 400,
            "floor": 200,
            "ref_price": 300,
        }
        mock_get_provider.return_value = provider

        resp = client.get("/api/current-price/CPH")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["current_price"] == 300


# ---------------------------------------------------------------------------
# 404 for unknown routes
# ---------------------------------------------------------------------------

class TestUnknownRoutes:
    def test_unknown_route_returns_404(self, client):
        resp = client.get("/this-route-does-not-exist-xyz")
        assert resp.status_code == 404
