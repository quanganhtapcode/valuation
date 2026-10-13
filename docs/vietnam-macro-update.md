# Vietnam economic data refresh

Installed daily at 08:00 (VPS timezone Asia/Ho_Chi_Minh), separately from the Yahoo currency/commodity job at 01:30 and FireAnt job at 07:00.

`automation/setup_cron_vps.sh` retains this schedule on future installations. The fetcher is `scripts/fetchers/fetch_vietnam_macro.py`. It fetches the 28 public TradingView `ECONOMICS:VN...` histories used by the Vietnam Macro UI and upserts into `data/sqlite/macro_history.sqlite` without pruning existing history. It uses daily bars for the overnight interbank rate and monthly resolution for the other economic series, preserving the source observation dates for monthly, quarterly and annual indicators.

The job uses `automation/vci_safe_run.sh` for backups, database locking, retries and row-count checks. Per-symbol retries handle temporary source disconnects. Exit 75 denotes a partial refresh: valid updates remain committed, failed symbols are reported and the wrapper retries. Unit-scale changes, histories without overlapping observation dates, and older source responses are rejected. Refresh metadata is stored separately in `macro_fetch_status`; observation dates are never replaced by fetch timestamps.

Logs: `logs/cron_vietnam_macro.log`. The first production refresh on 13 October 2026 completed 28/28 series and passed health checks. Examples: CPI/exports/imports September 2026, GDP Q3 2026, overnight interbank rate 9 October. Some source series remain older (e.g. deposit rate 2023 and M2 2024); these dates reflect the returned source history, not a failure to run the fetcher. Backend history responses can remain cached for up to one hour.

Checks:

```bash
.venv/bin/python -m unittest discover -s tests -p test_vietnam_macro.py
bash -n automation/setup_cron_vps.sh
.venv/bin/python scripts/fetchers/fetch_vietnam_macro.py --symbols ECONOMICS:VNCPI --dry-run
```

FireAnt is a separate data source, with 96 macro indicators across GDP (24), Prices (7), Business (10), Trade (12), Labour (10), Money (5), Consumer (5), Taxes (6), and InterestRate (17). Its macro endpoints exist but the current Macro frontend does not call them. The valuation service separately prioritizes FireAnt beta when suggesting WACC. Do not merge FireAnt macro values into TradingView histories without checking definitions, periods and units.
