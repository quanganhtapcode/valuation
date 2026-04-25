# System Architecture

> Current data architecture: `fetch_sqlite/*.sqlite` is canonical. Legacy
> monolithic DBs such as `stocks_optimized.db` and `stocks_optimized.new.db`
> are deprecated.

## High-Level Flow

```text
External APIs
  VCI / Vietcap
  FireAnt
        |
        v
fetch_sqlite/*.py and selected backend batch jobs
        |
        v
fetch_sqlite/*.sqlite
        |
        v
Flask backend on VPS :8000
        |
        +-- REST: /api/*
        +-- WebSocket: /ws/*
        |
        v
nginx api.quanganh.org/v1/valuation/*
        |
        v
Next.js frontend on Vercel
```

## Production Routing

| Traffic | Path | Notes |
|---|---|---|
| REST | `stock.quanganh.org/api/*` -> Next.js proxy -> `api.quanganh.org/v1/valuation/*` -> Flask `/api/*` | Same-origin frontend calls, centralized proxy/cache behavior |
| WebSocket | Browser -> `wss://api.quanganh.org/v1/valuation/ws/*` -> Flask `/ws/*` | Direct to VPS; Vercel does not proxy WS |

## Data Stores

```text
fetch_sqlite/
  vci_company.sqlite             company/profile/industry
  vci_financials.sqlite          VCI financial statements
  vci_screening.sqlite           live market snapshot
  vci_stats_financial.sqlite     TTM ratios and banking KPIs
  vci_ratio_daily.sqlite         daily PE/PB
  vci_shareholders.sqlite        holders
  vci_ai_news.sqlite             AI news cache
  vci_news_events.sqlite         per-symbol news/events/dividends
  vci_foreign.sqlite             foreign flow
  vci_valuation.sqlite           VNINDEX PE/PB and EMA breadth
  index_history.sqlite           market index history
  macro_history.sqlite           VCI macro
  fireant_macro.sqlite           FireAnt macro
  valuation_cache.sqlite         computed valuation cache
  price_history.sqlite           daily stock OHLCV
```

Deprecated:

```text
stocks_optimized.db
stocks_optimized.new.db
vietnam_stocks.db
```

These files are not the source of truth. Any code still depending on them should
be treated as migration debt.

## Refresh Jobs

Active cron jobs from `automation/setup_cron_vps.sh`:

| Schedule | Script | DB |
|---|---|---|
| `*/7 * * * *` | `fetch_sqlite/fetch_vci_screener.py` | `vci_screening.sqlite` |
| `5 * * * *` | `fetch_sqlite/fetch_vci_stats_financial.py` | `vci_stats_financial.sqlite` |
| `*/10 * * * *` | `fetch_sqlite/fetch_vci_news.py` | `vci_ai_news.sqlite` |
| `30 11 * * *` | `PRICE_HISTORY_DB_PATH=fetch_sqlite/price_history.sqlite python -m backend.updater.update_price_history` | `fetch_sqlite/price_history.sqlite` |
| `10 13 * * *` | `fetch_sqlite/fetch_vci_shareholders.py` | `vci_shareholders.sqlite` |
| `35 13 * * *` | `fetch_sqlite/fetch_vci_ratio_daily.py` | `vci_ratio_daily.sqlite` |
| `30 18 * * *` | `fetch_sqlite/fetch_vci_valuation.py` | `vci_valuation.sqlite` |
| `*/2 9-15 * * 1-5` | `fetch_sqlite/fetch_vci_foreign.py` | `vci_foreign.sqlite` |
| Sunday 02:00, even ISO weeks | `fetch_sqlite/fetch_vci_company.py` | `vci_company.sqlite` |

Scripts available but requiring explicit scheduling if production freshness is
needed:

| Script | DB |
|---|---|
| `fetch_sqlite/fetch_vci.py` | `index_history.sqlite` |
| `fetch_sqlite/fetch_macro_history.py` | `macro_history.sqlite` |
| `fetch_sqlite/fetch_fireant_macro.py` | `fireant_macro.sqlite` |
| `fetch_sqlite/fetch_vci_financial_statement.py` | `vci_financials.sqlite` |

## Backend Layers

```text
backend/
  server.py                  Flask app and WebSocket setup
  db_path.py                 DB path resolvers; legacy fallbacks should be migrated out
  data_sources/
    vci.py                   VCI real-time REST/WebSocket client
    sqlite_db.py             SQLite helper
    financial_repository.py  Financial statement reader helpers
  services/
    source_priority.py       PE/PB and ratio source priority
    valuation_service.py     DCF/comparable valuation
    vci_news_sqlite.py       AI news cache reader
    vci_standouts_sqlite.py  standouts cache reader
  routes/
    market/                  market endpoints
    stock/                   per-stock endpoints
    handlers/                shared route handlers
```

## Frontend Layers

```text
frontend-next/src/
  app/                       Next.js routes
  app/api/[...path]/route.ts Backend proxy
  components/                UI components
  components/StockDetail/    stock detail tabs
  components/Sidebar/        market widgets
  lib/api.ts                 shared API and WebSocket clients
  lib/stockApi.ts            stock-specific fetchers
  lib/types.ts               shared TypeScript types
```

## Source Priority

PE/PB:

```text
vci_ratio_daily.sqlite
  -> vci_stats_financial.sqlite
  -> vci_screening.sqlite
```

Company/industry:

```text
vci_company.sqlite
  -> vci_screening.sqlite
```

Financial statements:

```text
vci_financials.sqlite
  -> legacy financial_statement_data only while migration is incomplete
```

## Operational Boundary

- Fetch scripts own writes to their own DBs.
- Backend routes should not mutate canonical DBs during request handling.
- Runtime DB files are not code artifacts and should not be committed.
- New features should document their source DB and fallback chain in
  `docs/SQLITE_DATABASES.md`.
