from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest

from automation.check_valuation_backup import check_backup


class BackupHealthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.now = datetime(2026, 10, 25, 12, tzinfo=timezone.utc)
        self.name = 'valuation-data-20261025T090000Z.tar.gz'
        self.archive = self.root / self.name
        self.archive.write_bytes(b'test')
        self.digest = 'a' * 64
        self.marker = self.root / (self.name + '.sha256')
        self.marker.write_text(self.digest + '  ' + self.name + '\n')
        self.path = self.root / 'last-success.json'
        self.status = {'verified_utc': (self.now - timedelta(hours=3)).isoformat(),
                       'archive': self.name, 'sha256': self.digest,
                       'files': 95, 'sqlite_databases': 22, 'archive_bytes': 4}
        self.save()

    def save(self):
        self.path.write_text(json.dumps(self.status))

    def test_fresh_verified_archive_is_healthy(self):
        self.assertEqual(check_backup(self.path, now=self.now)['age_hours'], 3)

    def test_stale_archive_is_unhealthy(self):
        self.status['verified_utc'] = (self.now - timedelta(hours=37)).isoformat()
        self.save()
        with self.assertRaisesRegex(RuntimeError, '37.0 hours old'):
            check_backup(self.path, now=self.now)

    def test_future_timestamp_is_unhealthy(self):
        self.status['verified_utc'] = (self.now + timedelta(hours=1)).isoformat()
        self.save()
        with self.assertRaisesRegex(RuntimeError, 'future'):
            check_backup(self.path, now=self.now)

    def test_missing_archive_is_unhealthy(self):
        self.archive.unlink()
        with self.assertRaises(OSError):
            check_backup(self.path, now=self.now)

    def test_changed_size_is_unhealthy(self):
        self.archive.write_bytes(b'truncated')
        with self.assertRaisesRegex(RuntimeError, 'size changed'):
            check_backup(self.path, now=self.now)

    def test_mismatched_marker_is_unhealthy(self):
        self.marker.write_text('b' * 64 + '  ' + self.name)
        with self.assertRaisesRegex(RuntimeError, 'marker'):
            check_backup(self.path, now=self.now)

    def test_path_traversal_name_is_rejected(self):
        self.status['archive'] = '../unexpected.tar.gz'
        self.save()
        with self.assertRaisesRegex(RuntimeError, 'archive name'):
            check_backup(self.path, now=self.now)


if __name__ == '__main__':
    unittest.main()
