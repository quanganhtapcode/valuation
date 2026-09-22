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

## Ingestion result status (2026-09-22)

Price history, news/events and financial statements now distinguish:

- Exit 0: every requested task completed successfully (valid existing data may
  need no new rows).
- Exit 75: partial/incomplete ingestion with old snapshots and committed
  successes retained. `vci_safe_run.sh` retries without restoring the pre-run
  snapshot; after exhausted retries it validates row-count/quality thresholds,
  retains good progress and still returns 75. A partial run never prints
  `health check passed` as its final result.
- Other nonzero exits: existing restore/retry behavior applies. Row-loss checks
  still trigger restoration even when the fetcher returns 75.

This exit-75 contract is only for fetchers that preserve previous data on error;
custom commands must not use it for destructive failures. Retry does not mean
all fetchers skip previous successes: news/events `--incremental` skips pairs
already fetched that UTC day; price history rechecks recent pages; financials
repeats the requested universe. No cron/service reinstallation is needed because
scheduled jobs reference these scripts directly.

The news worker default is four HTTP requests concurrently, with two bounded
retries per pair. `--workers`, `--retries` and `--symbols` support controlled
recovery. Financial `--retry` and `--timeout` are now applied; symbol workers use
separate HTTP openers and the pacing lock no longer covers network I/O.

All three writers record run status, counts, scope and timestamps in `meta`.
Health exposes price/news run metadata as well as existing coverage/data checks.
A targeted run is marked `scope=subset` and does not declare the full universe
healthy. Missing metadata remains a warning until a run populates it. Latest
trade date and ingestion success are distinct: a successful fetch can correctly
add no candles on a non-trading day; an error or malformed response cannot be
classified as up-to-date.

Backups made during this recovery are in `data/backups/ingestion-20260922/`.
No financial history or news/event items were deleted to silence health warnings.
