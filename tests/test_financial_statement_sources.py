import argparse
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.fetchers import fetch_vci_financial_statement as fetcher
from scripts.fetchers import import_ssi_financial_statements as importer
from scripts.fetchers.financial_statement_storage import write_statement
from scripts.fetchers.merge_ssi_into_vci_financials import merge_ssi


T1 = "2026-08-01T00:00:00+00:00"
T2 = "2026-08-02T00:00:00+00:00"
T3 = "2026-08-03T00:00:00+00:00"
FIELDS = {"BALANCE_SHEET": {"bsa1"}, "INCOME_STATEMENT": {"isa1", "isa2"},
          "CASH_FLOW": {"cfa1"}, "NOTE": {"nob1"}}


def schema(conn):
    fetcher.ensure_schema(conn)
    for section, fields in FIELDS.items():
        fetcher._ensure_wide_table(conn, fetcher.SECTION_TABLE_MAP[section], sorted(fields))
    fetcher.upsert_metrics(conn, {s: [{"field": f} for f in fields] for s, fields in FIELDS.items()}, T1)


def metadata(ticker="FPT", date=T1):
    return dict(ticker=ticker, period_kind="YEAR", year_report=2025,
                quarter_report=0, fetched_at=date)


class FinancialSourceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="valuation-financial-test-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        schema(self.conn)

    def income(self, ticker="FPT"):
        return self.conn.execute("SELECT isa1,isa2 FROM income_statement WHERE ticker=?", (ticker,)).fetchone()

    def write(self, values, source="VCI", date=T1, ticker="FPT"):
        with self.conn:
            return write_statement(self.conn, "INCOME_STATEMENT", metadata(ticker, date), values, source)

    def test_partial_vci_preserves_values_but_accepts_zero(self):
        self.write({"isa1": 100, "isa2": 20})
        payload = {"INCOME_STATEMENT": {"years": [{"yearReport": 2025, "isa1": 0, "isa2": None}]}}
        fetcher.upsert_symbol_statements(self.conn, "FPT", payload, FIELDS, T2,
                                        store_values_json=False, write_wide=True,
                                        wide_columns={s: set(f) for s, f in FIELDS.items()})
        self.assertEqual(self.income(), (0, 20))
        record = self.conn.execute("SELECT data_source,retained_fields_json FROM statement_provenance").fetchone()
        self.assertEqual(record[0], "VCI")
        self.assertEqual(json.loads(record[1])["isa2"], {"source": "VCI", "fetched_at": T1})

    def test_empty_or_nonfinite_payload_does_not_refresh_row(self):
        self.write({"isa1": 100, "isa2": 20})
        self.assertFalse(self.write({"isa1": float("nan"), "isa2": float("inf")}, date=T2))
        self.assertEqual(self.income(), (100, 20))
        self.assertEqual(self.conn.execute("SELECT fetched_at FROM statement_periods").fetchone()[0], T1)

    def test_stale_response_cannot_overwrite_newer_data(self):
        self.write({"isa1": 200}, date=T2)
        self.assertFalse(self.write({"isa1": 100}, date=T1))
        self.assertEqual(self.income(), (200, None))

    def test_vci_promotes_ssi_and_records_retained_field_source(self):
        self.write({"isa1": 100, "isa2": 20}, source="SSI")
        self.write({"isa1": 120}, date=T2)
        self.assertEqual(self.income(), (120, 20))
        record = self.conn.execute("SELECT data_source,retained_fields_json FROM statement_provenance").fetchone()
        self.assertEqual(record[0], "VCI")
        self.assertEqual(json.loads(record[1])["isa2"]["source"], "SSI")
        self.assertFalse(self.write({"isa1": 999}, source="SSI", date=T3))

    def test_ssi_cannot_overwrite_legacy_rows(self):
        self.write({"isa1": 100})
        self.conn.execute("DELETE FROM statement_provenance")
        self.conn.commit()
        self.assertFalse(self.write({"isa1": 999}, source="SSI", date=T2))
        self.assertEqual(self.income(), (100, None))

    def test_conversion_after_normalized_cleanup_preserves_wide_data(self):
        self.write({"isa1": 100, "isa2": 20})
        fetcher.convert_normalized_to_wide(self.conn)
        self.assertEqual(self.income(), (100, 20))

    def source_db(self):
        path = self.root / "ssi.sqlite"
        source = sqlite3.connect(path)
        schema(source)
        source.execute("INSERT INTO meta VALUES ('data_source','SSI JSONL')")
        source.commit()
        self.addCleanup(source.close)
        return path, source

    def test_merge_refreshes_only_known_ssi_rows_and_is_idempotent(self):
        path, source = self.source_db()
        with source:
            for ticker in ("SSI", "VCI", "OLD"):
                write_statement(source, "INCOME_STATEMENT", metadata(ticker), {"isa1": 100}, "SSI")
        self.write({"isa1": 10}, ticker="VCI")
        self.write({"isa1": 20}, ticker="OLD")
        self.conn.execute("DELETE FROM statement_provenance WHERE ticker='OLD'")
        self.conn.commit()
        self.assertEqual(merge_ssi(self.conn, path)["income_statement"], 1)
        with source:
            write_statement(source, "INCOME_STATEMENT", metadata("SSI", T2), {"isa1": 200}, "SSI")
        self.assertEqual(merge_ssi(self.conn, path)["income_statement"], 1)
        self.assertEqual(self.income("SSI"), (200, None))
        self.assertEqual(self.income("VCI"), (10, None))
        self.assertEqual(self.income("OLD"), (20, None))
        self.assertEqual(sum(merge_ssi(self.conn, path).values()), 0)

    def test_failed_merge_rolls_back_previous_tables(self):
        path, source = self.source_db()
        with source:
            write_statement(source, "BALANCE_SHEET", metadata(), {"bsa1": 123}, "SSI")
            source.execute("DROP TABLE cash_flow")
        with self.assertRaises(ValueError):
            merge_ssi(self.conn, path)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM balance_sheet").fetchone()[0], 0)

    def test_notes_archive_keeps_periods_missing_from_new_snapshot(self):
        archive = self.root / "notes.sqlite"
        with self.conn:
            for ticker in ("FPT", "VCB"):
                write_statement(self.conn, "NOTE", metadata(ticker), {"nob1": 10}, "VCI")
        fetcher._archive_notes(self.conn, archive)
        self.conn.execute("DELETE FROM note WHERE ticker='VCB'")
        self.conn.execute("DELETE FROM statement_periods WHERE ticker='VCB'")
        self.conn.commit()
        fetcher._archive_notes(self.conn, archive)
        self.assertEqual(fetcher._restore_missing_notes(self.conn, archive), 1)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM note").fetchone()[0], 2)

    def test_import_validates_quarters_and_parses_numeric_strings(self):
        payload = {"symbol": "FPT", "fetched_at": T1, "data": {"items": [{
            "quarterly": [{"yearReport": 2025, "quarterReport": q, "isa1": "100"} for q in (0, 1, 5)],
            "yearly": [{"yearReport": 2025, "isa1": "200"}],
            "sixMonths": [{"yearReport": 2025, "quarterReport": 2, "isa1": 999}]
        }]}}
        (self.root / "ssi_income_statements.jsonl").write_text(json.dumps(payload) + "\n")
        mapping = self.root / "mapping.json"
        mapping.write_text(json.dumps({"INCOME_STATEMENT": [{"field": "isa1"}]}))
        target = self.root / "import.sqlite"
        args = argparse.Namespace(db_path=str(target), mapping_file=str(mapping),
                                  section="INCOME_STATEMENT", source_dir=self.root)
        with patch.object(importer, "parse_args", return_value=args):
            self.assertEqual(importer.main(), 0)
            self.assertEqual(importer.main(), 0)
        with sqlite3.connect(target) as conn:
            rows = conn.execute("SELECT period_kind,quarter_report,isa1 FROM income_statement ORDER BY period_kind").fetchall()
            self.assertEqual(rows, [("QUARTER", 1, 100), ("YEAR", 0, 200)])
            self.assertEqual(conn.execute("SELECT DISTINCT data_source FROM statement_provenance").fetchall(), [("SSI",)])

    def test_default_vci_target_is_not_ssi_archive(self):
        self.assertEqual(fetcher._default_db_path().name, "vci_financials.sqlite")

    def test_fetch_main_merges_ssi_after_vci_without_network(self):
        path, source = self.source_db()
        with source:
            write_statement(source, "INCOME_STATEMENT", metadata("SSI"), {"isa1": 50}, "SSI")
        target = self.root / "runtime.sqlite"
        args = ["fetch", "--db-path", str(target), "--out-dir", str(self.root / "output"),
                "--symbols", "FPT", "--ssi-fallback-db", str(path)]
        metrics = {s: [{"field": f} for f in fields] for s, fields in FIELDS.items()}
        payload = {"INCOME_STATEMENT": {"years": [{"yearReport": 2025, "isa1": 100}]}}
        with patch("sys.argv", args), patch.object(fetcher, "_fetch_metrics", return_value=metrics), \
                patch.object(fetcher, "_fetch_symbol_all_sections", return_value=payload):
            self.assertEqual(fetcher.main(), 0)
        with sqlite3.connect(target) as conn:
            self.assertEqual(conn.execute(
                "SELECT ticker,data_source FROM statement_provenance ORDER BY ticker").fetchall(),
                [("FPT", "VCI"), ("SSI", "SSI")])

    def test_vci_fetch_rejects_ssi_target_before_network(self):
        path, _ = self.source_db()
        args = ["fetch", "--db-path", str(path), "--out-dir", str(self.root / "output")]
        with patch("sys.argv", args), patch.object(fetcher, "_fetch_metrics") as request:
            with self.assertRaisesRegex(ValueError, "separate SSI archive"):
                fetcher.main()
            request.assert_not_called()

    def test_ssi_import_rejects_vci_target(self):
        target = self.root / "runtime.sqlite"
        with sqlite3.connect(target) as conn:
            schema(conn)
            write_statement(conn, "INCOME_STATEMENT", metadata(), {"isa1": 123}, "VCI")
        mapping = self.root / "mapping.json"
        mapping.write_text("{}")
        args = argparse.Namespace(db_path=str(target), mapping_file=str(mapping),
                                  section="INCOME_STATEMENT", source_dir=self.root)
        with patch.object(importer, "parse_args", return_value=args):
            with self.assertRaisesRegex(ValueError, "not marked SSI"):
                importer.main()
        with sqlite3.connect(target) as conn:
            self.assertEqual(conn.execute("SELECT isa1 FROM income_statement").fetchone()[0], 123)


if __name__ == "__main__":
    unittest.main()
