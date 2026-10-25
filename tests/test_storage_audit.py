"""Offline checks for the read-only aggregate SQLite storage audit."""
import contextlib
import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from automation.audit_storage import audit_database, audit_directory, main, read_snapshot


class StorageAuditTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.path = self.directory / 'sample.sqlite'

    def tearDown(self):
        self.temporary.cleanup()

    def create_database(self, sql, path=None):
        with contextlib.closing(sqlite3.connect(path or self.path)) as conn:
            conn.executescript(sql)

    def test_reader_never_creates_missing_database(self):
        with self.assertRaises(sqlite3.OperationalError):
            with read_snapshot(self.path):
                pass
        self.assertFalse(self.path.exists())
        self.assertEqual(audit_database(self.path)['status'], 'error')
        self.assertFalse(self.path.exists())

    def test_valid_database_is_unchanged_and_reader_rejects_writes(self):
        self.create_database('CREATE TABLE prices(ticker TEXT PRIMARY KEY, price REAL);'
                             "INSERT INTO prices VALUES('VCB', 20);")
        before = self.path.read_bytes()
        with read_snapshot(self.path) as conn:
            self.assertTrue(conn.in_transaction)
            self.assertEqual(conn.execute('PRAGMA query_only').fetchone()[0], 1)
            with self.assertRaises(sqlite3.OperationalError):
                conn.execute('DELETE FROM prices')
        report = audit_database(self.path)
        self.assertEqual(report['status'], 'ok')
        self.assertEqual(report['quick_check'], ['ok'])
        self.assertEqual(report['allocated_bytes'], report['page_size'] * report['page_count'])
        self.assertEqual(report['wal_bytes'], 0)
        self.assertEqual(report['tables'][0]['row_count'], 1)
        self.assertEqual(report['tables'][0]['primary_key'], ['ticker'])
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(sorted(path.name for path in self.directory.iterdir()), ['sample.sqlite'])

    def test_reader_keeps_one_snapshot_while_wal_writer_commits(self):
        self.create_database('PRAGMA journal_mode=WAL; CREATE TABLE example(value INTEGER);'
                             'INSERT INTO example VALUES(1);')
        with read_snapshot(self.path) as reader:
            self.assertEqual(reader.execute('SELECT value FROM example').fetchone()[0], 1)
            with contextlib.closing(sqlite3.connect(self.path)) as writer:
                writer.execute('UPDATE example SET value=2')
                writer.commit()
            self.assertEqual(reader.execute('SELECT value FROM example').fetchone()[0], 1)
        with read_snapshot(self.path) as reader:
            self.assertEqual(reader.execute('SELECT value FROM example').fetchone()[0], 2)

    def test_nullable_composite_primary_key_detects_duplicates(self):
        self.create_database('CREATE TABLE observations(ticker TEXT, period INTEGER, value REAL, '
                             'PRIMARY KEY(ticker, period));'
                             "INSERT INTO observations VALUES('VCB', NULL, 1), ('VCB', NULL, 2),"
                             "('VCB', NULL, 3), ('VCB', 2026, 4);")
        report = audit_database(self.path)
        table = report['tables'][0]
        self.assertEqual(report['status'], 'issues')
        self.assertEqual(table['null_key_rows'], 3)
        self.assertEqual(table['duplicate_groups'], 1)
        self.assertEqual(table['duplicate_extra_rows'], 2)
        self.assertNotIn('VCB', json.dumps(report))

    def test_tables_without_primary_key_are_explicitly_unchecked(self):
        self.create_database('CREATE TABLE logs(message TEXT);'
                             "INSERT INTO logs VALUES('same'), ('same');")
        table = audit_database(self.path)['tables'][0]
        self.assertEqual(table['key_kind'], 'unchecked')
        self.assertIsNone(table['duplicate_groups'])
        self.assertIsNone(table['null_key_rows'])

    def test_only_known_complete_natural_keys_are_checked(self):
        self.create_database('CREATE TABLE note_metrics(section TEXT, field TEXT, value REAL);'
                             "INSERT INTO note_metrics VALUES('A', 'x', 1), ('A', 'x', 2);"
                             'CREATE TABLE note(ticker TEXT);')
        tables = {table['table']: table for table in audit_database(self.path)['tables']}
        self.assertEqual(tables['note_metrics']['key_kind'], 'natural_key')
        self.assertEqual(tables['note_metrics']['duplicate_extra_rows'], 1)
        self.assertEqual(tables['note']['key_kind'], 'unchecked')

    def test_quotes_identifiers_and_preserves_primary_key_order(self):
        self.create_database('CREATE TABLE "odd""table"("first""key" TEXT, second TEXT, '
                             'PRIMARY KEY(second, "first""key"));'
                             'INSERT INTO "odd""table" VALUES(NULL, NULL), (NULL, NULL);')
        table = audit_database(self.path)['tables'][0]
        self.assertEqual(table['primary_key'], ['second', 'first"key'])
        self.assertEqual(table['null_key_rows'], 2)
        self.assertEqual(table['duplicate_extra_rows'], 1)

    def test_directory_distinguishes_empty_and_archive_and_ignores_nested_files(self):
        self.path.touch()
        archive = self.directory / 'notes_fallback.sqlite'
        self.create_database('CREATE TABLE example(k TEXT PRIMARY KEY);'
                             'INSERT INTO example VALUES(NULL), (NULL);', archive)
        self.create_database('CREATE TABLE example(k INTEGER PRIMARY KEY);',
                             self.directory / 'old.pre-2026.sqlite')
        nested = self.directory / 'nested'
        nested.mkdir()
        (nested / 'ignored.sqlite').touch()
        (self.directory / 'ignored.sqlite.bak').touch()
        report = audit_directory(self.directory)
        self.assertEqual(report['summary']['database_files'], 3)
        self.assertEqual(report['summary']['empty_files'], 1)
        self.assertEqual(report['summary']['archive_files'], 2)
        self.assertEqual(report['summary']['duplicate_tables'], 1)
        self.assertTrue(report['has_failures'])
        self.assertEqual(next(item for item in report['databases']
                              if item['database'] == archive.name)['category'], 'archive')

    def test_corrupt_database_is_visible_and_cli_returns_failure(self):
        self.path.write_bytes(b'This is not a SQLite database')
        with contextlib.redirect_stdout(io.StringIO()) as output:
            status = main(['--directory', str(self.directory)])
        report = json.loads(output.getvalue())
        self.assertEqual(status, 1)
        self.assertEqual(report['summary']['database_errors'], 1)
        self.assertIn('error', report['databases'][0])

    def test_explicit_file_selection_overrides_directory_and_deduplicates_paths(self):
        self.create_database('CREATE TABLE example(k INTEGER PRIMARY KEY);')
        (self.directory / 'corrupt.sqlite').write_bytes(b'not a database')
        with contextlib.redirect_stdout(io.StringIO()) as output:
            status = main(['--directory', str(self.directory), '--database', str(self.path),
                           '--database', str(self.path)])
        report = json.loads(output.getvalue())
        self.assertEqual(status, 0)
        self.assertEqual(report['selection'], 'explicit')
        self.assertEqual(report['summary']['database_files'], 1)
        self.assertEqual(report['databases'][0]['path'], str(self.path))

    def test_progress_handler_reports_timeout(self):
        self.create_database('CREATE TABLE rows(k INTEGER PRIMARY KEY);'
                             'WITH RECURSIVE n(k) AS (VALUES(1) UNION ALL '
                             'SELECT k + 1 FROM n WHERE k < 2000) INSERT INTO rows SELECT k FROM n;')
        # Keep this deterministic: the audit starts at 0, then every progress
        # callback observes a time after the one-second deadline.
        with patch('automation.audit_storage.time.monotonic', side_effect=[0, 0] + [2] * 100):
            report = audit_database(self.path, timeout=1)
        self.assertEqual(report['status'], 'error')
        self.assertTrue(report['timed_out'])

    def test_missing_directory_is_not_created(self):
        missing = self.directory / 'absent'
        report = audit_directory(missing)
        self.assertTrue(report['has_failures'])
        self.assertFalse(missing.exists())


if __name__ == '__main__':
    unittest.main()
