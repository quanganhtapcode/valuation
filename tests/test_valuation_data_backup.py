"""Offline checks for complete data snapshots and verified-only retention."""
import contextlib
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from automation import backup_valuation_data as module


class DataBackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'project'
        (self.root / 'data').mkdir(parents=True)
        self.db = self.root / 'data/live.sqlite'
        self.conn = sqlite3.connect(self.db)
        self.addCleanup(self.conn.close)
        self.conn.execute('PRAGMA journal_mode=WAL')
        self.conn.execute('CREATE TABLE sample(value TEXT)')
        self.conn.execute("INSERT INTO sample VALUES ('committed')")
        self.conn.commit()
        (self.root / 'data/metadata.json').write_text('{"version":1}')
        (self.root / 'data/backups').mkdir()
        (self.root / 'data/backups/old.sqlite').write_text('excluded')
        (self.root / '.env').write_text('SECRET=not-in-data-backup')

    def archive(self):
        stage = Path(self.temp.name) / 'stage'
        stage.mkdir()
        archive = Path(self.temp.name) / 'snapshot.tar.gz'
        manifest = module.create_archive(self.root, archive, stage)
        return archive, manifest

    def test_roundtrip_includes_committed_wal_and_excludes_runtime_artifacts(self):
        archive, manifest = self.archive()
        self.assertEqual({e['path'] for e in manifest['files']},
                         {'data/live.sqlite', 'data/metadata.json'})
        restore = Path(self.temp.name) / 'restore'
        restore.mkdir()
        module.verify_archive(archive, restore)
        with contextlib.closing(sqlite3.connect(restore/'payload/data/live.sqlite')) as db:
            self.assertEqual(db.execute('SELECT value FROM sample').fetchall(), [('committed',)])

    def test_nonempty_invalid_database_fails_without_touching_source(self):
        bad = self.root / 'data/bad.sqlite'
        bad.write_bytes(b'not a SQLite database')
        with self.assertRaisesRegex(RuntimeError, 'invalid header'):
            self.archive()
        self.assertEqual(bad.read_bytes(), b'not a SQLite database')

    def test_empty_placeholder_database_is_preserved(self):
        (self.root/'data/placeholder.sqlite').touch()
        _, manifest = self.archive()
        entry = next(e for e in manifest['files'] if e['path'].endswith('placeholder.sqlite'))
        self.assertEqual(entry['bytes'], 0)
        self.assertFalse(entry['sqlite'])

    def test_external_symlink_fails_instead_of_leaking_data(self):
        (self.root/'data/link').symlink_to(self.root/'.env')
        with self.assertRaisesRegex(RuntimeError, 'symlink'):
            self.archive()

    def test_unexpected_secret_in_data_fails_closed(self):
        (self.root/'data/.env').write_text('SECRET=private')
        with self.assertRaisesRegex(RuntimeError, 'Secret/config'):
            self.archive()

    def test_tampered_file_is_detected(self):
        archive, manifest = self.archive()
        with tarfile.open(archive, 'w:gz') as output:
            metadata = json.dumps(manifest).encode()
            info = tarfile.TarInfo('manifest.json'); info.size = len(metadata)
            output.addfile(info, io.BytesIO(metadata))
            entry = manifest['files'][0]
            altered = b'corrupted'
            info = tarfile.TarInfo('payload/'+entry['path']); info.size = len(altered)
            output.addfile(info, io.BytesIO(altered))
        restore=Path(self.temp.name)/'restore';restore.mkdir()
        with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):
            module.verify_archive(archive, restore)

    def test_path_traversal_is_rejected(self):
        archive, manifest = self.archive()
        with tarfile.open(archive, 'w:gz') as output:
            metadata=json.dumps(manifest).encode()
            info=tarfile.TarInfo('manifest.json');info.size=len(metadata)
            output.addfile(info,io.BytesIO(metadata))
            info=tarfile.TarInfo('../outside');info.size=1
            output.addfile(info,io.BytesIO(b'x'))
        restore=Path(self.temp.name)/'restore';restore.mkdir()
        with self.assertRaisesRegex(RuntimeError, 'Unsafe'):
            module.verify_archive(archive, restore)

    def test_upload_failure_never_prunes_or_marks_success(self):
        directory=Path(self.temp.name)/'backups'
        with patch.object(module, 'run_rclone', side_effect=RuntimeError('upload failed')), \
                patch.object(module, 'prune_verified') as prune:
            with self.assertRaisesRegex(RuntimeError, 'upload failed'):
                module.backup(self.root,directory,'remote:test',2,30)
            prune.assert_not_called()
        self.assertFalse((directory/'last-success.json').exists())

    def test_retention_only_deletes_verified_snapshots(self):
        names=['valuation-data-20260101T000000Z.tar.gz',
               'valuation-data-20260102T000000Z.tar.gz',
               'valuation-data-20260103T000000Z.tar.gz']
        directory=Path(self.temp.name)/'retention';directory.mkdir()
        for name in names:
            (directory/name).touch()
        for name in names[:2]:
            (directory/(name+'.sha256')).touch()
        calls=[]
        def rclone(*args):
            calls.append(args)
            listing='\n'.join(names+[name+'.sha256' for name in names[:2]])
            return subprocess.CompletedProcess(args,0,stdout=listing)
        with patch.object(module,'run_rclone',side_effect=rclone):
            module.prune_verified(directory,'remote:backups',1,1)
        self.assertFalse((directory/names[0]).exists())
        self.assertTrue((directory/names[1]).exists())
        self.assertTrue((directory/names[2]).exists())
        self.assertEqual([c[1] for c in calls if c[0]=='deletefile'],
                         ['remote:backups/'+names[0], 'remote:backups/'+names[0]+'.sha256'])


if __name__=='__main__':
    unittest.main()
