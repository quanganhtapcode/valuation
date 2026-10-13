# SSI stock metric history backfill

Merged on 2026-10-13 into `data/sqlite/vci_stats_financial.sqlite`.

The SSI attachment was downloaded on 2026-10-11 from the SSI FinancialAnalysis/GetFinancialRatioV2 endpoint. It contains 48,508 quarterly observations (812 symbols) and 15,842 annual observations (894 symbols), starting in 2006. The original source is preserved at `data/financial-statements/ssi-stock-metrics/SSI_financial_ratios.sqlite` (SHA256 `2a28d650908f32aad10fdcaeb9d8fa6a39dd7df6115bbff2c6cf42ce7bfda3af`).

## Result

- Added 33,874 missing reporting periods and filled 291 missing metric cells in existing periods.
- Combined history: 83,499 periods, 1,553 symbols, 2006–2026.
- 881 symbols now have observations before 2018 (32,419 periods).
- Verified every previously populated Vietcap metric cell against the pre-merge backup: zero changed values and zero lost periods. SQLite quick_check returned `ok`.
- FPT, HPG, SSI, VCB and VNM each now start in 2006.

This is the union of available source history, not verified full IPO coverage. The source export starts in 2006 and lacks data for many symbols; some observations can precede listing. Missing periods and unmapped metrics remain missing; zero is preserved as a numeric value. The latest snapshot table is unchanged.

## Mapping and semantics

`ssi-stock-metrics-mapping.json` records all leading candidates and independently approved mappings for annual and quarterly data. Comparison joins on ticker, reporting year and quarter (5 means annual), excludes null/non-finite/near-zero observations, and evaluates relative error across the complete overlap. Standard mappings require at least 80% of values within 2%, median relative error at most 1.5%, and at least 20 symbols represented. Approved mappings cover 25 distinct target fields (22 annual, 16 quarterly). Annual PE/PB are explicitly approved source backfills, rather than exact-value-equivalent mappings.

Quarterly PE/PB/PS/EV-to-EBITDA are unique candidate matches on over 21,000 overlapping observations each: 62–64% within 2%, median relative error below 0.5%. They use a separately documented valuation threshold (60% within 2%, median error below 1%). Source prices and adjustment conventions differ, so these SSI values are used only for missing periods/cells. Annual valuation matches are much weaker. On 2026-10-13 the user explicitly approved importing missing annual PE/PB directly from SSI with a source note about differing valuation price conventions. Annual PS and EV/EBITDA remain unimported.

Period mappings are not interchangeable. SSI quarterly margins, asset turnover and days outstanding do not match the Vietcap historical definitions (consistent with quarter-only versus trailing-year calculations). Their annual versions match strongly and are imported only annually. Likewise quarterly quick ratio, deposit growth, CASA, CIR, ROIC and other unconfirmed fields are not substituted. Debt-to-equity and financial leverage both map to `ryq10` because the current Vietcap fields match that same source series; this preserves the existing platform definitions rather than claiming these are independently validated financial concepts.

## Storage and updates

- `stats_financial_history`: combined data used by existing APIs and downloads; populated Vietcap values take priority.
- `ssi_stats_financial_history`: normalized, period-specific SSI fallback values.
- `stock_metrics_provenance`: per-cell SSI attribution for inserted/backfilled values.
- `stock_metrics_imports`: source hash, original source metadata, exact mapping and import timestamp.
- `ticker-coverage.csv` and `merge-summary.json` under the preserved source directory document the resulting coverage.

The Vietcap fetcher clears SSI attribution for the periods it refreshes, writes Vietcap values, then restores SSI values only into null cells. Older SSI periods remain in place. Importing the same file again is idempotent. Import uses the existing `.safe-run.lock`, SQLite transactions, and a SQLite backup before writing. The backup from this import is `data/sqlite/vci_stats_financial.pre-ssi-metrics-20261013T150721555001Z.sqlite`.

```bash
python3 scripts/financials/merge_ssi_metrics.py \
  --ssi-db data/financial-statements/ssi-stock-metrics/SSI_financial_ratios.sqlite \
  --dry-run

# Apply with automatic pre-merge backup.
python3 scripts/financials/merge_ssi_metrics.py \
  --ssi-db data/financial-statements/ssi-stock-metrics/SSI_financial_ratios.sqlite

python3 -m unittest discover -s tests -p test_ssi_metrics_merge.py -v
```

Validation: new merge/refresh regression passed; existing ingestion regression suite passed 37/38 tests. The unrelated cron installer assertion expects 17 rendered lines, whereas the current installer renders 18; no cron installer changes were made for this merge.

## Source notes in downloads

The Downloads page includes a source note in Vietnamese and English. CSV packages contain the same source attribution in `README.md`, and Excel exports include a `README` worksheet explaining source priority, reporting periods, units, and missing values. The history export includes all stored metric fields, including EBIT margin and days outstanding. Both single-ticker and streaming multi-ticker Excel exports are supported. Verified CSV and Excel through `/api/financial-bulk-export` for FPT and VCB, including 2006 data and the source note.

## Annual PE/PB extension

On 2026-10-13, added 6,629 missing annual PE/PB cells from SSI, preserving every previously populated metric cell. The yearly export uses these stored annual SSI values directly, not averages of quarterly values. The Downloads footer and CSV/Excel README notes explicitly disclose that source valuation price conventions may differ. Source-null values remain blank; this is not complete IPO coverage. A new pre-merge backup is `data/sqlite/vci_stats_financial.pre-ssi-metrics-20261013T154641828728Z.sqlite`.
