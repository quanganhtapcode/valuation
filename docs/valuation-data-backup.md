# Valuation data backup and restoration

Application source belongs in GitHub. Production data is backed up separately to
`onedrive:valuation-backups/valuation-data` by `automation.backup_valuation_data`.
Each archive records the deployed Git commit, creation time, file hashes, and
which files are SQLite snapshots.

## Coverage

- `data/`: every SQLite database, financial-statement dataset, metadata and cache.
- `automation/data/`: downloaded Excel ZIP data.
- `automation/backups/excel_update_state.json`: updater scheduling state.
- `runtime/`: operational state files, excluding temporary/lock files.

Nested backup folders, WAL/SHM files and locks are excluded. Empty placeholder
databases are preserved; nonempty invalid SQLite files fail the backup. Symlinks
and unexpected secrets in data directories require manual review, never silent
omission. Source, `.env`, keys, logs and dependencies are not uploaded in these
data archives. Private configuration is retained by the separate cross-VPS backup.

## Daily operation

Install the service/timer through `automation/setup_systemd.sh`, or copy
`automation/valuation-data-backup.{service,timer}` to `/etc/systemd/system/`,
run `systemctl daemon-reload`, then enable `valuation-data-backup.timer`.
The timer runs at 00:40 Asia/Bangkok with up to two minutes jitter.

```sh
systemctl start valuation-data-backup.service
systemctl status valuation-data-backup.service
journalctl -u valuation-data-backup.service -n 30
cat data/backups/onedrive-system/last-success.json
```

Each database uses SQLite's online backup API, includes committed WAL changes,
and passes `PRAGMA quick_check`. Databases are individually consistent; the set
is not one atomic transaction across all databases. The archive is uploaded,
downloaded, SHA-256 compared, then restored into scratch space. Every restored
file is hashed, and every restored SQLite is opened read-only and quick-checked.
Only after success is a `.sha256` marker uploaded and retention applied:
two verified local archives, thirty verified remote archives. Failed/unverified
uploads never cause old verified backups to be pruned. The script uses `copyto`,
not `sync`, so deleting live data does not immediately delete historical backups.

The old `fund-backup.timer` can be disabled only after a complete archive has
been verified and confirmed to contain `data/funds.sqlite`. Existing historical
fund/Excel backups on OneDrive are preserved. The Excel updater continues to run
because its fetch/R2 publication work is independent of disaster-recovery backup.

## Restore safely

Download a timestamped archive and matching `.sha256` from OneDrive to a machine
with enough free space. Verify the SHA-256 before opening it. To reconstruct and
check its contents in a new empty directory:

```sh
mkdir /var/tmp/valuation-restore-check
python -m automation.backup_valuation_data \
  --verify-archive /path/to/valuation-data-TIMESTAMP.tar.gz \
  --restore-to /var/tmp/valuation-restore-check
```

The restored layout is `payload/data/`, `payload/automation/`, and
`payload/runtime/`. Do not restore over a running application. Stop Valuation and
all writer jobs, preserve the old directories, then replace the relevant data
directories from `payload/`. Do not leave old SQLite WAL/SHM sidecars alongside
restored databases. For a single live database replacement use the existing
`automation.sqlite_backup --restore` command after stopping its writers.
Restore private configuration separately and check out the source commit listed
in `manifest.json`, install dependencies, then start services and check endpoints.

The timer/systemd journal records failures; no new external notifications are
configured by this backup. Review backup age and service status periodically.
