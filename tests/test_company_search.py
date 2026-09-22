"""The public company list/search must use VCI data and keep its response shape."""
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from flask import Blueprint, Flask
from backend.services.stock_service import StockService
from backend.routes.stock import missing_routes


class CompanyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.company = Path(self.tmp.name) / "company's snapshot.sqlite"
        self.screening = Path(self.tmp.name) / "screening's snapshot.sqlite"
        with closing(sqlite3.connect(self.company)) as conn:
            conn.executescript('''
                CREATE TABLE companies(ticker TEXT PRIMARY KEY, organ_name, floor, icb_name4, icb_name3, short_name, en_short_name, en_organ_name);
                INSERT INTO companies(ticker,organ_name,floor,icb_name4,icb_name3) VALUES
                    ('FPT','Công ty FPT','HOSE','Software','Technology'),
                    ('VCB','Ngân hàng VCB','HOSE','Banks','Finance'),
                    ('A_B','Literal underscore','HNX',NULL,'Other');
                UPDATE companies SET short_name='FPT Corp', en_organ_name='FPT Corporation' WHERE ticker='FPT';
            ''')
        with closing(sqlite3.connect(self.screening)) as conn:
            conn.executescript('''
                CREATE TABLE screening_data(ticker TEXT PRIMARY KEY, exchange, viSector);
                INSERT INTO screening_data VALUES ('fpt','HSX','Công nghệ'),('VCB','HSX','Ngân hàng');
            ''')
        for name, path in [('resolve_vci_company_db_path', self.company), ('resolve_vci_screening_db_path', self.screening)]:
            patcher = patch('backend.services.stock_service.' + name, return_value=str(path))
            patcher.start()
            self.addCleanup(patcher.stop)
        self.service = StockService()

    def test_search_returns_vci_company_with_legacy_contract(self):
        rows = self.service.search_stocks('fpt')
        self.assertEqual(rows, [{'symbol': 'FPT', 'name': 'Công ty FPT', 'exchange': 'HSX', 'industry': 'Công nghệ'}])
        self.assertEqual(self.service.search_stocks('Ngân hàng')[0]['symbol'], 'VCB')

    def test_search_aliases_and_exact_ticker_priority(self):
        with closing(sqlite3.connect(self.company)) as conn:
            conn.execute("INSERT INTO companies(ticker,organ_name,floor) VALUES ('AAA','FPT affiliate','OTHER')")
            conn.execute("UPDATE companies SET short_name='VINAMILK' WHERE ticker='A_B'")
            conn.commit()
        self.assertEqual(self.service.search_stocks('FPT', limit=1)[0]['symbol'], 'FPT')
        self.assertEqual(self.service.search_stocks('vinamilk')[0]['symbol'], 'A_B')
        self.assertEqual(self.service.search_stocks('Corporation')[0]['symbol'], 'FPT')

    def test_literal_wildcards_and_empty_input(self):
        self.assertEqual([row['symbol'] for row in self.service.search_stocks('_')], ['A_B'])
        self.assertEqual(self.service.search_stocks('%'), [])
        self.assertEqual(self.service.search_stocks("' OR 1=1 --"), [])
        self.assertEqual(self.service.search_stocks('   '), [])

    def test_list_source_priority_filtering_and_pagination(self):
        rows = self.service.list_companies('HSX')
        self.assertEqual([r['symbol'] for r in rows], ['FPT', 'VCB'])
        fallback = self.service.list_companies('HNX')[0]
        self.assertEqual(fallback['industry'], 'Other')
        self.assertEqual(self.service.list_companies(page=2, limit=10), [])

    def test_missing_attachment_is_not_created_and_main_connection_is_closed(self):
        from backend.sqlite_utils import open_readonly
        missing = Path(self.tmp.name) / 'absent.sqlite'
        connections = []
        def tracked(*args, **kwargs):
            conn = open_readonly(*args, **kwargs)
            connections.append(conn)
            return conn
        with patch('backend.services.stock_service.resolve_vci_screening_db_path', return_value=str(missing)), patch('backend.sqlite_utils.open_readonly', side_effect=tracked):
            with self.assertRaises(sqlite3.OperationalError):
                self.service.search_stocks('FPT')
        self.assertFalse(missing.exists())
        with self.assertRaises(sqlite3.ProgrammingError):
            connections[0].execute('SELECT 1')

    def test_http_search_and_invalid_pagination(self):
        app = Flask(__name__)
        bp = Blueprint('company_test', __name__)
        missing_routes.register(bp)
        app.register_blueprint(bp, url_prefix='/api')
        client = app.test_client()
        missing_routes._cache.clear()
        self.addCleanup(missing_routes._cache.clear)
        with patch.object(missing_routes, 'get_stock_service', return_value=self.service):
            response = client.get('/api/companies/search?q=fpt')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json[0]['symbol'], 'FPT')
            for path in ['/api/companies?limit=bad', '/api/companies?page=bad', '/api/companies/search?q=FPT&limit=bad']:
                self.assertEqual(client.get(path).status_code, 400)


if __name__ == '__main__':
    unittest.main()
