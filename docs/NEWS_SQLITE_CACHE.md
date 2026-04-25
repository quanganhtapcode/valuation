# News SQLite Cache

`fetch_sqlite/vci_ai_news.sqlite` is the canonical market news cache. It avoids
calling `ai.vietcap.com.vn` on every API request and keeps market/news widgets
fast.

## Files

| Item | Path |
|---|---|
| Canonical DB | `fetch_sqlite/vci_ai_news.sqlite` |
| Legacy fallback DB | `fetch_sqlite/vci_news.sqlite` |
| Fetcher | `fetch_sqlite/fetch_vci_news.py` |
| Backend reader | `backend/services/vci_news_sqlite.py` |

`VCI_NEWS_DB_PATH` can override the DB path. If it is not set, the backend checks
`vci_ai_news.sqlite` first and then the legacy `vci_news.sqlite`.

## API Behavior

| Endpoint | Behavior |
|---|---|
| `/api/market/news` | Reads SQLite first; upstream fallback only when cache is missing/stale |
| `/api/stock/news/<symbol>` | Reads ticker-specific rows from SQLite first; upstream fallback when needed |

The backend reads `raw_json` and normalizes fields into both legacy title-case
keys (`Title`, `Link`, `PublishDate`) and modern keys (`title`, `url`,
`publish_date`).

## Active Cron

Current cron from `automation/setup_cron_vps.sh`:

```bash
*/10 * * * * cd /var/www/valuation && bash automation/vci_safe_run.sh \
  --name ai_news \
  --db fetch_sqlite/vci_ai_news.sqlite \
  --retries 3 \
  --retry-sleep 20 \
  --drop-total-pct 0.30 \
  --keep-ratio 0.70 \
  --command ".venv/bin/python fetch_sqlite/fetch_vci_news.py --db fetch_sqlite/vci_ai_news.sqlite --pages 5 --page-size 50 --days-back 30 --prune-days 90 --workers 2 --retries 6 --backoff 1.3 --insecure" \
  >> fetch_sqlite/cron_vci_ai_news.log 2>&1
```

## Manual Refresh

```bash
cd /var/www/valuation
source .venv/bin/activate

python fetch_sqlite/fetch_vci_news.py \
  --db fetch_sqlite/vci_ai_news.sqlite \
  --pages 5 \
  --page-size 50 \
  --days-back 30 \
  --prune-days 90 \
  --workers 2 \
  --retries 6 \
  --backoff 1.3 \
  --insecure
```

For a deeper prefill:

```bash
python fetch_sqlite/fetch_vci_news.py \
  --db fetch_sqlite/vci_ai_news.sqlite \
  --pages 10 \
  --page-size 50 \
  --days-back 60 \
  --prune-days 120 \
  --workers 2 \
  --insecure
```

## Schema

| Table | Purpose |
|---|---|
| `news_items` | Cached upstream news rows plus `raw_json` |
| `news_meta` | Fetch metadata such as `last_fetch_utc` |

Important `news_items` fields:

| Column | Notes |
|---|---|
| `id` | Primary key/upsert key |
| `ticker` | Empty or ticker-specific depending on upstream item |
| `update_date` | Sort key for latest news |
| `news_title` | Upstream title |
| `news_source_link` | Upstream URL |
| `raw_json` | Full upstream payload for forward compatibility |
| `fetched_at_utc` | Local fetch timestamp |

## Duplicate and Retention

- `news_items.id` is the primary key, so repeated fetches upsert rows instead of
  duplicating them.
- Use `--prune-days` in cron to keep the DB bounded. Current production command
  keeps 90 days by `fetched_at_utc`.

## Debug

```bash
sqlite3 fetch_sqlite/vci_ai_news.sqlite "SELECT COUNT(*) FROM news_items;"
sqlite3 fetch_sqlite/vci_ai_news.sqlite "SELECT key, value FROM news_meta ORDER BY key;"
sqlite3 fetch_sqlite/vci_ai_news.sqlite "
  SELECT ticker, update_date, news_title
  FROM news_items
  ORDER BY update_date DESC
  LIMIT 20;
"

tail -100 fetch_sqlite/cron_vci_ai_news.log
```

## SSL Note

`--insecure` disables SSL verification to match current upstream behavior in the
service layer. Remove it only after confirming Vietcap SSL is stable from the
VPS.
