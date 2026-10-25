"""Offline storage regressions for idempotent writes and news symbol ownership."""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.routes.stock import news_events
from backend.updater import batch_news
from scripts.fetchers import fetch_vci_ratio_daily as ratios


class StorageCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "storage.sqlite"
        self.conn = sqlite3.connect(self.path)
        self.addCleanup(self.conn.close)


class NewsStorageTests(StorageCase):
    def legacy_schema(self):
        self.conn.executescript("""
            CREATE TABLE items (
                id TEXT NOT NULL, symbol TEXT NOT NULL, tab TEXT NOT NULL,
                public_date TEXT, title TEXT, raw_json TEXT NOT NULL,
                fetched_at TEXT NOT NULL, PRIMARY KEY(id, tab)
            );
            CREATE INDEX idx_items_symbol_tab ON items(symbol, tab, public_date DESC);
            CREATE TABLE fetch_meta (
                symbol TEXT NOT NULL, tab TEXT NOT NULL, last_fetched TEXT,
                item_count INTEGER DEFAULT 0, PRIMARY KEY(symbol, tab)
            );
            INSERT INTO items VALUES ('one','VCB','news','2026-10-22','Title','{"id":"one"}','old');
            INSERT INTO items VALUES ('two','FPT','dividend',NULL,NULL,'{"id":"two"}','old');
            INSERT INTO fetch_meta VALUES ('VCB','news','old',1);
        """)

    def primary_key(self):
        columns = self.conn.execute("PRAGMA table_info(items)").fetchall()
        return tuple(row[1] for row in sorted(columns, key=lambda row: row[5]) if row[5])

    def test_legacy_migration_preserves_rows_metadata_and_index_and_is_repeatable(self):
        self.legacy_schema()
        before = self.conn.execute("SELECT * FROM items ORDER BY id").fetchall()
        metadata = self.conn.execute("SELECT * FROM fetch_meta").fetchall()
        batch_news._init_db(self.conn)
        batch_news._init_db(self.conn)
        self.assertEqual(self.primary_key(), ("id", "symbol", "tab"))
        self.assertEqual(self.conn.execute("SELECT * FROM items ORDER BY id").fetchall(), before)
        self.assertEqual(self.conn.execute("SELECT * FROM fetch_meta").fetchall(), metadata)
        index = self.conn.execute("PRAGMA index_xinfo(idx_items_symbol_tab)").fetchall()
        self.assertEqual([(row[2], row[3]) for row in index if row[5]],
                         [("symbol", 0), ("tab", 0), ("public_date", 1)])
        self.assertFalse(self.conn.in_transaction)

    def test_migration_failure_after_old_table_drop_rolls_back_everything(self):
        self.legacy_schema()
        before = self.conn.execute("SELECT * FROM items ORDER BY id").fetchall()
        self.conn.set_authorizer(lambda action, *_: sqlite3.SQLITE_DENY
                                 if action == sqlite3.SQLITE_ALTER_TABLE else sqlite3.SQLITE_OK)
        try:
            with self.assertRaises(sqlite3.DatabaseError):
                batch_news._init_db(self.conn)
        finally:
            self.conn.set_authorizer(None)
        self.assertEqual(self.primary_key(), ("id", "tab"))
        self.assertEqual(self.conn.execute("SELECT * FROM items ORDER BY id").fetchall(), before)
        self.assertTrue(self.conn.execute("PRAGMA index_info(idx_items_symbol_tab)").fetchall())
        self.assertIsNone(self.conn.execute("SELECT name FROM sqlite_master WHERE name='items_symbol_key_migration'").fetchone())
        self.assertFalse(self.conn.in_transaction)

    def test_unknown_legacy_schema_is_rejected_without_data_loss(self):
        self.legacy_schema()
        self.conn.execute("ALTER TABLE items ADD COLUMN extra TEXT")
        with self.assertRaisesRegex(RuntimeError, "Unsupported.*schema"):
            batch_news._init_db(self.conn)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM items").fetchone()[0], 2)
        self.assertEqual(self.primary_key(), ("id", "tab"))

    def test_unknown_legacy_dependency_is_rejected_without_dropping_it(self):
        self.legacy_schema()
        self.conn.execute("CREATE INDEX custom_title ON items(title)")
        with self.assertRaisesRegex(RuntimeError, "dependencies"):
            batch_news._init_db(self.conn)
        self.assertTrue(self.conn.execute("PRAGMA index_info(custom_title)").fetchall())
        self.assertEqual(self.primary_key(), ("id", "tab"))

    def test_schema_initialization_does_not_commit_callers_pending_transaction(self):
        self.legacy_schema()
        self.conn.execute("UPDATE items SET title='pending'")
        with self.assertRaisesRegex(RuntimeError, "active transaction"):
            batch_news._init_db(self.conn)
        self.assertTrue(self.conn.in_transaction)
        self.conn.rollback()
        self.assertEqual(self.conn.execute("SELECT title FROM items WHERE id='one'").fetchone()[0], "Title")

    def test_same_article_keeps_both_symbol_associations_and_api_reads(self):
        batch_news._init_db(self.conn)
        item = {"id": "shared", "newsTitle": "Article for two companies"}
        for symbol in ("VCB", "FPT"):
            batch_news._store_result(self.conn, symbol, "news", [item])
        self.assertEqual(self.conn.execute("SELECT symbol FROM items ORDER BY symbol").fetchall(),
                         [("FPT",), ("VCB",)])
        self.assertEqual(self.conn.execute("SELECT symbol,item_count FROM fetch_meta ORDER BY symbol").fetchall(),
                         [("FPT", 1), ("VCB", 1)])
        with patch.object(news_events, "resolve_vci_news_events_db_path", return_value=str(self.path)):
            for symbol in ("VCB", "FPT"):
                snapshot = news_events._snapshot(symbol, ("news",))
                self.assertEqual(snapshot["data"], [item])
                self.assertFalse(snapshot["stale"])

    def test_identical_item_skips_payload_write_and_refreshes_pair_metadata(self):
        batch_news._init_db(self.conn)
        batch_news._store_result(self.conn, "VCB", "news", [{"id": "one", "newsTitle": "Tin Việt"}])
        self.conn.execute("UPDATE items SET fetched_at='old'")
        self.conn.execute("UPDATE fetch_meta SET last_fetched='old'")
        self.conn.execute("""CREATE TRIGGER fail_redundant_item_update BEFORE UPDATE ON items
            BEGIN SELECT RAISE(ABORT, 'redundant item write'); END""")
        self.conn.commit()
        batch_news._store_result(self.conn, "VCB", "news", [{"newsTitle": "Tin Việt", "id": "one"}])
        self.assertEqual(self.conn.execute("SELECT fetched_at FROM items").fetchone()[0], "old")
        stamp, count = self.conn.execute("SELECT last_fetched,item_count FROM fetch_meta").fetchone()
        self.assertNotEqual(stamp, "old")
        self.assertEqual(count, 1)

    def test_changed_item_updates_payload_and_duplicate_ids_count_once(self):
        batch_news._init_db(self.conn)
        batch_news._store_result(self.conn, "VCB", "news", [{"id": "one", "newsTitle": "Old"}])
        self.conn.execute("UPDATE items SET fetched_at='old'")
        self.conn.commit()
        batch_news._store_result(self.conn, "VCB", "news", [
            {"id": "one", "newsTitle": "Intermediate"}, {"id": "one", "newsTitle": "New"}])
        title, raw, stamp = self.conn.execute("SELECT title,raw_json,fetched_at FROM items").fetchone()
        self.assertEqual(title, "New")
        self.assertEqual(json.loads(raw)["newsTitle"], "New")
        self.assertNotEqual(stamp, "old")
        self.assertEqual(self.conn.execute("SELECT item_count FROM fetch_meta").fetchone()[0], 1)


class RatioStorageTests(StorageCase):
    def test_unchanged_history_skips_write_but_latest_ratio_remains_fresh(self):
        ratios.ensure_schema(self.conn)
        entry = {"trading_date": "2026-10-22", "pe": None, "pb": 0.0}
        ratios.upsert_ratio_history(self.conn, "vcb", [entry], "old")
        ratios.upsert_ratio(self.conn, "vcb", entry, "old")
        self.conn.execute("""CREATE TRIGGER fail_redundant_history_update
            BEFORE UPDATE ON ratio_daily_history
            BEGIN SELECT RAISE(ABORT, 'redundant history write'); END""")
        self.conn.commit()
        self.assertEqual(ratios.upsert_ratio_history(self.conn, "vcb", [entry], "new"), 1)
        ratios.upsert_ratio(self.conn, "vcb", entry, "new")
        self.assertEqual(self.conn.execute("SELECT ticker,pe,pb,fetched_at FROM ratio_daily_history").fetchone(),
                         ("VCB", None, 0.0, "old"))
        self.assertEqual(self.conn.execute("SELECT fetched_at FROM ratio_daily").fetchone()[0], "new")

    def test_history_corrections_preserve_nulls_zeroes_and_last_change_timestamp(self):
        ratios.ensure_schema(self.conn)
        for stamp, pe, pb in (("first", None, None), ("second", 0.0, 2.0), ("third", 12.0, None)):
            ratios.upsert_ratio_history(self.conn, "VCB", [
                {"trading_date": "2026-10-22", "pe": pe, "pb": pb}], stamp)
            self.assertEqual(self.conn.execute("SELECT pe,pb,fetched_at FROM ratio_daily_history").fetchone(),
                             (pe, pb, stamp))
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM ratio_daily_history").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
