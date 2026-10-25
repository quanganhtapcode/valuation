"""Cheap offline health check for the last verified OneDrive data backup."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STATUS = ROOT / 'data/backups/onedrive-system/last-success.json'


def check_backup(status_path: Path, max_age_hours: float = 36,
                 now: datetime | None = None) -> dict:
    if max_age_hours <= 0:
        raise ValueError('Maximum age must be positive')
    status = json.loads(status_path.read_text())
    verified = datetime.fromisoformat(status['verified_utc'])
    if verified.tzinfo is None:
        raise RuntimeError('Backup verification time has no timezone')
    now = now or datetime.now(timezone.utc)
    age = (now - verified).total_seconds() / 3600
    if age < -5 / 60:
        raise RuntimeError('Backup verification timestamp is unexpectedly in the future')
    if age > max_age_hours:
        raise RuntimeError(f'Last verified backup is {age:.1f} hours old; limit {max_age_hours:g}')
    name = status['archive']
    if not re.fullmatch(r'valuation-data-\d{8}T\d{6}Z\.tar\.gz', name):
        raise RuntimeError('Unexpected archive name in backup status')
    digest = status['sha256']
    if not re.fullmatch(r'[0-9a-f]{64}', digest):
        raise RuntimeError('Invalid verified checksum record')
    if status['files'] < 1 or status['sqlite_databases'] < 1:
        raise RuntimeError('Backup status has no data or databases')
    archive = status_path.parent / name
    if archive.stat().st_size != status['archive_bytes']:
        raise RuntimeError('Verified local archive is missing or its size changed')
    marker = archive.with_name(name + '.sha256').read_text().split()
    if marker != [digest, name]:
        raise RuntimeError('Backup verification marker does not match status')
    return {'age_hours': max(0, age), 'files': status['files'],
            'sqlite_databases': status['sqlite_databases'], 'archive': name}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--status', type=Path, default=DEFAULT_STATUS)
    parser.add_argument('--max-age-hours', type=float, default=36)
    args = parser.parse_args()
    try:
        result = check_backup(args.status, args.max_age_hours)
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as error:
        print('CRITICAL: Valuation data backup unhealthy:', error, file=sys.stderr)
        return 1
    print(f'OK: verified backup {result["age_hours"]:.1f} hours ago; '
          f'{result["files"]} files, {result["sqlite_databases"]} SQLite databases')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
