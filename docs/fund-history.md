# Fund NAV history

The funds page uses the same heading, green accent and 1600px layout as Macro. Listing summary cards are removed. Fund names link to `/[lang]/funds/[symbol]`, where visitors can select 1/3/5-year, all-history or calendar-year NAV charts and inspect annual NAV changes, management fee (% per year), inception date and manager.

Sources: https://vnstocks.com/docs/vnstock/quy-mo-fund and https://www.vnstocks.com/docs/vnstock-data/du-lieu-quy-mo describe listing, NAV history, fees and inception fields. The existing Fmarket adapter remains the source. No vnstock installation or tier change is needed: the collector uses the same public `res/product/get-nav-history` operation as the installed older adapter.

`FUNDS_DB_PATH` defaults to `data/funds.sqlite`. Tables contain fund metadata, one selected NAV per symbol/date and original source observations. Hourly fundsheet publication upserts metadata and current published NAV; the daily collector backfills all available history for uncollected funds and subsequently refreshes a seven-day overlap. `--full` reloads complete source history to incorporate older corrections. Invalid or failed responses preserve existing data.

Some source dates have differing NAV records. Original IDs, NAV and creation times are retained. The chart selects the greatest creation time and source ID for each date; detail pages explain this when conflicts exist. The data remains source-reported rather than independently verified. Annual NAV change uses the previous calendar year's final available NAV as baseline; if that year is missing, it uses the first observation in the year and marks the period partial. Current-year changes are YTD. Changes do not include fund distributions or investor subscription/redemption fees.

`fund-history.timer` collects daily at 21:30 Asia/Bangkok, with a full history refresh on the first day of each month. `fund-backup.timer` creates an online SQLite snapshot at 23:00 and uploads it to `onedrive:valuation-backups/funds`, then independently verifies its contents with rclone `--download`. Seven local snapshots are retained only after a verified upload; remote history is retained. Override the remote with `FUNDS_BACKUP_REMOTE`.

Install the four service/timer files from `automation` into `/etc/systemd/system`, reload systemd and enable both timers. Backend HTTP only reads SQLite and the JSON listing snapshot; visitors never trigger an upstream history request.
