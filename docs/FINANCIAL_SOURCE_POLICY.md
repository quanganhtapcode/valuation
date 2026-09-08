# SSI / Vietcap source policy

The website reads `data/sqlite/vci_financials.sqlite`. Vietcap's fetcher now
defaults to this path and refuses to write into a database marked `SSI JSONL`.
The independent SSI archive remains at
`data/financial-statements/vci_financial_statement_data/vci_financial_statements.sqlite`.

## Update rules

- Vietcap is primary. SSI fills missing periods in balance sheet, income
  statement and cash flow; it never supplies notes.
- A newer SSI payload can revise a row explicitly marked SSI. It cannot revise
  a Vietcap row or an existing row whose source is unknown.
- Null, absent, invalid and non-finite numeric values do not erase existing
  non-null values. Zero is valid and updates normally. Empty numeric payloads
  do not create/refresh a report. Older fetch timestamps cannot overwrite newer
  data. This uses ingestion timestamps, not a provider's audited revision ID.
- `statement_provenance` records the latest writer and fetch timestamp for each
  ticker/section/period. `retained_fields_json` records source/timestamp for
  fields retained from an older payload. These records are separate from wide
  financial tables so existing API/export field discovery stays compatible.
- Existing mixed runtime rows are not guessed to be SSI from timestamps.
  Their source remains unknown until a subsequent Vietcap write. Consequently,
  historical SSI rows merged before source tracking are protected from SSI
  revisions until their provenance is independently established.
- A valid quarter is 1–4; annual rows use quarter 0. SSI six-/nine-month buckets
  remain excluded. Numeric strings are normalized to finite numbers.
- Rebuilding wide tables after normalized values were cleaned up preserves
  existing rows. The notes archive retains older periods missing from a newer
  snapshot instead of replacing the entire archive.

## Running updates

Existing scheduled Vietcap fetches automatically merge the available SSI archive
after fetching the canonical runtime database. No crontab reinstall is required.
Custom target databases require an explicit `--ssi-fallback-db` to opt in.
The safe-run wrapper holds the database lock and creates the rollback snapshot.

SSI remains an imported JSONL source; this change does not introduce an SSI
network fetcher or manufacture newer SSI data. Import fresh exports explicitly:

```bash
.venv/bin/python scripts/fetchers/import_ssi_financial_statements.py --source-dir /path/to/ssi-exports
.venv/bin/python scripts/fetchers/merge_ssi_into_vci_financials.py --dry-run
.venv/bin/python scripts/fetchers/merge_ssi_into_vci_financials.py
```

Expected export names: `balance_sheets.jsonl`, `ssi_income_statements.jsonl`,
`data.jsonl` (cash flow). The importer only accepts an empty target or an
existing SSI-marked archive. Existing SSI-only archive rows can be safely
marked SSI; this classification is not applied to the mixed runtime database.

Standalone merge takes the same lock as scheduled safe-run, creates a
WAL-aware SQLite backup unless `--no-backup` is explicitly supplied, and updates
the target atomically. Dry-run executes the real merge against an isolated
in-memory copy; it does not alter the live database. Notes are excluded even
from SSI metric imports.

The provenance table is created on the next import/fetch/merge. No destructive
migration or immediate full-market refetch is required. Numerical field meanings
and units remain unchanged; supplemental SSI fields are not automatically
blended into existing Vietcap rows without a verified mapping.

Verification: `python -m unittest discover -s tests -v` exercises source priority,
partial/empty responses, zero values, stale updates, repeated merges, transaction
rollback, notes retention, import periods, and SQLite backup/restore behavior.
