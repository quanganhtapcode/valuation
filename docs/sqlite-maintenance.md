# SQLite maintenance

Run from the repository root:

```sh
.venv/bin/python automation/optimize_sqlite.py
.venv/bin/python automation/optimize_sqlite.py --apply
.venv/bin/python -m unittest discover -s tests -p test_sqlite_improvements.py
```

The default command only reports redundant indexes. `--apply` acquires the same
per-database lock as `vci_safe_run.sh`, creates and verifies a compressed SQLite
snapshot in `data/backups/sqlite-optimization/<UTC timestamp>/`, then migrates
and compacts each of the explicitly listed databases. Run during a quiet
period: VACUUM needs temporary disk space and a writer lock. Do not run standalone
fetchers concurrently. A failure stops subsequent databases; earlier databases
may already be complete. The migrations can be rerun.

Changes:

- Remove selected indexes covered by a primary-key prefix; retain the standalone
  price-date index used by global freshness queries.
- Archive successful financial fetch logs older than 30 days in the snapshot,
  retaining the latest success for each ticker and every error. This preserves
  the fetcher's resume behavior. Run maintenance periodically if log growth
  warrants it; no scheduled job is installed automatically.

Snapshots are not deleted automatically. They retain the complete pre-migration
database, including pruned logs. To roll back, decompress the relevant `.sqlite.gz`
to a separate temporary `.sqlite` file, pause writers and use
`automation/sqlite_backup.py --restore <snapshot.sqlite> <destination.sqlite>`.
Never overwrite a live database file using a file copy because a WAL may exist.
The unused short-financials source and fetcher were removed on 2026-09-20.

The notes fallback, legacy financial database and pre-SSI backup are intentionally
retained. Their removal requires checking deployment configuration and recovery
requirements. No financial history or news/event rows are pruned.

Select databases to avoid rewriting databases already optimized:

```sh
.venv/bin/python automation/optimize_sqlite.py --database vci_company.sqlite --database vci_market_news.sqlite
.venv/bin/python automation/optimize_sqlite.py --apply --database vci_company.sqlite --database vci_market_news.sqlite
```

The report includes freelist bytes (reusable pages, not necessarily the exact
VACUUM saving). Company and market-news maintenance only compacts and refreshes
query statistics; it preserves all table row counts. Empty legacy tables are
not dropped. See [data inventory](data-inventory.md) for ownership and dependencies.

## WAL and small index migrations

Use `--no-vacuum` when there is little free space to reclaim. `--wal` changes
journal mode only after a verified backup and under the scheduled writer lock:

```sh
.venv/bin/python automation/optimize_sqlite.py --apply --no-vacuum --wal --database vci_news_events.sqlite --database vci_market_news.sqlite --database vci_valuation.sqlite
.venv/bin/python automation/optimize_sqlite.py --apply --no-vacuum --database vci_shareholders.sqlite --database fireant_macro.sqlite
```

If the lock is held, let the running ingestion finish and retry. Never delete a
live journal/WAL to clear locks. News/events ingestion also enables WAL and commits
each completed symbol/tab before waiting for the next HTTP result. Failed fetches
preserve the last successful snapshot and timestamp.

The event APIs serve SQLite snapshots, including valid empty results. Stale data
returns immediately with `data_as_of`, `stale`, `partial`, and `refresh_pending`.
A bounded background queue refreshes snapshots; an entirely missing snapshot
returns HTTP 503 with `Retry-After: 10`. Background writes honor the same database
lock as scheduled maintenance. Refresh deduplication is per backend process.

Explicit database paths and environment overrides are authoritative, including
when the file is missing; readers fail or return unavailable instead of silently
selecting a different legacy database. Financial/ratio/stats ingestion health uses
committed metadata timestamps instead of the SQLite file modification time.
