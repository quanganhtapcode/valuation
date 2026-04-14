# QWEN.md — Vietnam Stock Valuation Platform

## Project Overview

A full-stack Vietnamese stock market platform covering **1,730+ listed stocks** on the HSX, HNX, and UPCOM exchanges. It provides real-time prices, financial statements, DCF/comparable-company valuation, sector heatmaps, peer comparison, news aggregation, and more.

### Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 16 + React 19 + TypeScript + Tailwind CSS + Tremor + Recharts |
| **Backend** | Flask + Gunicorn + gevent + Flask-Sock (WebSocket) |
| **Database** | SQLite (multiple files: `stocks_optimized.db`, `price_history.sqlite`, `fetch_sqlite/*.sqlite`) |
| **Data Sources** | VCI (Vietcap) IQ API, vnstock API, CafeF proxies, Polymarket |
| **Deployment** | VPS (Flask + nginx on `api.quanganh.org`) + Vercel (Next.js on `stock.quanganh.org`) |
| **CI/CD** | PowerShell deploy script, systemd service, cron jobs |

---

## Architecture

```
Browser (stock.quanganh.org)
  ├─ REST  → Next.js API proxy (route.ts) → api.quanganh.org/v1/valuation/* → Flask :8000
  └─ WS    → wss://api.quanganh.org/v1/valuation/ws/market/indices (direct, bypasses Vercel)
```

Key domains:

| Domain | Host | Role |
|---|---|---|
| `stock.quanganh.org` | Vercel | Next.js frontend |
| `api.quanganh.org` | VPS `203.55.176.10` | nginx → Flask :8000 |

### Backend Structure (`backend/`)

```
backend/
├── server.py                   # Flask app entry, blueprints, WebSocket routes
├── stock_provider.py           # Central data aggregation (StockDataProvider)
├── cache_utils.py              # In-memory TTL cache with named namespaces
├── db_path.py                  # DB path resolution with env/filesystem fallback
├── extensions.py               # Flask extension initialization
├── telemetry.py                # Request latency tracking
├── r2_client.py                # Cloudflare R2 integration (Excel exports)
│
├── routes/
│   ├── stock/                  # Per-stock endpoints
│   │   ├── history.py          # Price + financial history
│   │   ├── valuation.py        # DCF + comparable valuation
│   │   ├── financial_dashboard.py
│   │   ├── revenue_profit.py
│   │   ├── charts.py
│   │   ├── news_events.py
│   │   └── missing_routes.py   # Shareholders, officers
│   └── market/                 # Market-wide endpoints
│       ├── heatmap.py          # Sector heatmap
│       ├── overview_refresh.py # All-in-one: watchlist + heatmap + PE chart + news
│       ├── prices.py           # Current prices
│       ├── movers.py           # Top gainers/losers
│       ├── vci_indices.py      # Market indices
│       ├── index_history.py    # Historical index OHLCV
│       ├── news.py             # Market news
│       ├── gold.py             # Gold prices
│       ├── world_indices.py    # Global indices
│       ├── cafef_proxies.py    # CafeF PE chart data
│       ├── lottery.py          # Lottery results
│       ├── deps.py             # Shared dependencies
│       └── paths.py            # DB path helpers
│
├── services/
│   ├── valuation_service.py    # DCF + comparable valuation engine
│   ├── source_priority.py      # Multi-source data merging with quality ranking
│   ├── gold.py                 # Gold price service
│   ├── news_service.py         # News aggregation
│   ├── financial_service.py    # Financial statement queries
│   ├── vci_news_sqlite.py      # News DB queries
│   └── vci_standouts_sqlite.py # Top movers DB queries
│
├── data_sources/
│   ├── vci.py                  # VCIClient — real-time prices via Vietcap REST/WebSocket
│   ├── sqlite_db.py            # SQLite connection wrapper
│   └── financial_repository.py # Financial data queries
│
└── updater/                    # Daily data pipeline
    ├── pipeline_steps.py       # Entry points: update_financials, update_companies
    ├── updaters.py             # FinancialUpdater + CompanyUpdater
    ├── update_price_history.py # OHLCV sync from VCI IQ API
    ├── database.py             # SQLite context manager
    ├── batch_valuations.py     # Batch DCF valuation computation
    ├── batch_news.py           # Batch news/events aggregation
    └── valuation_datamart.py   # Valuation metrics precomputation
```

---

## Databases

| File | Update Frequency | Contents |
|---|---|---|
| `stocks_optimized.db` (~876 MB) | Daily 18:00 (systemd) | Financial statements, company info, ratios, compatibility views |
| `price_history.sqlite` (~241 MB) | Daily 11:30 (cron) | OHLCV for all stocks |
| `fetch_sqlite/vci_screening.sqlite` | Every 5 min | Market cap, PE, PB, ROE, daily change %, sector |
| `fetch_sqlite/vci_ai_news.sqlite` | Every 5 min | News articles with sentiment |
| `fetch_sqlite/vci_stats_financial.sqlite` | Every hour | Banking KPIs: NIM, CAR, LDR, NPL, CIR, CASA |
| `fetch_sqlite/vci_shareholders.sqlite` | Daily 13:00 | Institutional + individual shareholders |
| `fetch_sqlite/vci_ai_standouts.sqlite` | Every 15 min | Top 5 gainers + losers per exchange |
| `fetch_sqlite/index_history.sqlite` | Every 15 min | VNINDEX, VN30, HNX, HNXUpcom OHLCV |
| `fetch_sqlite/vci_ratio_daily.sqlite` | Daily 13:30 | Daily PE, PB, dividendYield TTM |

### `stocks_optimized.db` Schema

**Real tables** (written by updater pipeline):
`stocks`, `company_overview`, `stock_exchange`, `stock_industry`, `financial_ratios`, `income_statement`, `balance_sheet`, `cash_flow_statement`

**Compatibility views** (recreated after each pipeline run):
| View | Rows | Purpose |
|---|---|---|
| `overview` | 1,730 | Summary (price, PE, PB, ROE, ROA, market cap) |
| `ratio_wide` | ~73K | Financial ratio history |
| `company` | 1,730 | Company info, sector, exchange |
| `fin_stmt` | ~180K | Income statement JSON for APIs |

---

## Key Commands

### Backend

```bash
# Dev server (port 5000)
python -m backend.server

# Production (gunicorn on port 8000)
gunicorn --bind 0.0.0.0:8000 --worker-class gevent --workers 4 backend.server:app

# Run daily pipeline
python run_pipeline.py

# Price history update only
python -m backend.updater.update_price_history
python -m backend.updater.update_price_history --test           # First 5 symbols
python -m backend.updater.update_price_history --symbols VCB,FPT,VNM

# Rebuild compatibility views
source /var/www/valuation/.env
.venv/bin/python3 scripts/sync_overview.py
```

### Frontend

```bash
cd frontend-next
npm install
npm run dev       # Dev server (localhost:3000)
npm run build     # Production build
npm run lint      # ESLint
```

### Root (runs both)

```bash
npm run start-backend   # python -m backend.server
npm run start-frontend  # cd frontend-next && npm run dev
```

### VPS Operations

```bash
systemctl restart valuation.service        # Restart Flask
systemctl status valuation.service         # Check status
journalctl -u valuation.service -f         # Live logs
journalctl -u valuation.service -n 50      # Last 50 lines

curl -s http://localhost:8000/health       # Health check
bash automation/setup_cron_vps.sh           # Reinstall cron jobs
bash automation/setup_systemd.sh            # Reinstall systemd service
```

### Deploy (from Windows dev machine)

```powershell
.\automation\deploy.ps1 -CommitMessage "update"
.\automation\deploy.ps1 -CommitMessage "update" -IncludeDatabase
.\automation\deploy.ps1 -CommitMessage "update" -PerfProfile auto
.\automation\deploy.ps1 -CommitMessage "update" -SkipPerfGate
```

---

## Environment Variables

### Backend (`.env` on VPS)

| Variable | Description |
|---|---|
| `VNSTOCK_API_KEY` | vnstock API key (required for financial data fetch) |
| `VNSTOCK_API_KEYS` | Multiple keys for rotation (comma-separated) |
| `STOCKS_DB_PATH` | Path to `stocks_optimized.db` |
| `PRICE_HISTORY_DB_PATH` | Path to `price_history.sqlite` |
| `VCI_SCREENING_DB_PATH` | Path to `vci_screening.sqlite` |
| `VCI_STATS_FINANCIAL_DB_PATH` | Path to `vci_stats_financial.sqlite` |
| `VCI_SHAREHOLDERS_DB_PATH` | Path to `vci_shareholders.sqlite` |
| `VCI_RATIO_DAILY_DB_PATH` | Path to `vci_ratio_daily.sqlite` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Cloudflare R2 for Excel exports |
| `OVERVIEW_PRICE_SYNC_SECONDS` | Price cache TTL (default: 45) |
| `SKIP_IF_UPDATED_WITHIN_DAYS` | Smart-skip threshold for financial data (default: 3) |

### Frontend (Vercel Dashboard)

| Variable | Value |
|---|---|
| `BACKEND_API_URL` | `https://api.quanganh.org/v1/valuation` |
| `NEXT_PUBLIC_BACKEND_WS_URL` | `wss://api.quanganh.org/v1/valuation` |

---

## Caching Strategy

| Layer | TTL | Type | What |
|---|---|---|---|
| VCI prices | 7s | In-memory (`VCIClient._price_cache`) | Real-time stock prices |
| VCI indices | 3s | In-memory (`VCIClient._indices_cache`) | VNINDEX, VN30, HNX |
| Heatmap / overview | 45s | In-memory (`market_cache`) | Sector heatmap |
| Market news, PE chart | 45–600s | In-memory | Varies by endpoint |
| Stock routes | 10 min | In-memory (`cache_utils`) | Historical charts, banking KPIs |
| Company profile, news | 10 min | In-memory (per-symbol) | Company data |
| Next.js proxy | 30–120s | Vercel edge (s-maxage) | CDN layer |

Cache invalidation after pipeline updates is handled via `cache_invalidate_namespaces()` in `cache_utils.py`.

---

## Pipeline (`run_pipeline.py`)

Runs daily at 18:00 VN time via systemd. Steps:

1. **Update financials** — BCTC (balance sheet, income, cashflow, ratios) via vnstock API
   - Smart-skip: stocks updated within the last 3 days are skipped
2. **Update company info** (Wed/Sun only) — company profile, officers
3. **Refresh compatibility views** — recreate `overview`, `ratio_wide`, `company`, `fin_stmt`
4. **Batch valuations** — compute DCF/intrinsic value for all stocks → `valuation_cache.sqlite`
5. **Batch news/events** — incremental news aggregation
6. **Update price history** — sync OHLCV from VCI IQ API

Check status: `tail -f /var/www/valuation/logs/pipeline.log`

---

## Cron Schedule

| Schedule | Script | Output |
|---|---|---|
| Every 5 min | `fetch_sqlite/fetch_vci_screener.py` | `vci_screening.sqlite` |
| Every 5 min | `fetch_sqlite/fetch_vci_news.py` | `vci_ai_news.sqlite` |
| Every 15 min | `fetch_sqlite/fetch_vci.py` | `index_history.sqlite` |
| Every 15 min | `fetch_sqlite/fetch_vci_standouts.py` | `vci_ai_standouts.sqlite` |
| Every 30 min | `scripts/telegram_uptime_report.sh` | Health report to Telegram |
| Every hour | `fetch_sqlite/fetch_vci_stats_financial.py` | `vci_stats_financial.sqlite` |
| Daily 11:30 | `backend/updater/update_price_history.py` | `price_history.sqlite` |
| Daily 13:00 | `fetch_sqlite/fetch_vci_shareholders.py` | `vci_shareholders.sqlite` |
| Daily 13:30 | `fetch_sqlite/fetch_vci_ratio_daily.py` | `vci_ratio_daily.sqlite` |
| Daily 18:00 (systemd) | `run_pipeline.py` | `stocks_optimized.db` |

---

## WebSocket Endpoints

Vercel does **not** proxy WebSocket. The browser connects directly to `api.quanganh.org`.

| Path | Description |
|---|---|
| `/ws/market/indices` | Live VNINDEX, VN30, HNX updates (every 500ms, deduplicated) |
| `/ws/market/prices` | Live price updates for all stocks (push-based from VCI background thread) |
| `/api/ws/market/prices` | Same as above (nginx rewrite path) |
| `/ws/market/ff-prices` | Forex Factory price stream |

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `"no such table: overview"` | Run `scripts/sync_overview.py` and restart service |
| **Pipeline rate-limits immediately** | `VNSTOCK_API_KEY` is missing — check `systemctl show valuation.service \| grep EnvironmentFile` |
| **History chart shows blank (zero prices)** | VCI IQ API uses `openPrice`/`closePrice` fields — re-run `update_price_history` |
| **Crontab not running (`.log\r` in logs)** | CRLF in crontab — fix with `crontab -l \| tr -d '\r' \| crontab -` |
| **Wrong DB at startup** | Check `STOCKS_DB_PATH` in `/etc/systemd/system/valuation.service` |
| **WebSocket not connecting** | Browser must connect directly to `wss://api.quanganh.org/...`, not via Vercel proxy |

---

## Local Development Setup

```bash
# 1. Create virtual environment
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 2. Create .env file (copy from .env.example)
# Required: VNSTOCK_API_KEY, STOCKS_DB_PATH, R2 credentials

# 3. Start backend
python -m backend.server   # Runs on port 5000

# 4. Start frontend (in another terminal)
cd frontend-next && npm install && npm run dev  # Runs on port 3000
```

---

## Data Sources

| Source | What | Rate Limit |
|---|---|---|
| **VCI (Vietcap) IQ API** | Real-time prices, OHLCV history, screening, news, shareholders, banking KPIs | 1000s req/sec (no auth) |
| **vnstock** | Financial statements (BCTC), company info | 20 req/min (guest) / higher with API key |
| **CafeF** | PE/PB market chart data | ~10 req/min (proxied) |
| **Polymarket** | Economic prediction markets | Public API |

> **Critical:** Without a valid `VNSTOCK_API_KEY`, the pipeline runs as "Guest" (20 req/min) and crashes from rate limiting within seconds.

---

## File Not Committed (in .gitignore)

- `.env` — secrets and configuration
- `*.db`, `*.sqlite` — database files (large, contain live data)
- `logs/` — pipeline and cron logs
- `__pycache__/`, `.venv/`, `node_modules/` — build artifacts
