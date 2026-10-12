"""Consistent SQLite snapshot, uploaded and verified before local pruning."""
import os
import subprocess
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
from automation.sqlite_backup import create_snapshot
from backend.fund_store import DEFAULT_PATH


def main():
    directory = Path('/var/www/valuation/data/fund-backups')
    directory.mkdir(parents=True, exist_ok=True)
    source = Path(os.getenv('FUNDS_DB_PATH', str(DEFAULT_PATH)))
    name = 'funds-' + datetime.now(ZoneInfo('Asia/Ho_Chi_Minh')).strftime('%Y%m%d-%H%M%S') + '.sqlite'
    snapshot = directory / name
    create_snapshot(source, snapshot, directory / 'funds.last_good.sqlite')
    remote = os.getenv('FUNDS_BACKUP_REMOTE', 'onedrive:valuation-backups/funds')
    subprocess.run(['rclone', 'copyto', str(snapshot), remote + '/' + name], check=True)
    subprocess.run(['rclone', 'check', str(directory), remote, '--include', name, '--one-way', '--download'], check=True)
    # Remote historical backups are retained. Only prune local snapshots after
    # the new upload has been independently verified.
    for old in sorted(directory.glob('funds-*.sqlite'), reverse=True)[7:]:
        old.unlink()
    print('Verified OneDrive fund backup:', name, flush=True)


if __name__ == '__main__':
    main()
