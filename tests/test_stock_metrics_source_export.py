import csv
import io
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask
from openpyxl import Workbook
from backend.routes import download_routes as exports


class SourceExportTests(unittest.TestCase):
    def test_sources_remain_distinct_in_csv_and_excel(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'metrics.sqlite'
            with sqlite3.connect(path) as c:
                c.execute('CREATE TABLE stats_financial_history(ticker TEXT,year_report INTEGER,quarter_report INTEGER,pe REAL,pb REAL)')
                c.execute('CREATE TABLE ssi_stats_financial_history(ticker TEXT,year_report INTEGER,quarter_report INTEGER,pe REAL,pb REAL)')
                c.execute('CREATE TABLE stock_metrics_provenance(ticker TEXT,year_report INTEGER,quarter_report INTEGER,field TEXT,data_source TEXT)')
                c.executemany('INSERT INTO stats_financial_history VALUES (?,?,?,?,?)', [('AAA',2014,5,9,2),('AAA',2024,5,17,0),('AAA',2024,1,18,3)])
                c.executemany('INSERT INTO ssi_stats_financial_history VALUES (?,?,?,?,?)', [('AAA',2014,5,9,2),('AAA',2024,5,19,4),('AAA',2024,1,None,5)])
                c.executemany('INSERT INTO stock_metrics_provenance VALUES (?,?,?,?,?)', [('AAA',2014,5,'pe','SSI'),('AAA',2014,5,'pb','SSI')])
            app = Flask(__name__)
            with patch.object(exports, 'resolve_vci_stats_financial_db_path', return_value=str(path)):
                with app.test_request_context('/?from_year=2014&to_year=2024&period_kind=year'):
                    output = io.StringIO()
                    self.assertEqual(exports._write_stock_metrics_history_csv(output,['AAA']),2)
                    rows = list(csv.DictReader(io.StringIO(output.getvalue())))
                    self.assertNotIn('pe',rows[0])
                    self.assertEqual(rows[0]['pe_ssi'],'9.0')
                    self.assertEqual(rows[0]['pe_vietcap'],'')
                    self.assertEqual(rows[1]['pe_ssi'],'19.0')
                    self.assertEqual(rows[1]['pe_vietcap'],'17.0')
                    self.assertEqual(rows[1]['pb_vietcap'],'0.0')
                    book = Workbook()
                    exports._write_stock_metrics_history_worksheet(book.active,['AAA'])
                    self.assertEqual([c.value for c in book.active[1]][3:7],['pe_ssi','pe_vietcap','pb_ssi','pb_vietcap'])
                with app.test_request_context('/?from_year=2024&to_year=2024&period_kind=quarter'):
                    _, rows = exports._stats_financial_history_rows(['AAA'])
                    self.assertIsNone(rows[0]['pe_ssi'])
                    self.assertEqual(rows[0]['pe_vietcap'],18)


if __name__ == '__main__':
    unittest.main()
