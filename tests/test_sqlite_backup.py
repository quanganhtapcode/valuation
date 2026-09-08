import fcntl
import os
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path

from automation.sqlite_backup import create_snapshot, restore_snapshot


ROOT = Path(__file__).resolve().parents[1]


class SQLiteBackupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="valuation-backup-test-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / "example.sqlite"
        self.connection = sqlite3.connect(self.source)
        self.addCleanup(self.connection.close)
        self.connection.execute("CREATE TABLE entries (value INTEGER)")
        self.connection.execute("INSERT INTO entries VALUES (1)")
        self.connection.commit()
        self.alias = self.root / "last_good.bak"

    def values(self, path):
        with sqlite3.connect(path) as connection:
            return connection.execute("SELECT value FROM entries ORDER BY value").fetchall()

    def test_wal_snapshot_and_alias_are_one_standalone_file(self):
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("INSERT INTO entries VALUES (2)")
        self.connection.commit()
        snapshot = self.root / "first.bak"
        create_snapshot(self.source, snapshot, self.alias)
        self.assertTrue(os.path.samefile(snapshot, self.alias))
        self.assertEqual(self.values(snapshot), [(1,), (2,)])
        snapshot.unlink()
        self.assertEqual(self.values(self.alias), [(1,), (2,)])

    def test_next_snapshot_never_changes_previous_backup(self):
        first, second = self.root / "first.bak", self.root / "second.bak"
        create_snapshot(self.source, first, self.alias)
        self.connection.execute("INSERT INTO entries VALUES (2)")
        self.connection.commit()
        create_snapshot(self.source, second, self.alias)
        self.assertEqual(self.values(first), [(1,)])
        self.assertEqual(self.values(self.alias), [(1,), (2,)])
        self.assertTrue(os.path.samefile(second, self.alias))

    def test_invalid_source_preserves_previous_rollback(self):
        create_snapshot(self.source, self.root / "first.bak", self.alias)
        bad = self.root / "bad.sqlite"
        bad.write_bytes(b"invalid SQLite file")
        with self.assertRaises(sqlite3.DatabaseError):
            create_snapshot(bad, self.root / "bad.bak", self.alias)
        self.assertEqual(self.values(self.alias), [(1,)])
        self.assertFalse(list(self.root.glob(".sqlite-backup-*")))

    def test_restore_replaces_committed_bad_wal_data(self):
        self.connection.execute("PRAGMA journal_mode=WAL")
        create_snapshot(self.source, self.root / "first.bak", self.alias)
        self.connection.execute("UPDATE entries SET value=999")
        self.connection.commit()
        self.assertTrue(Path(f"{self.source}-wal").exists())
        restore_snapshot(self.alias, self.source)
        self.assertEqual(self.connection.execute("SELECT value FROM entries").fetchall(), [(1,)])
        self.assertEqual(self.values(self.alias), [(1,)])

    def run_wrapper(self, *, fail_upload=False, command="true", keep_local="0", missing_rclone=False):
        backups = self.root / "backups"
        binary = self.root / "bin"
        binary.mkdir(exist_ok=True)
        fake_rclone = binary / "rclone"
        fake_rclone.write_text(
            '#!/bin/bash\n'
            'if [[ "$1" == "copyto" ]]; then\n'
            '  printf "%s\\n" "$2" >> "$UPLOAD_LOG"\n'
            '  exit "${UPLOAD_EXIT:-0}"\n'
            'fi\n'
            'exit 0\n'
        )
        fake_rclone.chmod(0o755)
        search_path = f"{binary}:{os.environ['PATH']}"
        if missing_rclone:
            fake_rclone.unlink()
            for name in ("bash", "mkdir", "flock", "dirname", "date", "basename",
                         "python3", "find", "sort", "sqlite3", "awk"):
                (binary / name).symlink_to(shutil.which(name))
            search_path = str(binary)
        log = self.root / "uploads.log"
        result = subprocess.run(
            ["bash", str(ROOT / "automation/vci_safe_run.sh"),
             "--name", "test", "--db", str(self.source),
             "--backup-dir", str(backups), "--command", command,
             "--retries", "0", "--keep-local", keep_local,
             "--rclone-remote", "test:backups"],
            cwd=self.root,
            env={**os.environ, "PATH": search_path,
                 "UPLOAD_LOG": str(log), "UPLOAD_EXIT": "1" if fail_upload else "0"},
            capture_output=True, text=True, timeout=20,
        )
        return result, backups, log

    def test_successful_upload_prunes_timestamp_but_preserves_rollback(self):
        result, backups, log = self.run_wrapper()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(log.read_text().strip())
        self.assertEqual(len(list(backups.glob("*.bak"))), 1)
        self.assertEqual(self.values(backups / "example.sqlite.last_good.bak"), [(1,)])

    def test_latest_retained_snapshot_is_uploaded_immediately(self):
        result, backups, log = self.run_wrapper(keep_local="1")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(log.read_text().strip())
        self.assertEqual(len(list(backups.glob("*.bak"))), 2)

    def test_upload_failure_keeps_local_snapshot(self):
        result, backups, _ = self.run_wrapper(fail_upload=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(len(list(backups.glob("*.bak"))), 2)

    def test_missing_rclone_keeps_local_snapshot(self):
        result, backups, _ = self.run_wrapper(missing_rclone=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("rclone missing", result.stdout)
        self.assertEqual(len(list(backups.glob("*.bak"))), 2)

    def test_concurrent_job_skips_without_running_command(self):
        with Path(f"{self.source}.safe-run.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result, backups, _ = self.run_wrapper(command="exit 99")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("another job", result.stdout)
        self.assertFalse(list(backups.glob("*.bak")))

    def test_failed_command_restores_database(self):
        self.connection.close()
        command = f'sqlite3 "{self.source}" "DELETE FROM entries;"; exit 1'
        result, _, _ = self.run_wrapper(command=command)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual(self.values(self.source), [(1,)])


if __name__ == "__main__":
    unittest.main()
