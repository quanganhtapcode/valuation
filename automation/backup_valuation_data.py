"""Versioned OneDrive data backups; verify a downloaded restore before pruning."""
from __future__ import annotations

import argparse
import contextlib
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ('data', 'automation/data', 'automation/backups/excel_update_state.json', 'runtime')
EXCLUDED_DIRS = {'backups', 'fund-backups', '__pycache__', 'node_modules', '.git'}
SNAPSHOT_RE = re.compile(r'^valuation-data-\d{8}T\d{6}Z\.tar\.gz$')


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def snapshot_file(source: Path, destination: Path) -> bool:
    """Snapshot SQLite through its backup API, including committed WAL changes."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    with source.open('rb') as handle:
        header = handle.read(16)
    is_sqlite = header == b'SQLite format 3\x00'
    if source.suffix in {'.sqlite', '.db'} and source.stat().st_size and not is_sqlite:
        raise RuntimeError(f'Nonempty database has an invalid header: {source}')
    if is_sqlite:
        uri = 'file:' + quote(str(source.resolve())) + '?mode=ro'
        with contextlib.closing(sqlite3.connect(uri, uri=True, timeout=30)) as reader:
            with contextlib.closing(sqlite3.connect(destination)) as writer:
                reader.backup(writer, pages=1024, sleep=0.05)
                if writer.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                    raise RuntimeError(f'SQLite snapshot failed quick_check: {source}')
                writer.execute('PRAGMA journal_mode=DELETE')
    else:
        shutil.copyfile(source, destination)
    destination.chmod(0o600)
    return is_sqlite


def collect_files(root: Path):
    """Only include selected data roots, never source code or environment files."""
    def visit(path: Path):
        if path.is_symlink():
            raise RuntimeError(f'Review data symlink before backing it up: {path}')
        if path.is_dir():
            if path.name in EXCLUDED_DIRS:
                return
            for child in sorted(path.iterdir()):
                yield from visit(child)
        elif path.is_file():
            if path.name.startswith('.env') or path.suffix in {'.pem', '.key'}:
                raise RuntimeError(f'Secret/config file unexpectedly present in data: {path}')
            if path.name.endswith(('-wal', '-shm', '.lock', '.safe-run.lock', '.tmp', '.partial')):
                return
            yield path
    for relative in SOURCES:
        path = root / relative
        if path.exists():
            yield from visit(path)


def create_archive(root: Path, archive: Path, stage: Path) -> dict:
    manifest = {'format': 1, 'created_utc': datetime.now(timezone.utc).isoformat(),
                'sources': list(SOURCES), 'files': []}
    result = subprocess.run(['git', '-C', str(root), 'rev-parse', 'HEAD'],
                            capture_output=True, text=True)
    manifest['source_commit'] = result.stdout.strip() if result.returncode == 0 else None
    for source in collect_files(root):
        relative = source.relative_to(root).as_posix()
        destination = stage / 'payload' / relative
        sqlite = snapshot_file(source, destination)
        manifest['files'].append({'path': relative, 'sha256': sha256(destination),
                                  'bytes': destination.stat().st_size, 'sqlite': sqlite})
    if not manifest['files']:
        raise RuntimeError('No data found; refusing an empty backup')
    metadata = stage / 'manifest.json'
    metadata.write_text(json.dumps(manifest, indent=2), encoding='utf8')
    partial = archive.with_name(archive.name + '.partial')
    with tarfile.open(partial, 'w:gz', compresslevel=1) as output:
        output.add(metadata, arcname='manifest.json')
        for entry in manifest['files']:
            name = 'payload/' + entry['path']
            output.add(stage / name, arcname=name, recursive=False)
    os.replace(partial, archive)
    return manifest


def verify_archive(archive: Path, restore: Path) -> dict:
    """Restore into an empty scratch directory and check every file and database."""
    if not restore.is_dir() or any(restore.iterdir()):
        raise RuntimeError('Restore verification requires an empty directory')
    with tarfile.open(archive, 'r|gz') as source:
        first = source.next()
        if first is None or first.name != 'manifest.json' or not first.isfile() or first.size > 16 * 1024 * 1024:
            raise RuntimeError('Invalid backup manifest')
        with source.extractfile(first) as handle:
            manifest = json.load(handle)
        if manifest.get('format') != 1:
            raise RuntimeError('Unsupported archive format')
        expected = {'payload/' + entry['path']: entry for entry in manifest['files']}
        if len(expected) != len(manifest['files']):
            raise RuntimeError('Duplicate manifest paths')
        seen = set()
        for member in iter(source.next, None):
            pure = PurePosixPath(member.name)
            if pure.is_absolute() or '..' in pure.parts or not member.isfile():
                raise RuntimeError('Unsafe archive member')
            if member.name not in expected or member.name in seen:
                raise RuntimeError('Unexpected/duplicate archive file')
            target = restore.joinpath(*pure.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.extractfile(member) as reader, target.open('wb') as writer:
                shutil.copyfileobj(reader, writer)
            entry = expected[member.name]
            if target.stat().st_size != entry['bytes'] or sha256(target) != entry['sha256']:
                raise RuntimeError(f'Restored file checksum mismatch: {entry["path"]}')
            if entry['sqlite']:
                uri = 'file:' + quote(str(target.resolve())) + '?mode=ro'
                with contextlib.closing(sqlite3.connect(uri, uri=True)) as conn:
                    if conn.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                        raise RuntimeError(f'Restored SQLite integrity failure: {entry["path"]}')
            seen.add(member.name)
        if seen != set(expected):
            raise RuntimeError('Backup is missing files')
    return manifest


def run_rclone(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(['rclone', *args], check=True, capture_output=True, text=True,
                          timeout=3600)


def prune_verified(directory: Path, remote: str, keep_local: int, keep_remote: int):
    remote_names = set(run_rclone('lsf', remote, '--files-only').stdout.splitlines())
    verified = sorted((name for name in remote_names if SNAPSHOT_RE.fullmatch(name)
                       and name + '.sha256' in remote_names), reverse=True)
    for name in verified[keep_remote:]:
        run_rclone('deletefile', remote + '/' + name)
        run_rclone('deletefile', remote + '/' + name + '.sha256')
    local = sorted((p for p in directory.iterdir() if SNAPSHOT_RE.fullmatch(p.name)
                    and p.with_name(p.name + '.sha256').exists()), reverse=True)
    for path in local[keep_local:]:
        path.unlink()
        path.with_name(path.name + '.sha256').unlink()


def backup(root: Path, directory: Path, remote: str, keep_local: int, keep_remote: int):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.umask(0o077)
    with (directory / 'backup.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        archive = directory / f'valuation-data-{stamp}.tar.gz'
        with tempfile.TemporaryDirectory(prefix='stage-', dir=directory) as tmp:
            manifest = create_archive(root, archive, Path(tmp))
        digest = sha256(archive)
        destination = remote.rstrip('/') + '/' + archive.name
        run_rclone('copyto', str(archive), destination)
        # Download the real remote object; do not rely only on reported size/hash.
        with tempfile.TemporaryDirectory(prefix='roundtrip-', dir=directory) as tmp:
            download = Path(tmp) / archive.name
            run_rclone('copyto', destination, str(download))
            if sha256(download) != digest:
                raise RuntimeError('Downloaded OneDrive archive SHA-256 mismatch')
            restore = Path(tmp) / 'restore'
            restore.mkdir()
            verify_archive(download, restore)
        sidecar = archive.with_name(archive.name + '.sha256')
        sidecar.write_text(digest + '  ' + archive.name + '\n')
        run_rclone('copyto', str(sidecar), destination + '.sha256')
        status = {'archive': archive.name, 'remote': destination, 'sha256': digest,
                  'verified_utc': datetime.now(timezone.utc).isoformat(),
                  'files': len(manifest['files']),
                  'sqlite_databases': sum(e['sqlite'] for e in manifest['files']),
                  'archive_bytes': archive.stat().st_size,
                  'payload_bytes': sum(e['bytes'] for e in manifest['files'])}
        status_part = directory / 'last-success.json.tmp'
        status_part.write_text(json.dumps(status, indent=2))
        os.replace(status_part, directory / 'last-success.json')
        print(json.dumps(status), flush=True)
        # Only rotate backups after a verified remote roundtrip and restore.
        prune_verified(directory, remote.rstrip('/'), keep_local, keep_remote)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--directory', type=Path)
    parser.add_argument('--remote', default=os.getenv('VALUATION_DATA_BACKUP_REMOTE',
                                                     'onedrive:valuation-backups/valuation-data'))
    parser.add_argument('--keep-local', type=int, default=2)
    parser.add_argument('--keep-remote', type=int, default=30)
    parser.add_argument('--verify-archive', type=Path)
    parser.add_argument('--restore-to', type=Path)
    args = parser.parse_args()
    if args.keep_local < 1 or args.keep_remote < 1:
        parser.error('Retention must be positive')
    if args.verify_archive:
        if not args.restore_to:
            parser.error('--verify-archive requires --restore-to (an empty directory)')
        manifest = verify_archive(args.verify_archive, args.restore_to)
        print('Restored and verified', len(manifest['files']), 'files')
    else:
        backup(args.root, args.directory or args.root / 'data/backups/onedrive-system',
               args.remote, args.keep_local, args.keep_remote)


if __name__ == '__main__':
    main()
