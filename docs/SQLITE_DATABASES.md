# SQLite Databases

> Last updated: 2026-04-26. Canonical data now lives in `fetch_sqlite/`.
> Legacy DBs `stocks_optimized.db` and `stocks_optimized.new.db` have been
> removed from the data model and should not be used as source of truth.

## Rules

- New readers should target a specific DB in `fetch_sqlite/`, not a monolithic
  stock DB.
- New writers should expose `--db` and write to a deterministic path.
- Runtime DB files, WAL/SHM files, logs and backups are generated artifacts.
- Old references to `stocks_optimized.db`, `stocks_optimized.new.db`,
  `vietnam_stocks.db`, `STOCKS_DB_PATH` or `VIETNAM_STOCK_DB_PATH` are migration
  debt unless they are explicitly marked as legacy compatibility.

## Canonical Inventory

| Database | Writer | Main Tables | Purpose | Refresh |
|---|---|---|---|---|
| `vci_company.sqlite` | `fetch_vci_company.py` | `companies`, `fetch_log` | Company names, profile, floor, ICB industry | bi-weekly Sunday 02:00 |
| `vci_financials.sqlite` | `fetch_vci_financial_statement.py` | `balance_sheet`, `income_statement`, `cash_flow`, `note`, helper tables | Wide-format VCI financial statements | manual/cron-capable |
| `vci_screening.sqlite` | `fetch_vci_screener.py` | `screening_data`, `meta` | Market snapshot: price, market cap, sector, PE/PB/ROE | every 7 min |
| `vci_stats_financial.sqlite` | `fetch_vci_stats_financial.py` | `stats_financial`, `stats_financial_history`, `meta` | TTM ratios, shares, market cap, banking KPIs | hourly |
| `vci_ratio_daily.sqlite` | `fetch_vci_ratio_daily.py` | `ratio_daily`, `meta` | Highest-priority daily PE/PB | daily 13:35 |
| `vci_shareholders.sqlite` | `fetch_vci_shareholders.py` | `shareholders`, `meta` | Shareholders by ticker | daily 13:10 |
| `vci_market_news.sqlite` | `fetch_vci_market_news.py` | `news_items`, `news_meta` | Prefetched market/AI news cache | every 10 min |
| `vci_news_events.sqlite` | `backend/updater/batch_news.py` | `items`, `fetch_meta` | Per-symbol news, events and dividend tabs | batch/incremental |
| `vci_foreign.sqlite` | `fetch_vci_foreign.py` | `foreign_net_snapshot`, `foreign_volume_minute` | Foreign trading flow | every 2 min in market hours |
| `vci_valuation.sqlite` | `fetch_vci_valuation.py` | `valuation_history`, `valuation_stats`, `ema_breadth_history`, `meta` | VNINDEX PE/PB chart, valuation bands, EMA breadth | daily 18:30 |
| `index_history.sqlite` | `fetch_vci.py` | `market_index_history`, `meta` | Index OHLCV/history | schedule explicitly if needed |
| `macro_history.sqlite` | `fetch_macro_history.py` | `macro_prices` | VCI macro price series | schedule explicitly if needed |
| `fireant_macro.sqlite` | `fetch_fireant_macro.py` | `macro_indicators`, `macro_data` | FireAnt macro data | schedule explicitly if needed |
| `valuation_cache.sqlite` | `backend/updater/batch_valuations.py` | `valuations` | Cached valuation results | batch/on-demand |
| `price_history.sqlite` | `backend/updater/update_price_history.py` | `stock_price_history` | Daily stock OHLCV | daily 11:30 |
| `vci_ai_standouts.sqlite` | legacy/external writer | service-specific snapshot tables | Top movers fallback cache | no tracked cron writer |

## Deprecated Files

| File | Status | Replacement |
|---|---|---|
| `stocks_optimized.db` | Removed/deprecated | `fetch_sqlite/vci_*` DBs by domain |
| `stocks_optimized.new.db` | Removed/deprecated | Atomic rebuild should use domain-specific temp DBs |
| `vietnam_stocks.db` | Legacy name | Do not introduce new references |

## Path Environment Variables

Prefer the specific env var for the DB being read:

| Env var | DB |
|---|---|
| `VCI_COMPANY_DB_PATH` | `fetch_sqlite/vci_company.sqlite` |
| `VCI_FINANCIAL_STATEMENT_DB_PATH` | `fetch_sqlite/vci_financials.sqlite` |
| `VCI_SCREENING_DB_PATH` | `fetch_sqlite/vci_screening.sqlite` |
| `VCI_STATS_FINANCIAL_DB_PATH` | `fetch_sqlite/vci_stats_financial.sqlite` |
| `VCI_RATIO_DAILY_DB_PATH` | `fetch_sqlite/vci_ratio_daily.sqlite` |
| `VCI_SHAREHOLDERS_DB_PATH` | `fetch_sqlite/vci_shareholders.sqlite` |
| `VCI_MARKET_NEWS_DB_PATH` | `fetch_sqlite/vci_market_news.sqlite` |
| `VCI_NEWS_EVENTS_DB_PATH` | `fetch_sqlite/vci_news_events.sqlite` |
| `VCI_VALUATION_DB_PATH` | `fetch_sqlite/vci_valuation.sqlite` |
| `INDEX_HISTORY_DB_PATH` | `fetch_sqlite/index_history.sqlite` |
| `VALUATION_CACHE_DB_PATH` | `fetch_sqlite/valuation_cache.sqlite` |
| `VCI_STANDOUTS_DB_PATH` | `fetch_sqlite/vci_ai_standouts.sqlite` |
| `PRICE_HISTORY_DB_PATH` | `fetch_sqlite/price_history.sqlite` |

`STOCKS_DB_PATH` and `VIETNAM_STOCK_DB_PATH` are legacy monolithic-DB variables.
Do not use them for new code.

## Schema Notes

### `vci_company.sqlite`

| Table | Key Columns | Notes |
|---|---|---|
| `companies` | `ticker`, `organ_name`, `short_name`, `floor`, `isbank`, `icb_code1..4`, `icb_name1..4`, `company_profile` | Primary company/profile and industry source |
| `fetch_log` | `fetched_at`, `total_raw`, `inserted`, `status` | Fetch audit |

Preferred industry field: `icb_name4`, falling back to `icb_name3`/`icb_name2`.

### `vci_financials.sqlite`

| Table | Notes |
|---|---|
| `statement_metrics` | VCI field-code metadata |
| `statement_periods` | Available periods by ticker/section |
| `statement_values` | Normalized metric values |
| `balance_sheet` | Wide-format balance sheet |
| `income_statement` | Wide-format income statement |
| `cash_flow` | Wide-format cash flow statement |
| `note` | Wide-format notes |
| `fetch_log`, `meta` | Fetch status and metadata |

Field-code prefixes:

| Prefix | Meaning |
|---|---|
| `*a*` | Standard companies |
| `*b*` | Banks |
| `*i*` | Insurance |
| `*s*` | Securities |
| `nos*` | Off-balance-sheet items |

### `vci_screening.sqlite`

| Table | Important Columns |
|---|---|
| `screening_data` | `ticker`, `exchange`, `marketPrice`, `marketCap`, `ttmPe`, `ttmPb`, `ttmRoe`, `dailyPriceChangePercent`, `accumulatedValue`, `accumulatedVolume`, `icbCodeLv2`, `icbCodeLv4`, `viSector`, `enSector`, `raw_json`, `fetched_at` |
| `meta` | `k`, `v` |

Used for market-wide pages, peer grouping and fallback valuation inputs.

### `vci_stats_financial.sqlite`

| Table | Notes |
|---|---|
| `stats_financial` | Latest PE/PB/PS, ROE/ROA, margins, banking KPIs, market cap and shares |
| `stats_financial_history` | Historical period rows |
| `meta` | Fetch metadata |

### `vci_ratio_daily.sqlite`

| Table | Columns |
|---|---|
| `ratio_daily` | `ticker`, `pe`, `pb`, `trading_date`, `fetched_at` |
| `meta` | `k`, `v` |

This is the highest-priority PE/PB source.

### `vci_market_news.sqlite`

| Table | Notes |
|---|---|
| `news_items` | Stores normalized columns and full `raw_json` from upstream |
| `news_meta` | `last_fetch_utc`, ticker and retention metadata |

Backend normalizes upstream keys into both legacy title-case and modern
snake/lower-case fields.

### `vci_news_events.sqlite`

| Table | Notes |
|---|---|
| `items` | `symbol`, `tab`, `public_date`, `title`, `raw_json`, `fetched_at` |
| `fetch_meta` | Last fetch by `symbol` and `tab` |

### `price_history.sqlite`

| Table | Primary Key | Columns |
|---|---|---|
| `stock_price_history` | `(symbol, time)` | `open`, `high`, `low`, `close`, `volume` |

## Source Priority

### PE/PB

```text
1. fetch_sqlite/vci_ratio_daily.sqlite
2. fetch_sqlite/vci_stats_financial.sqlite
3. fetch_sqlite/vci_screening.sqlite
```

### Company and Industry

```text
1. fetch_sqlite/vci_company.sqlite
2. fetch_sqlite/vci_screening.sqlite sector/ICB fields
3. raw_json fallback from the relevant VCI DB
```

### Financial Statements

```text
1. fetch_sqlite/vci_financials.sqlite
2. legacy financial_statement_data paths only while migration is incomplete
```

## Active Cron from `automation/setup_cron_vps.sh`

| Schedule | Script | Output |
|---|---|---|
| `*/7 * * * *` | `fetch_vci_screener.py` | `vci_screening.sqlite` |
| `5 * * * *` | `fetch_vci_stats_financial.py` | `vci_stats_financial.sqlite` |
| `*/10 * * * *` | `fetch_vci_market_news.py` | `vci_market_news.sqlite` |
| `30 11 * * *` | `PRICE_HISTORY_DB_PATH=fetch_sqlite/price_history.sqlite python -m backend.updater.update_price_history` | `fetch_sqlite/price_history.sqlite` |
| `10 13 * * *` | `fetch_vci_shareholders.py` | `vci_shareholders.sqlite` |
| `35 13 * * *` | `fetch_vci_ratio_daily.py` | `vci_ratio_daily.sqlite` |
| `30 18 * * *` | `fetch_vci_valuation.py` | `vci_valuation.sqlite` |
| `*/2 9-15 * * 1-5` | `fetch_vci_foreign.py` | `vci_foreign.sqlite` |
| Sunday 02:00 even ISO weeks | `fetch_vci_company.py` | `vci_company.sqlite` |

## Verification

```bash
sqlite3 /var/www/valuation/fetch_sqlite/vci_company.sqlite "SELECT COUNT(*) FROM companies;"
sqlite3 /var/www/valuation/fetch_sqlite/vci_screening.sqlite "SELECT COUNT(*) FROM screening_data;"
sqlite3 /var/www/valuation/fetch_sqlite/vci_stats_financial.sqlite "SELECT COUNT(*) FROM stats_financial;"
sqlite3 /var/www/valuation/fetch_sqlite/vci_ratio_daily.sqlite "SELECT COUNT(*) FROM ratio_daily;"
sqlite3 /var/www/valuation/fetch_sqlite/vci_market_news.sqlite "SELECT key, value FROM news_meta;"
sqlite3 /var/www/valuation/fetch_sqlite/price_history.sqlite "SELECT COUNT(*) FROM stock_price_history;"
```

Find legacy references:

```bash
rg -n "stocks_optimized|stocks_optimized\\.new|vietnam_stocks|STOCKS_DB_PATH|VIETNAM_STOCK_DB_PATH"
```

## Maintenance

- Use `--prune-days` for `vci_market_news.sqlite` to keep the news cache bounded.
- Vacuum large DBs during quiet hours after major deletes.
- For full rebuilds, write to a temp DB in `fetch_sqlite/`, validate it, then
  atomically move it into place.
- Keep cron definitions and this document synchronized.
