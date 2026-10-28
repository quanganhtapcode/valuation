import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Blueprint, Flask, jsonify
from flask_compress import Compress

from backend.routes.stock.ai_analysis import register as register_ai
from backend.routes.stock.technical import _resolve_timeframe
from backend.services.api_http import register_api_http
from backend.services.api_payloads import column_history, compact_technical, project_field_codes


class ApiPayloadTests(unittest.TestCase):
    def test_history_columns_preserve_precision_zeroes_and_metadata(self):
        row = {"date": "2026-10-27", "open": 12345.678901, "high": 13000,
               "low": 12000, "close": 12345.678902, "volume": 0}
        original = {"success": True, "data": [row], "source": "sqlite", "latest_date": row["date"]}
        compact = column_history(original)
        decoded = dict(zip(compact["columns"], compact["data"][0]))
        self.assertEqual(decoded, row)
        self.assertEqual(compact["source"], original["source"])
        self.assertEqual(original["data"], [row])

    def test_fields_project_sections_labels_and_distinct_full_titles(self):
        row = {"field": "bsa1", "level": 1, "name": "BSA1", "parent": None,
               "titleVi": "Tài sản", "fullTitleVi": "Tài sản",
               "titleEn": "Assets", "fullTitleEn": "Current assets"}
        original = {"BALANCE_SHEET": [row], "NOTE": [{"field": "nob1"}]}
        compact = project_field_codes(original, "balance_sheet", True, None)
        self.assertEqual(list(compact), ["BALANCE_SHEET"])
        projected = compact["BALANCE_SHEET"][0]
        self.assertNotIn("parent", projected)
        self.assertNotIn("name", projected)
        self.assertNotIn("fullTitleVi", projected)
        self.assertEqual(projected["fullTitleEn"], "Current assets")
        labels = project_field_codes(original, "BALANCE_SHEET", True, "field,titleVi,titleEn")
        self.assertEqual(labels["BALANCE_SHEET"][0], {"field": "bsa1", "titleVi": "Tài sản", "titleEn": "Assets"})
        self.assertEqual(project_field_codes(original, None, False, None), original)
        with self.assertRaises(ValueError):
            project_field_codes(original, "unknown", True, None)
        with self.assertRaises(ValueError):
            project_field_codes(original, None, True, "unknown")

    def test_short_timeframes_and_technical_metadata(self):
        app = Flask(__name__)
        for short, full in (("1h", "ONE_HOUR"), ("1d", "ONE_DAY"), ("1w", "ONE_WEEK")):
            with app.test_request_context(f"/?timeframe={short}"):
                self.assertEqual(_resolve_timeframe(None), full)
            with app.test_request_context("/"):
                self.assertEqual(_resolve_timeframe(full), full)
        with app.test_request_context("/?timeframe=1s"):
            with self.assertRaises(ValueError):
                _resolve_timeframe(None)
        raw = {"success": True, "symbol": "VCB", "timeframe": "ONE_DAY", "traceId": "debug",
               "code": 200, "msg": None, "fetched_at_utc": "2026-10-27", "data": {"price": 0}}
        compact = compact_technical(raw)
        self.assertEqual(compact["data"], raw["data"])
        self.assertEqual(compact["fetched_at_utc"], raw["fetched_at_utc"])
        self.assertNotIn("traceId", compact)

    def test_etag_304_with_compression_and_live_cache_exclusion(self):
        app = Flask(__name__)
        register_api_http(app)
        Compress(app)

        @app.get("/api/stocks/<symbol>/summary")
        def summary(symbol):
            return jsonify(symbol=symbol, text="unchanged" * 300)

        @app.get("/api/stocks/<symbol>/quote")
        def quote(symbol):
            return jsonify(price=100, symbol=symbol)

        client = app.test_client()
        headers = {"Accept-Encoding": "gzip"}
        first = client.get("/api/stocks/VCB/summary?realtime=0", headers=headers)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.headers["Content-Encoding"], "gzip")
        etag = first.headers["ETag"]
        unchanged = client.get("/api/stocks/VCB/summary?realtime=0", headers={**headers, "If-None-Match": etag})
        self.assertEqual(unchanged.status_code, 304)
        self.assertEqual(unchanged.data, b"")
        fresh = client.get("/api/stocks/VCB/quote", headers={"If-None-Match": "*"})
        self.assertEqual(fresh.status_code, 200)
        self.assertNotIn("ETag", fresh.headers)

    def test_ai_objects_remove_duplicate_text_without_breaking_old_clients(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ai.sqlite"
            with sqlite3.connect(path) as conn:
                conn.execute("CREATE TABLE ai_financial_analysis (ticker, year_report, quarter_report, analysis_vi, analysis_json, news_json, model, generated_at)")
                conn.execute("INSERT INTO ai_financial_analysis VALUES (?,?,?,?,?,?,?,?)", (
                    "VCB", 2026, 3, "duplicate narrative " * 200, json.dumps({"value": 1.123456789}),
                    json.dumps({"title": "Tin tức"}), "model", "2026-10-27"))
            conn.close()
            app = Flask(__name__)
            blueprint = Blueprint("test_ai", __name__)
            register_ai(blueprint)
            app.register_blueprint(blueprint, url_prefix="/api")
            with patch("backend.routes.stock.ai_analysis.resolve_valuation_cache_db_path", return_value=str(path)):
                client = app.test_client()
                full = client.get("/api/VCB/ai-analysis")
                compact = client.get("/api/VCB/ai-analysis?compact=1")
            self.assertIn("analysis_vi", full.json)
            self.assertNotIn("analysis_vi", compact.json)
            self.assertEqual(json.loads(full.json["analysis_json"]), compact.json["analysis"])
            self.assertEqual(json.loads(full.json["news_json"]), compact.json["news"])
            self.assertEqual(compact.json["ticker"], "VCB")
            self.assertLess(len(compact.data), len(full.data))


if __name__ == "__main__":
    unittest.main()
