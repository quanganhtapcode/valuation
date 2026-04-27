# SQLite Analysis

> Last updated: 2026-04-26. The canonical architecture is now `fetch_sqlite`
> first. `stocks_optimized.db` and `stocks_optimized.new.db` are deprecated.

## Target Architecture

```text
External APIs
  VCI / Vietcap
  FireAnt
  optional vnstock legacy jobs
        |
        v
fetch_sqlite/*.py
        |
        v
fetch_sqlite/*.sqlite
        |
        v
Flask services/routes
        |
        v
Next.js frontend
```

The old monolithic DB pattern is no longer the source of truth. Each domain has
its own SQLite file, which makes refresh, backup and rollback easier.

## Domain Ownership

| Domain | Canonical DB | Why it owns the data |
|---|---|---|
| Company profile and industry | `vci_company.sqlite` | Best source for names, floor, `isbank`, ICB classification and profiles |
| Financial statements | `vci_financials.sqlite` | Wide VCI field-code schema supports banks/insurance/securities variants |
| Current market snapshot | `vci_screening.sqlite` | Freshest broad ticker snapshot with price, sector and market cap |
| TTM ratios | `vci_stats_financial.sqlite` | Richest current ratio dataset including banking KPIs |
| Daily PE/PB | `vci_ratio_daily.sqlite` | Highest-priority daily valuation multiples |
| Historical price | `fetch_sqlite/price_history.sqlite` | Dedicated OHLCV store with upsert by symbol/date |
| News cache | `vci_market_news.sqlite` | Fast market news reads without hitting upstream per request |
| News/events/dividends by symbol | `vci_news_events.sqlite` | Per-symbol tab data |
| Shareholders | `vci_shareholders.sqlite` | Holder list by ticker |
| Foreign trading | `vci_foreign.sqlite` | Intraday foreign flow |
| Market valuation | `vci_valuation.sqlite` | VNINDEX PE/PB bands and EMA breadth |
| Index history | `index_history.sqlite` | Index OHLCV/history |
| Macro | `macro_history.sqlite`, `fireant_macro.sqlite` | VCI and FireAnt macro datasets |
| Computed valuation cache | `valuation_cache.sqlite` | Cached heavy valuation outputs |

## Priority Chains

### PE/PB

```text
vci_ratio_daily.sqlite
  -> vci_stats_financial.sqlite
  -> vci_screening.sqlite
```

### Industry and Peer Grouping

```text
vci_company.sqlite: companies.icb_name4
  -> companies.icb_name3 / icb_name2
  -> vci_screening.sqlite: icbCodeLv2 / icbCodeLv4 / viSector
```

### Financial Statements

```text
vci_financials.sqlite wide tables
  -> legacy vci_financial_statement_data paths only during migration
```

### News

```text
vci_market_news.sqlite for market/news widgets
vci_news_events.sqlite for stock-specific tabs
upstream fallback only when cache is missing or stale
```

## Migration Notes

The following names should be treated as legacy:

| Name | Action |
|---|---|
| `stocks_optimized.db` | Do not use. Replace with domain-specific `fetch_sqlite` DB reads. |
| `stocks_optimized.new.db` | Do not use. Rebuild temp DBs per domain instead. |
| `vietnam_stocks.db` | Do not introduce new references. |
| `STOCKS_DB_PATH` | Legacy compatibility only. |
| `VIETNAM_STOCK_DB_PATH` | Legacy compatibility only. |
| `overview`, `ratio_wide`, `company`, `fin_stmt` compatibility views | Replace route dependencies with direct `fetch_sqlite` queries where practical. |

Suggested search:

```bash
rg -n "stocks_optimized|stocks_optimized\\.new|vietnam_stocks|STOCKS_DB_PATH|VIETNAM_STOCK_DB_PATH|overview|ratio_wide|fin_stmt"
```

## Strengths of the New Shape

- **Smaller blast radius:** a broken news refresh does not affect financial
  statements or prices.
- **Clear ownership:** each table belongs to one fetcher or batch job.
- **Faster deploys:** code and docs can move without shipping large DB files.
- **Easier rebuilds:** each DB can be rebuilt, validated and swapped
  independently.
- **Better caching:** request paths can cache by domain instead of invalidating a
  monolithic database.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Backend route still reads legacy monolithic DB | Empty or stale API fields | Migrate route/service to specific `fetch_sqlite` DB |
| DB path resolver still prefers legacy files | Accidental recreation of removed DB | Remove legacy fallback in code or mark compatibility path clearly |
| Missing cron for a canonical DB | Stale market page | Add explicit cron in `automation/setup_cron_vps.sh` |
| Large SQLite file grows unbounded | Disk pressure | Add retention and scheduled `VACUUM` |
| Schema drift from VCI | Fetch succeeds but backend field mapping breaks | Store `raw_json`, log missing columns, document field-code changes |

## Operational Checks

Freshness:

```bash
sqlite3 /var/www/valuation/fetch_sqlite/vci_screening.sqlite \
  "SELECT COUNT(*), MAX(fetched_at) FROM screening_data;"

sqlite3 /var/www/valuation/fetch_sqlite/vci_stats_financial.sqlite \
  "SELECT COUNT(*), MAX(fetched_at) FROM stats_financial;"

sqlite3 /var/www/valuation/fetch_sqlite/vci_ratio_daily.sqlite \
  "SELECT COUNT(*), MAX(fetched_at) FROM ratio_daily;"

sqlite3 /var/www/valuation/fetch_sqlite/vci_market_news.sqlite \
  "SELECT key, value FROM news_meta ORDER BY key;"
```

Cron logs:

```bash
tail -50 /var/www/valuation/fetch_sqlite/cron_screener.log
tail -50 /var/www/valuation/fetch_sqlite/cron_stats_financial.log
tail -50 /var/www/valuation/fetch_sqlite/cron_vci_market_news.log
tail -50 /var/www/valuation/fetch_sqlite/cron_ratio_daily.log
tail -50 /var/www/valuation/fetch_sqlite/cron_shareholders.log
```

Integrity:

```bash
for db in /var/www/valuation/fetch_sqlite/*.sqlite; do
  echo "$db"
  sqlite3 "$db" "PRAGMA integrity_check;"
done
```

## Recommended Cleanup

1. Remove or rewrite any backend code that still requires `overview`,
   `ratio_wide`, `company` or `fin_stmt`.
2. Add production cron for `index_history.sqlite`, `macro_history.sqlite` and
   `fireant_macro.sqlite` if those pages require freshness guarantees.
3. Keep `docs/SQLITE_DATABASES.md`, `docs/RUNBOOK.md` and
   `automation/setup_cron_vps.sh` synchronized.
