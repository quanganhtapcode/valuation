# Storage and source audit — 2026-09-08

The SSI/Vietcap findings below describe the initial audit. Subsequent fixes and
remaining source-refresh limitations are documented in [Financial source policy](FINANCIAL_SOURCE_POLICY.md).

## Storage

Initial project usage was approximately 5.2 GiB:

| Location | Initial usage | Purpose |
| --- | ---: | --- |
| `data/` | 3.4 GiB | Live SQLite data, snapshots, financial statements |
| `data/sqlite/backups/runtime/` (within data) | 1.8 GiB | Timestamped snapshots plus `last_good` copies |
| `frontend-next/node_modules/` | 709 MiB | Installed frontend dependencies |
| `.git/` | 601 MiB | Repository history and loose objects |
| `.venv/` | 315 MiB | Python dependencies |
| `automation/data/` | 122 MiB | Excel export ZIP |
| `logs/` | 94 MiB | Job output |

The main frontend source was only 1.7 MiB. Dead-code removal primarily improves
maintainability, not disk capacity. Verification generated a new approximately
41 MiB `.next` build.

Runtime backup aliases were byte-compared with timestamped snapshots. Fourteen
identical pairs were converted to hard links, reclaiming **918,925,312 bytes
(876 MiB)**. Both filenames and their contents remain available; runtime backup
usage is now approximately **915 MiB**. No historical snapshot or live database
was deleted.

`vci_safe_run.sh` now creates a consistent SQLite snapshot through the online
backup API, including committed WAL data. `last_good.bak` is an atomic hard link
to that snapshot, so the two names consume one file's storage. New runs replace
directory entries rather than writing into shared snapshot inodes. Jobs using
the same database are serialized with `flock`.

OneDrive listing and recent upload logs confirmed that
`onedrive:valuation-backups` is active. Existing policy keeps one timestamped
local snapshot and up to 30 remote snapshots per database (30 versions, not
necessarily 30 days). The newest snapshot is now uploaded during the same run,
instead of waiting until a later run prunes it. Failed uploads or a missing
`rclone` executable preserve local snapshots. Remote retention is unchanged.

Other opportunities, not performed:

- Review the 247 MiB manual ZIP backups and 237 MiB pre-SSI-merge database before
  retiring them; they are separate from scheduled runtime backup retention.
- Git reports 507 MiB of loose objects, including 3,510 prune-packable objects.
  Repacking/normal Git maintenance may reduce this without rewriting history;
  exact savings have not been measured.
- Add log rotation if not already managed outside this repository. No rotation
  configuration was found in repository automation/configuration.

## Dead code

Removed 11 unreachable frontend source/CSS files: the old download configuration
and exporter, unused Badge/Table/IndexCard/TopMovers/AiValuationCard components,
their unused barrel exports, and the orphan IndexCard stylesheet. Preserved
`IndexHistoryModal`, which is still used by `HeroIndexCard`.

Removed unused React imports, an unused report parameter and its unnecessary
income-report request, plus direct dependencies `class-variance-authority`,
`pako`, and `@types/pako`. ZIP/report dependencies still in use were retained.

Removed eight private Python helpers with no callers, verified by AST reference
inspection and repository search. Flask registration functions, compatibility
exports, operational scripts, and public endpoints were preserved. Deleted
tracked source files can be recovered from Git.

Verification: frontend ESLint, TypeScript with unused-local/parameter checks,
production Next.js build, shell syntax, and nine backup regression tests. Flask still
registers the same 92 routes (including the static route). `/health` responds
with HTTP 207 due to stale price/index-history data, not a route/import failure.

## SSI / Vietcap financial statement review

The default resolver selects `data/sqlite/vci_financials.sqlite`. The separate
SSI-imported database is
`data/financial-statements/vci_financial_statement_data/vci_financial_statements.sqlite`.
The resolver falls back by database existence, not by missing individual period.

`merge_ssi_into_vci_financials.py` inserts SSI rows only when their complete
`ticker, period_kind, year_report, quarter_report` key is absent. The three
supported tables are income statement, balance sheet and cash flow. Notes are
Vietcap-only and use a separate archive. SSI imports exclude six-/nine-month
buckets to avoid collisions with quarterly rows.

Read-only database checks found zero SSI periods missing from the primary DB
in all three tables, and no invalid year/quarter combinations. The last Vietcap
fetch was 2026-09-07 with 1,562 successful tickers and zero fetch failures.
SSI import and merge metadata are dated 2026-08-14; SSI source timestamps are
2026-08-12/13. No recurring SSI import/merge was found in repository automation.

Limitations to address separately:

- Rows have no explicit data-source/provenance column. Once merged, an SSI row
  looks like a Vietcap row to readers; the merge cannot selectively refresh
  revised SSI rows while protecting genuine Vietcap rows.
- SSI currently serves as a historical snapshot rather than an automatically
  refreshed source. New SSI data would require import and merge orchestration.
- Fallback operates on whole missing periods, not missing fields. Vietcap's
  fetcher uses `INSERT OR REPLACE` and sets absent fields to NULL, so a partial
  response can replace a more complete existing row. There is no per-row
  completeness check in the merge policy.

Field-level comparison found 29,660 overlapping income-statement periods where
SSI has a nonzero value absent from the primary DB, limited to supplemental
`rtq29`/`cfa2` fields. No such gaps were found in shared balance-sheet or
cash-flow fields, or core `isa*` income fields. These supplemental fields should
be validated for meaning/units before introducing field-level fallback; this
count alone does not establish a user-visible financial error.

This audit establishes routing, period coverage and update behavior; it does
not certify every SSI/Vietcap field mapping, unit or accounting value. No changes
to financial-source priority or financial records were made during this review.
