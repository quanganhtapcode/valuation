import unittest
from unittest.mock import Mock, patch

from flask import Flask

from backend.routes.aliases import API_ALIASES, register_api_aliases
from backend.routes.downloads import download_bp
from backend.routes.health import health_bp
from backend.routes.market import market_bp
from backend.routes.stock import stock_bp


class CanonicalApiContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = Flask(__name__)
        cls.app.register_blueprint(stock_bp, url_prefix="/api")
        cls.app.register_blueprint(market_bp)
        cls.app.register_blueprint(download_bp)
        cls.app.register_blueprint(health_bp)
        register_api_aliases(cls.app)

    def test_aliases_preserve_wrapped_handlers_methods_and_parameters(self):
        rules = {rule.rule: rule for rule in self.app.url_map.iter_rules()}
        for canonical, legacy in API_ALIASES.items():
            with self.subTest(canonical=canonical):
                old, new = rules[legacy], rules[canonical]
                self.assertIs(self.app.view_functions[old.endpoint],
                              self.app.view_functions[new.endpoint])
                self.assertEqual(old.methods, new.methods)
                self.assertEqual(old.arguments, new.arguments)

    def test_short_financial_routes_preserve_older_validation(self):
        client = self.app.test_client()
        for short, previous in [
            ('/api/stocks/BAD!/financials', '/api/stocks/BAD!/financial-statements'),
            ('/api/stocks/BAD!/financials/fields', '/api/stocks/BAD!/financial-statements/fields'),
            ('/api/stocks/BAD!/metrics', '/api/stocks/BAD!/financial-metrics'),
        ]:
            with self.subTest(path=short):
                current, legacy = client.get(short), client.get(previous)
                self.assertEqual(current.status_code, 400)
                self.assertEqual(current.status_code, legacy.status_code)
                self.assertEqual(current.json, legacy.json)

    def test_metrics_collection_is_not_captured_as_a_stock_symbol(self):
        adapter = self.app.url_map.bind('localhost')
        endpoint, arguments = adapter.match('/api/stocks/metrics')
        legacy, _ = adapter.match('/api/stock/stats-financial')
        self.assertIs(self.app.view_functions[endpoint], self.app.view_functions[legacy])
        self.assertEqual(arguments, {})

    def test_news_alias_returns_identical_payload(self):
        payload = {"success": True, "data": [{"title": "Tin mới", "url": "https://example.com"}]}
        with patch("backend.routes.stock.news_events.cache_get", return_value=payload):
            client = self.app.test_client()
            legacy = client.get("/api/stock/VCB/news?compact=1")
            canonical = client.get("/api/stocks/VCB/news?compact=1")
        self.assertEqual(canonical.status_code, 200)
        self.assertEqual(canonical.json, legacy.json)

    def test_post_only_valuation_does_not_accept_get(self):
        response = self.app.test_client().get("/api/stocks/VCB/valuation")
        self.assertEqual(response.status_code, 405)

    def test_static_quote_collection_is_not_captured_as_stock_symbol(self):
        provider = Mock()
        provider.get_current_price_with_change.return_value = {"current_price": 1000}
        provider._stock_data_cache = {}
        with patch("backend.routes.stock.prices.get_provider", return_value=provider):
            response = self.app.test_client().get("/api/stocks/quotes?symbols=VCB")
        self.assertEqual(response.status_code, 200)
        self.assertIn("VCB", response.json)


if __name__ == "__main__":
    unittest.main()
