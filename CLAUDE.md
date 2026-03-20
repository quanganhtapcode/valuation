# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vietnamese stock analysis platform with real-time WebSocket streaming, multi-source data aggregation, financial valuation models (FCFE/FCFF/P/E/P/B), and automated data pipelines.

- **Frontend:** Next.js 16 + React 19 + TypeScript + Tailwind CSS (`frontend-next/`)
- **Backend:** Flask 2.3 + Python + SQLite (`backend/`)
- **Pipeline:** Daily vnstock financial data fetcher (`run_pipeline.py`)

## Commands

### Frontend
```bash
cd frontend-next && npm run dev       # Dev server
cd frontend-next && npm run build     # Production build
cd frontend-next && npm run lint      # ESLint
```

### Backend
```bash
python -m backend.server              # Flask dev server (port 5000)
python run_pipeline.py                # Daily financial data pipeline
```

### Root (runs both)
```bash
npm run start-backend                 # python -m backend.server
npm run start-frontend                # cd frontend-next && npm run dev
```

### Deployment (Windows PowerShell)
```powershell
./automation/deploy.ps1 -CommitMessage "update"
./automation/deploy.ps1 -CommitMessage "update" -IncludeDatabase
./automation/deploy.ps1 -CommitMessage "update" -PerfProfile auto
```

## Architecture

### API Proxy Pattern
The frontend never calls the Flask backend directly. All requests go through a Next.js API proxy at `app/api/[...path]/route.ts`, which forwards to the Flask backend. This unifies CORS handling and caching.

### Backend Layers
```
routes/         → Flask blueprints (HTTP endpoint definitions)
services/       → Business logic (data processing, valuation calculations)
data_sources/   → Data integration (SQLite, VCI WebSocket, CafeF proxies)
models.py       → Valuation math (FCFE/FCFF/Justified P/E/P/B)
stock_provider.py → VNStock API wrapper
cache_utils.py  → In-memory TTL cache with named namespaces
```

**Key route modules:**
- `routes/stock/` — per-stock endpoints (profile, valuation, financials, prices, charts)
- `routes/market/` — market-wide endpoints (indices, gold, movers, heatmap, news)

### Real-time Data Flow
A background thread (`data_sources/vci.py`) polls VCI every ~3 seconds and stores prices in memory. WebSocket endpoints at `/ws/market/prices` and `/ws/market/indices` stream this data to browsers. The frontend connects via `lib/api.ts`.

### Database
`vietnam_stocks.db` (~1.6 GB SQLite) holds financial statements for ~1730 symbols:
- Tables: `income_statement`, `balance_sheet`, `cash_flow_statement`, `financial_ratios`, `stocks`, `company_overview`
- Compatibility views: `overview`, `ratio_wide`, `company`, `fin_stmt` (created by `scripts/create_compat_views.py`)
- Refreshed daily at 18:00 VN time via `run_pipeline.py` → `backend/updater/pipeline_steps.py`

Smaller SQLite files in `fetch_sqlite/` are refreshed every 5–15 minutes by cron:
- `index_history.sqlite`, `vci_screening.sqlite`, `vci_ai_news.sqlite`, `vci_ai_standouts.sqlite`

### Valuation Models
`backend/models.py` implements FCFE, FCFF, Justified P/E, and Justified P/B. Results are weighted-averaged; banks use only P/E and P/B. Calculations are triggered via `POST /api/valuation/{symbol}` with user-supplied assumptions (growth rate, discount rate, etc.).

### Caching
Multi-layer: browser session storage → Flask in-memory TTL cache (`cache_utils.py`) → SQLite → live API. Cache namespaces include `stockQuotes` (600s), `stockDetails` (600s), and various market keys (45s–3600s). The pipeline invalidates relevant namespaces after DB updates.

### Frontend Structure
- `app/stock/[symbol]/` — dynamic stock detail page with tabs (Overview, Financials, Valuation, Analysis, Holders, Price History)
- `components/StockDetail/` — one component per tab
- `components/Sidebar/` — market pulse widgets (indices, gold, movers, lottery, watchlist)
- `lib/api.ts` — all API fetchers + WebSocket stream handlers + formatters
- `lib/stockApi.ts` — stock-specific API calls
- `lib/reportGenerator.ts` — Excel export via ExcelJS

## Environment Variables
See `.env` (root, for backend) and `frontend-next/.env.example` (for frontend). Key variables: `VNSTOCK_API_KEY`, `STOCKS_DB_PATH`, Cloudflare R2 credentials.
