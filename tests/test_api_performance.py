"""Offline checks for bounded caches and lean market request paths."""
import datetime as dt
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Blueprint, Flask

from backend.routes.market import news, overview, prices
from backend.routes.stock import companies, cache
from backend.services import vci_news_sqlite
from backend.sqlite_utils import read_connection
from scripts.fetchers.fetch_vci_market_news import ensure_schema, upsert_items


class PriceSelectionTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        bp = Blueprint("price_performance", __name__)
        prices.register(bp)
        app.register_blueprint(bp)
        self.client = app.test_client()
        refresh = patch.object(prices.VCIClient, "ensure_background_refresh")
        refresh.start()
        self.addCleanup(refresh.stop)

    def test_filtered_quotes_never_scan_full_market(self):
        class DirectLookupOnly(dict):
            def items(self):
                raise AssertionError("Filtered requests must use direct symbol lookup")

        cache = DirectLookupOnly(VCB={"c": 105, "ref": 100}, FPT={"c": 200, "ref": 200})
        with patch.object(prices.VCIClient, "_price_cache", cache):
            for route in ("prices", "orderbook"):
                response = self.client.get(f"/{route}?symbols=vcb,VCB,missing")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(list(response.json), ["VCB"])
            response = self.client.get("/prices?symbols=VCB&include_orderbook=TRUE")
        self.assertEqual(response.json["VCB"]["changePercent"], 5)
        self.assertEqual(len(response.json["VCB"]["orderbook"]["bid"]), 3)

    def test_all_quotes_remain_available_and_numbers_are_finite(self):
        cache = {"VCB": {"c": 105, "ref": 100}, "FPT": {"c": 200, "ref": 200}}
        with patch.object(prices.VCIClient, "_price_cache", cache):
            self.assertEqual(set(self.client.get("/prices").json), set(cache))
        for value in ("NaN", float("inf"), float("-inf"), None, "bad"):
            with self.subTest(value=value):
                self.assertEqual(prices._to_float(value), 0)


class CompactNewsTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "news.sqlite"
        self.item = {
            "id": "one", "ticker": "VCB", "news_title": "Vietnam market",
            "news_source_link": "https://example.com/article",
            "news_from_name": "Source", "news_short_content": "Summary",
            "update_date": "2026-10-18T12:00:00+07:00", "score": 0,
        }
        with sqlite3.connect(self.path) as conn:
            ensure_schema(conn)
            upsert_items(conn, [self.item], fetched_at_utc="2026-10-18T05:00:00Z")

    def test_projection_matches_legacy_card_without_decoding_raw_json(self):
        expected = vci_news_sqlite.compact_news_item(self.item)
        queries = []
        with read_connection(self.path) as conn:
            conn.set_trace_callback(queries.append)
            with patch.object(vci_news_sqlite, "read_connection") as reader, \
                 patch.object(vci_news_sqlite.json, "loads", side_effect=AssertionError("Unexpected JSON decode")):
                reader.return_value.__enter__.return_value = conn
                self.assertEqual(vci_news_sqlite.query_market_news(str(self.path), compact=True), [expected])
                self.assertEqual(vci_news_sqlite.query_news_for_symbol(str(self.path), "vcb", compact=True), [expected])
        self.assertTrue(queries)
        self.assertTrue(all("raw_json" not in query for query in queries))

    def test_old_raw_only_snapshot_keeps_compact_support(self):
        legacy = self.path.with_name("legacy.sqlite")
        with sqlite3.connect(legacy) as conn:
            conn.execute("CREATE TABLE news_items(ticker, update_date, raw_json)")
            conn.execute("INSERT INTO news_items VALUES (?, ?, ?)",
                         ("VCB", self.item["update_date"], json.dumps(self.item)))
        expected = [vci_news_sqlite.compact_news_item(self.item)]
        self.assertEqual(vci_news_sqlite.query_market_news(str(legacy), compact=True), expected)
        self.assertEqual(vci_news_sqlite.query_news_for_symbol(str(legacy), "VCB", compact=True), expected)

    def test_empty_initialized_page_never_requests_upstream(self):
        stamp = dt.datetime.now(dt.timezone.utc).isoformat()
        with sqlite3.connect(self.path) as conn:
            conn.execute("INSERT INTO news_meta VALUES ('last_fetch_utc', ?)", (stamp,))
        app = Flask(__name__)
        bp = Blueprint("news_performance", __name__)
        news.register(bp)
        app.register_blueprint(bp)
        with patch.object(news, "default_news_db_path", return_value=str(self.path)), \
             patch.object(news.NewsService, "fetch_news") as upstream:
            response = app.test_client().get("/news?page=2&size=50&compact=1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {"success": True, "data": []})
        self.assertEqual(response.headers["X-Cache"], "SQLITE")
        self.assertEqual(response.headers["X-News-Stale"], "0")
        upstream.assert_not_called()

    def test_invalid_pagination_is_client_error_before_data_access(self):
        app = Flask(__name__)
        bp = Blueprint("news_validation", __name__)
        news.register(bp)
        app.register_blueprint(bp)
        with patch.object(news, "query_market_news") as query:
            for path in ("/news?page=bad", "/news?size=bad"):
                self.assertEqual(app.test_client().get(path).status_code, 400)
        query.assert_not_called()

    def test_overview_compact_omits_duplicate_chart_and_uses_separate_news_cache(self):
        app = Flask(__name__)
        bp = Blueprint("overview_compact", __name__)
        overview.register(bp)
        app.register_blueprint(bp)
        keys = []

        def fetch(key, ttl, producer):
            keys.append(key)
            return producer(), False

        with patch.object(overview, "cache_func", return_value=fetch), \
             patch.object(overview, "_fetch_watchlist_prices", return_value={}), \
             patch.object(overview, "_fetch_pe_chart", return_value={"points": [1]}), \
             patch.object(overview, "_fetch_heatmap", return_value={"sectors": []}), \
             patch.object(overview, "default_news_db_path", return_value=str(self.path)):
            full = app.test_client().get("/overview-refresh").json
            compact = app.test_client().get("/overview-refresh?compact=1").json
        self.assertIn("peChart", full)
        self.assertNotIn("peChart", compact)
        self.assertEqual(compact["indexValuationChart"], full["peChart"])
        self.assertEqual(compact["news"], [vci_news_sqlite.compact_news_item(self.item)])
        self.assertIn("overview_refresh_news_30_full", keys)
        self.assertIn("overview_refresh_news_30_compact", keys)


class ResponseCacheTests(unittest.TestCase):
    def setUp(self):
        cache._cache.clear()
        self.addCleanup(cache._cache.clear)

    def test_live_unique_requests_cannot_exceed_capacity(self):
        with patch.object(cache, "_CACHE_MAX_ENTRIES", 3):
            for i in range(10):
                cache._cache_set(str(i), [i])
            self.assertEqual(len(cache._cache), 3)
            self.assertIsNone(cache._cache_get("0"))
            self.assertEqual(cache._cache_get("9"), [9])
            cache._cache_set("9", [99])
            self.assertEqual(len(cache._cache), 3)
            self.assertEqual(cache._cache_get("7"), [7])

    def test_expired_entries_are_removed_on_read(self):
        with patch.object(cache._time, "monotonic", return_value=1):
            cache._cache_set("empty", [])
        with patch.object(cache._time, "monotonic", return_value=1000):
            self.assertIsNone(cache._cache_get("empty"))
        self.assertNotIn("empty", cache._cache)

    def test_empty_company_search_is_cached(self):
        app = Flask(__name__)
        bp = Blueprint("cached_search", __name__)
        companies.register(bp)
        app.register_blueprint(bp)
        with patch.object(companies, "get_stock_service") as service:
            service.return_value.search_stocks.return_value = []
            for _ in range(2):
                self.assertEqual(app.test_client().get("/companies/search?q=missing").json, [])
            service.return_value.search_stocks.assert_called_once_with("missing", 20)


if __name__ == "__main__":
    unittest.main()
