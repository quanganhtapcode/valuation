"""Cursor history pages must be bounded, exclusive, and work offline."""

import sqlite3
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from flask import Blueprint, Flask

from backend.routes.market import valuation_chart
from backend.services.api_contract import register_api_contract


class ValuationPaginationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        db = Path(self.directory.name) / "history.sqlite"
        self.dates = [(date(2024, 1, 1) + timedelta(days=i)).isoformat()
                      for i in range(603)]
        with sqlite3.connect(db) as conn:
            conn.execute("CREATE TABLE valuation_history (date TEXT PRIMARY KEY, "
                         "pe REAL, pb REAL, vnindex REAL, open REAL, high REAL, "
                         "low REAL, close REAL, ema50 REAL, volume REAL)")
            conn.executemany("INSERT INTO valuation_history VALUES "
                             "(?, 15.123456789, 2, 1500, 1490, 1510, 1480, 1500, 1450, 0)",
                             [(day,) for day in self.dates])
            # An entirely empty row must not consume a cursor slot.
            conn.execute("INSERT INTO valuation_history (date) VALUES ('2030-01-01')")
        self.patch = patch.object(valuation_chart, "_VALUATION_SQLITE", db)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        app = Flask(__name__)
        bp = Blueprint("history_test", __name__, url_prefix="/api/market")
        valuation_chart.register(bp)
        app.register_blueprint(bp)
        register_api_contract(app)
        self.client = app.test_client()

    def page(self, query=""):
        return self.client.get("/api/market/pe-chart?limit=250&snapshot=1" + query)

    def test_all_pages_are_exclusive_complete_and_ascending(self):
        collected = []
        before = None
        sizes = []
        with patch.object(valuation_chart.http_requests, "get",
                          side_effect=AssertionError("Must not call upstream")), \
                patch.object(valuation_chart.http_requests, "post",
                             side_effect=AssertionError("Must not call upstream")):
            while True:
                response = self.page("&before=" + before if before else "")
                self.assertEqual(response.status_code, 200)
                payload = response.json
                rows = payload["data"]
                dates = [row["date"] for row in rows]
                self.assertEqual(dates, sorted(dates))
                self.assertEqual(payload["data_as_of"], self.dates[-1])
                self.assertEqual(rows[0]["pe"], 15.123456789)
                self.assertEqual(rows[0]["volume"], 0)
                if before:
                    self.assertTrue(all(day < before for day in dates))
                collected = dates + collected
                sizes.append(len(rows))
                page = payload["pagination"]
                if not page["hasMore"]:
                    self.assertIsNone(page["nextBefore"])
                    break
                self.assertEqual(page["nextBefore"], dates[0])
                before = page["nextBefore"]
        self.assertEqual(sizes, [250, 250, 103])
        self.assertEqual(collected, self.dates)
        self.assertEqual(len(set(collected)), len(self.dates))

    def test_compact_schema_two_retains_cursor_metadata(self):
        response = self.page("&compact=1&schema=2")
        self.assertEqual(response.status_code, 200)
        payload = response.json
        row = dict(zip(payload["meta"]["columns"], payload["data"][0]))
        self.assertEqual(row["date"], self.dates[-250])
        self.assertEqual(row["pe"], 15.123456789)
        self.assertEqual(payload["meta"]["pagination"], {
            "hasMore": True, "nextBefore": self.dates[-250],
        })

    def test_empty_page_is_terminal(self):
        payload = self.page("&before=2024-01-01").json
        self.assertEqual(payload["data"], [])
        self.assertEqual(payload["pagination"], {"hasMore": False, "nextBefore": None})

    def test_invalid_parameters_fail_before_read(self):
        for query in ("limit=0", "limit=501", "limit=no", "limit=2&before=",
                      "limit=2&before=20240201", "limit=2&before=2024-02-30",
                      "limit=2&timeFrame=ALL", "limit=2&index=VN30"):
            with self.subTest(query=query):
                response = self.client.get("/api/market/pe-chart?" + query)
                self.assertEqual(response.status_code, 400)

    def test_missing_store_returns_retryable_error(self):
        with patch.object(valuation_chart, "_VALUATION_SQLITE", Path(self.directory.name) / "missing"):
            response = self.page()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(response.headers["Retry-After"], "30")

    def test_legacy_snapshot_keeps_existing_contract(self):
        response = self.client.get("/api/market/pe-chart?snapshot=1&timeFrame=ALL")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json["data"]), 603)
        self.assertNotIn("pagination", response.json)

    def test_empty_store_is_retryable_for_initial_page(self):
        with sqlite3.connect(valuation_chart._VALUATION_SQLITE) as conn:
            conn.execute("DELETE FROM valuation_history")
        self.assertEqual(self.page().status_code, 503)


if __name__ == "__main__":
    unittest.main()
