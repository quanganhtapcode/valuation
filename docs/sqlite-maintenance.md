# SQLite maintenance

Run from the repository root:

```sh
.venv/bin/python automation/optimize_sqlite.py
.venv/bin/python automation/optimize_sqlite.py --apply
.venv/bin/python -m unittest discover -s tests -p test_sqlite_optimization.py
```

The default command only reports redundant indexes. `--apply` acquires the same
per-database lock as `vci_safe_run.sh`, creates and verifies a compressed SQLite
snapshot in `data/backups/sqlite-optimization/<UTC timestamp>/`, then migrates
and compacts each of the six explicitly listed databases. Run during a quiet
period: VACUUM needs temporary disk space and a writer lock. Do not run standalone
fetchers concurrently. A failure stops subsequent databases; earlier databases
may already be complete. The migrations can be rerun.

Changes:

- Remove selected indexes covered by a primary-key prefix; retain the standalone
  price-date index used by global freshness queries.
- Compress `short_financial_payload.raw_json` losslessly as a gzip BLOB. Legacy
  rows may still be JSON TEXT. Use `decode_payload` from
  `scripts.fetchers.fetch_vci_short_financials` to read either representation.
  History/latest rows and all queryable financial columns remain unchanged.
- Archive successful financial fetch logs older than 30 days in the snapshot,
  retaining the latest success for each ticker and every error. This preserves
  the fetcher's resume behavior. Run maintenance periodically if log growth
  warrants it; no scheduled job is installed automatically.

Snapshots are not deleted automatically. They retain the complete pre-migration
database, including pruned logs. To roll back, decompress the relevant `.sqlite.gz`
to a separate temporary `.sqlite` file, pause writers and use
`automation/sqlite_backup.py --restore <snapshot.sqlite> <destination.sqlite>`.
Never overwrite a live database file using a file copy because a WAL may exist.
If reverting payload compression, also revert its fetcher write behavior.

The notes fallback, legacy financial database and pre-SSI backup are intentionally
retained. Their removal requires checking deployment configuration and recovery
requirements. No financial history or news/event rows are pruned.
