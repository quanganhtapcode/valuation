"""Tests for the batch previous quantities query in stock_routes.py"""
import sqlite3
import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.routes.stock_routes import _batch_previous_quantities, _compute_change_pct


@pytest.fixture
def holders_db():
    """In-memory SQLite DB with shareholders + officers tables for testing."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE shareholders (
            symbol TEXT, share_holder TEXT, quantity REAL, update_date TEXT
        );
        CREATE TABLE officers (
            symbol TEXT, officer_name TEXT, quantity REAL, update_date TEXT
        );
        INSERT INTO shareholders VALUES ('VCB', 'State Bank', 1000000, '2024-01-01');
        INSERT INTO shareholders VALUES ('VCB', 'State Bank', 900000,  '2023-06-01');
        INSERT INTO shareholders VALUES ('VCB', 'State Bank', 800000,  '2023-01-01');
        INSERT INTO shareholders VALUES ('VCB', 'Foreign Fund', 500000, '2024-01-01');
        INSERT INTO shareholders VALUES ('VCB', 'Foreign Fund', 400000, '2023-06-01');
        INSERT INTO officers VALUES ('VCB', 'CEO Nguyen', 50000, '2024-01-01');
        INSERT INTO officers VALUES ('VCB', 'CEO Nguyen', 40000, '2023-06-01');
    """)
    yield conn
    conn.close()


class TestBatchPreviousQuantities:
    def test_returns_previous_quantity(self, holders_db):
        result = _batch_previous_quantities(
            holders_db, 'shareholders', 'VCB', 'share_holder',
            [('State Bank', '2024-01-01')]
        )
        # Most recent row before 2024-01-01 is 2023-06-01 with 900000
        assert result['State Bank'] == pytest.approx(900000)

    def test_batch_multiple_holders(self, holders_db):
        result = _batch_previous_quantities(
            holders_db, 'shareholders', 'VCB', 'share_holder',
            [('State Bank', '2024-01-01'), ('Foreign Fund', '2024-01-01')]
        )
        assert result['State Bank'] == pytest.approx(900000)
        assert result['Foreign Fund'] == pytest.approx(400000)

    def test_no_previous_record_returns_missing_key(self, holders_db):
        result = _batch_previous_quantities(
            holders_db, 'shareholders', 'VCB', 'share_holder',
            [('State Bank', '2022-01-01')]  # Before any record
        )
        assert 'State Bank' not in result  # No prior data

    def test_empty_input_returns_empty(self, holders_db):
        result = _batch_previous_quantities(
            holders_db, 'shareholders', 'VCB', 'share_holder', []
        )
        assert result == {}

    def test_officers_table(self, holders_db):
        result = _batch_previous_quantities(
            holders_db, 'officers', 'VCB', 'officer_name',
            [('CEO Nguyen', '2024-01-01')]
        )
        assert result['CEO Nguyen'] == pytest.approx(40000)


class TestComputeChangePct:
    def test_positive_change(self):
        assert _compute_change_pct(1100, 1000) == pytest.approx(10.0)

    def test_negative_change(self):
        assert _compute_change_pct(900, 1000) == pytest.approx(-10.0)

    def test_no_prev_returns_none(self):
        assert _compute_change_pct(1000, None) is None

    def test_zero_prev_returns_none(self):
        assert _compute_change_pct(1000, 0) is None

    def test_zero_current(self):
        assert _compute_change_pct(0, 1000) == pytest.approx(-100.0)
