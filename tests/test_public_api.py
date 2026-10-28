"""Contract checks without starting provider streams or contacting upstreams."""

import json
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch

import requests
from flask import Flask, jsonify

from backend.routes.public_resources import public_resources_bp
from backend.services.api_http import cache_policy, register_api_http
from backend.services.polymarket_selection import select_polymarket_events


class PublicApiTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.register_blueprint(public_resources_bp)
        register_api_http(self.app)
        self.client = self.app.test_client()

    def test_field_codes_and_compatibility(self):
        bodies = []
        for path in ("/api/financials/fields", "/api/financial-statements/fields", "/api/financial-field-codes"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn("INCOME_STATEMENT", response.get_json())
            self.assertIn("max-age=86400", response.headers["Cache-Control"])
            bodies.append(response.data)
            response.close()
        self.assertTrue(all(body == bodies[0] for body in bodies))

    @patch("backend.routes.public_resources.cache_get_ns", return_value={"profile": "Tiếng Việt", "enProfile": "English"})
    @patch("backend.routes.public_resources.requests.get")
    def test_profile_language_isolation(self, upstream, cache):
        self.assertEqual(self.client.get("/api/companies/VCB/description?lang=vi").json["profile"], "Tiếng Việt")
        self.assertEqual(self.client.get("/api/companies/VCB/description?lang=en").json["profile"], "English")
        upstream.assert_not_called()

    @patch("backend.routes.public_resources.cache_get_ns", return_value=None)
    @patch("backend.routes.public_resources.cache_set_ns")
    @patch("backend.routes.public_resources.requests.get", side_effect=requests.Timeout())
    def test_upstream_failure_is_not_cached(self, upstream, save, cache):
        profile = self.client.get("/api/companies/VCB/description")
        self.assertFalse(profile.json["available"])
        self.assertEqual(profile.headers["Cache-Control"], "no-store")
        events = self.client.get("/api/market/polymarket-events")
        self.assertEqual(events.status_code, 502)
        self.assertEqual(events.headers["Cache-Control"], "no-store")
        save.assert_not_called()

    @patch("backend.routes.public_resources.cache_get_ns", return_value=None)
    @patch("backend.routes.public_resources.cache_set_ns")
    @patch("backend.routes.public_resources.requests.get")
    def test_polymarket_deduplicates_and_caches_success(self, upstream, save, cache):
        upstream.side_effect = [
            Mock(json=lambda: [{"id": "1", "title": "Fed"}]),
            Mock(json=lambda: [{"id": "1", "title": "Fed"}, {"id": "2", "title": "GDP"}]),
        ]
        response = self.client.get("/api/market/polymarket-events")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in response.json], ["1", "2"])
        self.assertIn("s-maxage=300", response.headers["Cache-Control"])
        self.assertEqual(save.call_args.args[-1], 300)

    def test_live_data_exports_errors_and_mutations_are_not_cached(self):
        for route, query in (
            ("/api/stocks/<symbol>/quote", {}),
            ("/api/stock/<symbol>/current-price", {}),
            ("/api/exports/financials", {}),
            ("/api/workbooks", {}),
            ("/api/stocks/<symbol>/summary", {}),
            ("/api/stocks/<symbol>/summary", {"realtime": "0", "cache": "no-store"}),
            ("/api/unknown", {}),
        ):
            with self.subTest(route=route, query=query):
                self.assertEqual(cache_policy(route, query), "no-store")

        @self.app.route("/api/stocks/<symbol>/valuation", methods=["GET", "POST"])
        def valuation(symbol):
            return jsonify(success=True)

        @self.app.get("/api/stocks/<symbol>/news")
        def news(symbol):
            return jsonify(error="Unavailable"), 503

        self.assertEqual(self.client.post("/api/stocks/VCB/valuation").headers["Cache-Control"], "no-store")
        self.assertEqual(self.client.get("/api/stocks/VCB/news").headers["Cache-Control"], "no-store")

    def test_canonical_and_legacy_cache_contracts(self):
        aliases = json.loads((Path(__file__).resolve().parents[1] / "frontend-next/src/lib/apiRouteAliases.json").read_text())
        for canonical, legacy in aliases.items():
            for query in ({}, {"snapshot": "1"}, {"realtime": "0"}, {"pretty": "1"}):
                with self.subTest(canonical=canonical, query=query):
                    self.assertEqual(cache_policy(canonical, query), cache_policy(legacy, query))
        self.assertIn("s-maxage=5", cache_policy("/api/stock/history/<symbol>", {"snapshot": "1"}))
        self.assertIn("s-maxage=120", cache_policy("/api/stocks/<symbol>/summary", {"realtime": "0"}))

    def test_compact_events_choose_current_contracts_and_valid_outcomes(self):
        def event(identifier, title, volume, probability="0.75", end="2026-12-01T00:00:00Z"):
            return {"id": identifier, "title": title, "slug": f"event-{identifier}", "volume": volume,
                    "endDate": end, "markets": [{"active": True, "closed": False,
                    "outcomes": '["No", "Yes"]', "outcomePrices": '["0.25", "' + probability + '"]',
                    "oneDayPriceChange": 0.02}]}
        payload = [
            event(1, "Gold in September 2026", 9999),
            event(2, "Gold in October 2026", 100),
            event(3, "Gold in November 2026", 999),
            event(4, "Fed rate cuts in 2026", 9999),
            event(5, "Fed decision in October 2026", 50),
            event(6, "2-year treasury yield in October 2026", 9999),
            event(7, "10-year treasury yield in October 2026", 50, "invalid"),
        ]
        result = select_polymarket_events(payload, datetime(2026, 10, 28, tzinfo=timezone.utc))
        self.assertEqual([event["id"] for event in result], ["5", "7", "2"])
        self.assertEqual(result[0]["outcomes"][0]["probability"], 75)
        self.assertEqual(result[0]["outcomes"][0]["change"], 2)
        self.assertNotIn("probability", result[1]["outcomes"][0])

    def test_compact_events_exclude_closed_expired_and_untradeable_markets(self):
        payload = [{"id": 1, "title": "GDP", "slug": "gdp", "markets": [
            {"active": True, "closed": True},
            {"active": True, "acceptingOrders": False},
            {"active": True, "endDate": "2020-01-01T00:00:00Z"},
        ]}]
        self.assertEqual(select_polymarket_events(payload), [])


if __name__ == "__main__":
    unittest.main()
