# Runbook

Operational notes for the valuation VPS at `/var/www/valuation`.

> Canonical data is in `fetch_sqlite/*.sqlite`. Legacy monolithic DBs
> `stocks_optimized.db`, `stocks_optimized.new.db` and `vietnam_stocks.db` are
> not production sources.

## Quick Health

```bash
cd /var/www/valuation
systemctl status valuation.service
journalctl -u valuation.service -n 100 --no-pager
curl -s http://127.0.0.1:8000/health | python3 -m json.tool
```

Frontend production:

```bash
curl -I https://stock.quanganh.org
curl -s https://api.quanganh.org/v1/valuation/health
```

## Deploy

Windows PowerShell helper:

```powershell
.\automation\deploy.ps1 -CommitMessage "fix: describe change"
.\automation\deploy.ps1 -CommitMessage "update data" -IncludeDatabase
```

Manual VPS pull/restart:

```bash
cd /var/www/valuation
git pull --ff-only
source .venv/bin/activate
pip install -r requirements.txt
cd frontend-next && npm ci && npm run build
systemctl restart valuation.service
```

## Cron and Timers

Install or refresh cron:

```bash
cd /var/www/valuation
bash automation/setup_cron_vps.sh
crontab -l
```

Active cron entries:

| Schedule | DB | Log |
|---|---|---|
| `*/7 * * * *` | `vci_screening.sqlite` | `fetch_sqlite/cron_screener.log` |
| `5 * * * *` | `vci_stats_financial.sqlite` | `fetch_sqlite/cron_stats_financial.log` |
| `*/10 * * * *` | `vci_ai_news.sqlite` | `fetch_sqlite/cron_vci_ai_news.log` |
| `30 11 * * *` | `fetch_sqlite/price_history.sqlite` | `logs/price_history_update.log` |
| `10 13 * * *` | `vci_shareholders.sqlite` | `fetch_sqlite/cron_shareholders.log` |
| `35 13 * * *` | `vci_ratio_daily.sqlite` | `fetch_sqlite/cron_ratio_daily.log` |
| `30 18 * * *` | `vci_valuation.sqlite` | `fetch_sqlite/cron_valuation.log` |
| `*/2 9-15 * * 1-5` | `vci_foreign.sqlite` | `fetch_sqlite/cron_foreign.log` |
| Sunday 02:00 even ISO weeks | `vci_company.sqlite` | `fetch_sqlite/cron_vci_company.log` |

If index or macro pages need freshness guarantees, add explicit cron entries for:

```bash
fetch_sqlite/fetch_vci.py
fetch_sqlite/fetch_macro_history.py
fetch_sqlite/fetch_fireant_macro.py
fetch_sqlite/fetch_vci_financial_statement.py
```

## Manual Fetches

```bash
cd /var/www/valuation
source .venv/bin/activate

python fetch_sqlite/fetch_vci_screener.py --db fetch_sqlite/vci_screening.sqlite
python fetch_sqlite/fetch_vci_stats_financial.py --db fetch_sqlite/vci_stats_financial.sqlite --workers 4 --delay 0.12
python fetch_sqlite/fetch_vci_ratio_daily.py --db fetch_sqlite/vci_ratio_daily.sqlite --workers 4 --delay 0.12
python fetch_sqlite/fetch_vci_shareholders.py --db fetch_sqlite/vci_shareholders.sqlite --workers 4 --delay 0.12
python fetch_sqlite/fetch_vci_news.py --db fetch_sqlite/vci_ai_news.sqlite --pages 5 --page-size 50 --days-back 30 --prune-days 90 --workers 2 --insecure
python fetch_sqlite/fetch_vci_company.py --db fetch_sqlite/vci_company.sqlite
python fetch_sqlite/fetch_vci_valuation.py --db fetch_sqlite/vci_valuation.sqlite
python fetch_sqlite/fetch_vci_foreign.py --db fetch_sqlite/vci_foreign.sqlite
PRICE_HISTORY_DB_PATH=fetch_sqlite/price_history.sqlite python -m backend.updater.update_price_history
```

## SQLite Checks

Freshness/count checks:

```bash
sqlite3 fetch_sqlite/vci_company.sqlite "SELECT COUNT(*) FROM companies;"
sqlite3 fetch_sqlite/vci_screening.sqlite "SELECT COUNT(*), MAX(fetched_at) FROM screening_data;"
sqlite3 fetch_sqlite/vci_stats_financial.sqlite "SELECT COUNT(*), MAX(fetched_at) FROM stats_financial;"
sqlite3 fetch_sqlite/vci_ratio_daily.sqlite "SELECT COUNT(*), MAX(fetched_at) FROM ratio_daily;"
sqlite3 fetch_sqlite/vci_ai_news.sqlite "SELECT key, value FROM news_meta ORDER BY key;"
sqlite3 fetch_sqlite/price_history.sqlite "SELECT COUNT(*), MAX(time) FROM stock_price_history;"
```

Integrity checks:

```bash
for db in fetch_sqlite/*.sqlite; do
  echo "$db"
  sqlite3 "$db" "PRAGMA integrity_check;"
done
```

Disk usage:

```bash
du -sh fetch_sqlite/*.sqlite 2>/dev/null | sort -rh
df -h /var/www/valuation
```

## Logs

```bash
tail -50 fetch_sqlite/cron_screener.log
tail -50 fetch_sqlite/cron_stats_financial.log
tail -50 fetch_sqlite/cron_vci_ai_news.log
tail -50 fetch_sqlite/cron_ratio_daily.log
tail -50 fetch_sqlite/cron_shareholders.log
tail -50 fetch_sqlite/cron_foreign.log
tail -50 fetch_sqlite/cron_valuation.log
tail -50 logs/price_history_update.log
```

## Common Failures

### Backend reads old monolithic DB

Symptom: API returns empty/stale fields even though `fetch_sqlite` DBs are fresh.

Check:

```bash
rg -n "stocks_optimized|stocks_optimized\\.new|vietnam_stocks|STOCKS_DB_PATH|VIETNAM_STOCK_DB_PATH|overview|ratio_wide|fin_stmt"
```

Fix: migrate the route/service to the specific `fetch_sqlite` DB documented in
`docs/SQLITE_DATABASES.md`.

### Cron not running

```bash
crontab -l
grep CRON /var/log/syslog | tail -50
tail -100 fetch_sqlite/cron_screener.log
```

If line endings are broken:

```bash
crontab -l | tr -d '\r' | crontab -
```

### VCI fetch blocked or partially empty

Most active cron entries run through `automation/vci_safe_run.sh`, which retries
and protects against severe row-count drops.

Check:

```bash
tail -100 fetch_sqlite/cron_screener.log
tail -100 fetch_sqlite/cron_stats_financial.log
tail -100 fetch_sqlite/cron_vci_ai_news.log
```

Rerun with fewer workers and delay:

```bash
python fetch_sqlite/fetch_vci_stats_financial.py \
  --db fetch_sqlite/vci_stats_financial.sqlite \
  --workers 2 --delay 0.25 --retries 5
```

### News cache stale

```bash
sqlite3 fetch_sqlite/vci_ai_news.sqlite "SELECT key, value FROM news_meta;"
python fetch_sqlite/fetch_vci_news.py \
  --db fetch_sqlite/vci_ai_news.sqlite \
  --pages 5 --page-size 50 --days-back 30 --prune-days 90 --workers 2 --insecure
```

### WebSocket not connecting

Confirm frontend env:

```text
NEXT_PUBLIC_BACKEND_WS_URL=wss://api.quanganh.org/v1/valuation
```

Check backend:

```bash
journalctl -u valuation.service -n 100 --no-pager
```

## Backup and Cleanup

Backup a DB before manual replacement:

```bash
mkdir -p backups
cp fetch_sqlite/vci_screening.sqlite backups/vci_screening_$(date +%Y%m%d_%H%M%S).sqlite
```

Vacuum during quiet hours:

```bash
sqlite3 fetch_sqlite/vci_ai_news.sqlite "VACUUM;"
sqlite3 fetch_sqlite/price_history.sqlite "VACUUM;"
```

Delete old logs:

```bash
find logs fetch_sqlite -name "*.log" -mtime +30 -delete
```

## Adding a New SQLite Source

1. Put the fetcher under `fetch_sqlite/`.
2. Add a `--db` argument.
3. Store full upstream payload in `raw_json` if schema may change.
4. Add a resolver/env var if backend needs configurable paths.
5. Add cron to `automation/setup_cron_vps.sh`.
6. Update `docs/SQLITE_DATABASES.md` and this runbook.
