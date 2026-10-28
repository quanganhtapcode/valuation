import gzip
import json
import unittest
from pathlib import Path

from flask import Flask, Response, jsonify
from flask_compress import Compress

from backend.services.api_contract import register_api_contract, structured_response
from backend.services.api_http import register_api_http

FIXTURES = json.loads((Path(__file__).parent / "fixtures/api_contract.json").read_text())


class ApiContractTests(unittest.TestCase):
    def test_shared_wire_contract_and_preserved_values(self):
        for case in FIXTURES:
            with self.subTest(name=case["name"]):
                envelope, shape = structured_response(case["payload"], case["route"], case["status"])
                self.assertEqual(envelope, case["envelope"])
                self.assertEqual(shape, case["shape"])
                self.assertEqual(set(envelope) & {"data", "error"}, {"error"} if case["status"] >= 400 else {"data"})
                self.assertNotIn("success", envelope)
                self.assertTrue(envelope.get("meta", True))

    def test_quote_and_summary_have_explicit_business_groups(self):
        quote = next(case for case in FIXTURES if case["name"] == "quote")
        result, _ = structured_response(quote["payload"], quote["route"])
        self.assertEqual(result["data"]["price"]["change"], 0)
        self.assertEqual(result["data"]["session"]["volume"], 0)
        self.assertIsNone(result["data"]["capital"]["market_cap"])
        self.assertEqual(result["data"]["orderbook"]["columns"], ["price", "volume"])
        self.assertIn("timestamp", result["meta"])
        summary = next(case for case in FIXTURES if case["name"] == "summary")["envelope"]["data"]
        self.assertTrue(summary["company"]["is_bank"])
        self.assertEqual(summary["valuation"]["pb"], 0)
        self.assertIsNone(summary["valuation"]["pe"])

    def test_schema_before_compression_and_etag(self):
        app = Flask(__name__)
        register_api_http(app)
        Compress(app)
        register_api_contract(app)

        @app.get('/api/stocks/<symbol>/summary')
        def summary(symbol):
            return jsonify(success=True, symbol=symbol, name='Bank' * 300, roe=0, pe=None)

        @app.get('/api/error')
        def error():
            return jsonify(success=False, error={"code": "NOT_FOUND", "message": "Missing"}), 404

        @app.get('/api/file')
        def file():
            return Response(iter([b'file bytes']), mimetype='application/octet-stream')

        client = app.test_client()
        legacy = client.get('/api/stocks/VCB/summary?realtime=0')
        self.assertTrue(legacy.json['success'])
        self.assertNotIn('X-API-Schema', legacy.headers)
        structured = client.get('/api/stocks/VCB/summary?realtime=0&schema=2', headers={'Accept-Encoding': 'gzip'})
        self.assertEqual(structured.status_code, 200)
        self.assertEqual(structured.headers['X-API-Schema'], '2')
        value = json.loads(gzip.decompress(structured.data))
        self.assertEqual(value['data']['profitability']['roe'], 0)
        conditional = client.get('/api/stocks/VCB/summary?realtime=0&schema=2', headers={
            'Accept-Encoding': 'gzip', 'If-None-Match': structured.headers['ETag']})
        self.assertEqual(conditional.status_code, 304)
        self.assertEqual(conditional.data, b'')
        error_response = client.get('/api/error?schema=2')
        self.assertEqual(error_response.status_code, 404)
        self.assertEqual(error_response.json, {'error': {'code': 'NOT_FOUND', 'message': 'Missing'}})
        self.assertEqual(error_response.headers['Cache-Control'], 'no-store')
        download = client.get('/api/file?schema=2')
        self.assertEqual(download.data, b'file bytes')
        self.assertNotIn('X-API-Schema', download.headers)
        download.close()


if __name__ == '__main__':
    unittest.main()
