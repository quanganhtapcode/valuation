# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

Vietnamese stock analysis and valuation platform with:

- **Frontend:** Next.js 16 + React 19 + TypeScript + Tailwind CSS in `frontend-next/`
- **Backend:** Flask + Python in `backend/`
- **Canonical data:** SQLite files in `fetch_sqlite/`

Legacy monolithic DBs `stocks_optimized.db`, `stocks_optimized.new.db` and
`vietnam_stocks.db` are not canonical. Do not add new dependencies on them.

## Commands

Frontend:

```bash
cd frontend-next && npm run dev
cd frontend-next && npm run lint
cd frontend-next && npm run build
```

Backend:

```bash
python -m backend.server
```

Root convenience:

```bash
npm run start-backend
npm run start-frontend
```

Representative fetchers:

```bash
python fetch_sqlite/fetch_vci_screener.py --db fetch_sqlite/vci_screening.sqlite
python fetch_sqlite/fetch_vci_stats_financial.py --db fetch_sqlite/vci_stats_financial.sqlite
python fetch_sqlite/fetch_vci_news.py --db fetch_sqlite/vci_ai_news.sqlite --pages 5 --page-size 50
python fetch_sqlite/fetch_vci_ratio_daily.py --db fetch_sqlite/vci_ratio_daily.sqlite
python -m backend.updater.update_price_history
```

## Architecture Notes

The frontend uses `src/app/api/[...path]/route.ts` as a REST proxy to the Flask
backend. WebSocket traffic connects directly to `api.quanganh.org` because
Vercel does not proxy WebSocket.

Backend layers:

```text
routes/        Flask blueprints and endpoint definitions
services/      business logic, valuation and SQLite readers
data_sources/  VCI clients and low-level data adapters
updater/       batch helpers and legacy jobs
```

Canonical SQLite sources:

```text
fetch_sqlite/vci_company.sqlite
fetch_sqlite/vci_financials.sqlite
fetch_sqlite/vci_screening.sqlite
fetch_sqlite/vci_stats_financial.sqlite
fetch_sqlite/vci_ratio_daily.sqlite
fetch_sqlite/vci_shareholders.sqlite
fetch_sqlite/vci_ai_news.sqlite
fetch_sqlite/vci_news_events.sqlite
fetch_sqlite/vci_foreign.sqlite
fetch_sqlite/vci_valuation.sqlite
fetch_sqlite/index_history.sqlite
fetch_sqlite/macro_history.sqlite
fetch_sqlite/fireant_macro.sqlite
fetch_sqlite/valuation_cache.sqlite
fetch_sqlite/price_history.sqlite
```

Source priority for PE/PB:

```text
vci_ratio_daily.sqlite -> vci_stats_financial.sqlite -> vci_screening.sqlite
```

## Environment

See `.env` and `frontend-next/.env.example`.

Important current variables:

- `VCI_SCREENING_DB_PATH`
- `VCI_STATS_FINANCIAL_DB_PATH`
- `VCI_RATIO_DAILY_DB_PATH`
- `VCI_COMPANY_DB_PATH`
- `VCI_FINANCIAL_STATEMENT_DB_PATH`
- `VCI_NEWS_DB_PATH`
- `VCI_NEWS_EVENTS_DB_PATH`
- `VCI_SHAREHOLDERS_DB_PATH`
- `VCI_VALUATION_DB_PATH`
- `INDEX_HISTORY_DB_PATH`
- `VALUATION_CACHE_DB_PATH`
- `PRICE_HISTORY_DB_PATH`
- `R2_*` for Excel exports

`STOCKS_DB_PATH` and `VIETNAM_STOCK_DB_PATH` are legacy compatibility names only.

## Documentation

Start with:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/RUNBOOK.md`
- `docs/SQLITE_DATABASES.md`
- `docs/SQLITE_ANALYSIS.md`
