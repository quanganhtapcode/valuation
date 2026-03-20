# Vietnam Stock Valuation Platform

Full-stack Vietnamese stock market platform. Flask/Gunicorn backend (VPS) + Next.js frontend (Vercel).
Covers real-time prices, financial statements, DCF valuation, sector heatmap, peer comparison, news, and more for 1,730+ listed stocks.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser                                                             │
│                                                                      │
│  REST   : stock.quanganh.org/api/*                                  │
│           → Vercel Next.js proxy (/api/[...path]/route.ts)          │
│              → api.quanganh.org/v1/valuation/* (nginx :443)         │
│                 → Flask :8000 (/api/*)                               │
│                                                                      │
│  WebSocket: wss://api.quanganh.org/v1/valuation/ws/market/indices   │
│           → nginx :443 (WS passthrough)                              │
│              → Flask :8000 (/ws/market/indices)                      │
│           [Vercel does NOT proxy WebSocket — browser connects direct]│
└─────────────────────────────────────────────────────────────────────┘
```

### Domain Mapping

| Domain | Host | Role |
|---|---|---|
| `stock.quanganh.org` | Vercel | Next.js frontend |
| `api.quanganh.org` | VPS `203.55.176.10` | API gateway (nginx) |

### nginx Routes on api.quanganh.org

| Prefix | Rewrite | Backend |
|---|---|---|
| `/v1/valuation/ws/*` | no rewrite | Flask :8000 `/ws/*` (WebSocket) |
| `/v1/valuation/*` | → `/api/$1` | Flask :8000 |

---

## Project Layout

```
/var/www/valuation/
│
├── backend/                        Flask API server (port 8000)
│   ├── server.py                   Main app entry, blueprint registration
│   ├── stock_provider.py           StockDataProvider — central data aggregation (2,395 lines)
│   ├── db_path.py                  DB path resolution with env/filesystem fallback
│   ├── cache_utils.py              In-memory TTL cache
│   ├── extensions.py               Flask extension init
│   ├── telemetry.py                Request latency tracking
│   ├── r2_client.py                Cloudflare R2 integration (Excel exports)
│   │
│   ├── routes/
│   │   ├── stock_routes.py         All stock API endpoints (1,428 lines)
│   │   ├── download_routes.py      Excel export via R2
│   │   ├── health_routes.py        /health check
│   │   ├── market/                 Market data endpoints (subpackage)
│   │   │   ├── heatmap.py          Sector heatmap (SQLite + real-time price patch)
│   │   │   ├── overview_refresh.py All-in-one: watchlist + heatmap + PE chart + news
│   │   │   ├── prices.py           Current prices
│   │   │   ├── movers.py           Top gainers/losers
│   │   │   ├── vci_indices.py      Market index data
│   │   │   ├── index_history.py    Historical index OHLCV
│   │   │   ├── news.py             Market news proxy
│   │   │   ├── gold.py             Gold prices
│   │   │   ├── world_indices.py    Global indices (S&P, Gold, BTC, etc.)
│   │   │   ├── cafef_proxies.py    CafeF PE chart data
│   │   │   ├── lottery.py          Lottery results
│   │   │   ├── deps.py             Shared dependencies (cache, TTL)
│   │   │   └── paths.py            DB path helpers
│   │   └── stock/                  Per-stock sub-routes
│   │       ├── history.py          Price + financial history
│   │       ├── valuation.py        DCF + comparables
│   │       ├── financial_dashboard.py
│   │       ├── revenue_profit.py
│   │       ├── charts.py
│   │       ├── news_events.py
│   │       └── missing_routes.py   Shareholders, officers
│   │
│   ├── data_sources/
│   │   ├── vci.py                  VCIClient — real-time prices via Vietcap REST/WebSocket
│   │   ├── sqlite_db.py            SQLite connection wrapper
│   │   └── financial_repository.py Financial data queries
│   │
│   ├── services/
│   │   ├── valuation_service.py    DCF + comparable valuation engine
│   │   ├── source_priority.py      Multi-source data merging with quality ranking
│   │   ├── gold.py                 Gold price service
│   │   ├── news_service.py         News aggregation
│   │   ├── financial_service.py    Financial statement queries
│   │   ├── vci_news_sqlite.py      News DB queries
│   │   └── vci_standouts_sqlite.py Top movers DB queries
│   │
│   └── updater/                    Daily data pipeline components
│       ├── update_price_history.py Daily OHLCV sync from VCI IQ API
│       ├── pipeline_steps.py       Entry points: update_financials, update_companies
│       ├── updaters.py             FinancialUpdater + CompanyUpdater classes
│       ├── database.py             SQLite context manager
│       └── valuation_datamart.py   Valuation metrics precomputation
│
├── fetch_sqlite/                   Real-time data fetchers + SQLite databases
│   ├── fetch_vci_screener.py       → vci_screening.sqlite      (every 5 min)
│   ├── fetch_vci_news.py           → vci_ai_news.sqlite        (every 5 min)
│   ├── fetch_vci_standouts.py      → vci_ai_standouts.sqlite   (every 15 min)
│   ├── fetch_vci.py                → index_history.sqlite      (every 15 min)
│   ├── fetch_vci_stats_financial.py→ vci_stats_financial.sqlite (every hour)
│   ├── fetch_vci_ratio_daily.py    → vci_ratio_daily.sqlite    (daily 13:30)
│   ├── fetch_vci_shareholders.py   → vci_shareholders.sqlite   (daily 13:00)
│   └── backups/vci_screening/      Weekly SQLite snapshots
│
├── scripts/
│   ├── telegram_uptime_report.sh   30-min health/uptime report to Telegram
│   ├── send_telegram_message.sh    Manual Telegram sender
│   ├── sync_overview.py            Refresh compatibility views
│   └── summarize_deploy_perf_history.py  Perf trend viewer
│
├── automation/
│   ├── deploy.ps1                  PowerShell deploy script (Windows → VPS)
│   ├── setup_systemd.sh            Install systemd service
│   ├── setup_cron_vps.sh           Install all cron jobs
│   └── loop_screener.sh            Screener loop helper
│
├── logs/
│   ├── pipeline.log                Daily pipeline run log
│   ├── price_history_update.log    Price history sync log
│   └── perf/deploy_perf_history.jsonl  Deploy p50/p95/p99 history
│
├── run_pipeline.py                 Daily pipeline orchestrator (systemd 18:00)
├── requirements.txt                Python dependencies
├── symbols.txt                     Stock ticker list
├── .env                            Secrets + env config (not committed)
│
└── DATABASE FILES
    ├── stocks_optimized.db         Main financials DB (~876 MB) ← STOCKS_DB_PATH
    ├── price_history.sqlite        Daily OHLCV (~241 MB)
    └── fetch_sqlite/*.sqlite       Real-time data (see below)
```

---

## Databases

| File | Size | Update Frequency | Contents |
|---|---|---|---|
| `stocks_optimized.db` | ~876 MB | Daily 18:00 (pipeline) | Financial statements, company info, ratios, views |
| `price_history.sqlite` | ~241 MB | Daily 11:30 (cron) | OHLCV for all stocks (10 years) |
| `fetch_sqlite/vci_screening.sqlite` | ~2.6 MB | Every 5 min | Market cap, PE, PB, ROE, daily change %, sector |
| `fetch_sqlite/vci_ai_news.sqlite` | ~868 KB | Every 5 min | News articles with sentiment |
| `fetch_sqlite/vci_stats_financial.sqlite` | ~10 MB | Every hour | Banking KPIs: NIM, CAR, LDR, NPL, CIR, CASA |
| `fetch_sqlite/vci_shareholders.sqlite` | ~978 KB | Daily 13:00 | Institutional + individual shareholders |
| `fetch_sqlite/vci_ai_standouts.sqlite` | ~12 KB | Every 15 min | Top 5 gainers + losers per exchange |
| `fetch_sqlite/index_history.sqlite` | ~123 KB | Every 15 min | VNINDEX, VN30, HNX, HNXUpcom OHLCV |
| `fetch_sqlite/vci_ratio_daily.sqlite` | — | Daily 13:30 | Daily PE, PB, dividendYield TTM |

**`stocks_optimized.db` schema:**

Real tables (written by updater pipeline):
`stocks`, `company_overview`, `stock_exchange`, `stock_industry`, `financial_ratios`, `income_statement`, `balance_sheet`, `cash_flow_statement`

Compatibility views (recreated after each pipeline run):
| View | Rows | Purpose |
|---|---|---|
| `overview` | 1,730 | Summary of each stock (price, PE, PB, ROE, ROA, market cap) |
| `ratio_wide` | ~73K | Financial ratio history by period |
| `company` | 1,730 | Company info, sector, exchange |
| `fin_stmt` | ~180K | Income statement JSON for revenue-profit API |

---

## API Endpoints

All served by Flask on port 8000. In production, accessed via `https://api.quanganh.org/v1/valuation/*`.

### Stock Data

| Method | Path | Description |
|---|---|---|
| GET | `/api/price/<symbol>` | Real-time price with change % |
| GET | `/api/current-price/<symbol>` | Alias for /price |
| GET | `/api/batch-price?symbols=A,B,C` | Batch prices (max 20 symbols) |
| GET | `/api/stock/<symbol>` | Full stock data + financials |
| GET | `/api/app-data/<symbol>` | Optimized reduced payload for frontend |
| GET | `/api/tickers` | Complete ticker list |
| GET | `/api/historical-chart-data/<symbol>` | ROE, ROA, PE, PB chart history |
| GET | `/api/stock/<symbol>/revenue-profit` | Revenue + net margin by period |
| GET | `/api/banking-kpi-history/<symbol>` | Bank KPIs (NIM, CAR, LDR, NPL, CIR, CASA) |
| GET/POST | `/api/valuation/<symbol>` | DCF + comparable valuation |
| GET | `/api/company/profile/<symbol>` | Company overview/description |
| GET | `/api/stock/peers/<symbol>` | Peer stocks + median PE |
| GET | `/api/holders/<symbol>` | Shareholders (VCI live fetch fallback) |
| GET | `/api/stock/<symbol>/officers` | Company officers |
| GET | `/api/news/<symbol>` | Company news (up to 15 articles) |
| GET | `/api/events/<symbol>` | Corporate events (dividends, IPO) |
| GET | `/api/download/excel/<symbol>` | Export to Excel (Cloudflare R2) |

### Market Data

| Method | Path | Description |
|---|---|---|
| GET | `/api/market/heatmap?exchange=HSX&limit=150` | Sector heatmap sorted by market cap |
| GET | `/api/market/overview-refresh` | All-in-one: watchlist + PE chart + news + heatmap |
| GET | `/api/market/vci-indices` | Market indices (VNINDEX, VN30, HNX) |
| GET | `/api/market/index-history/<index>` | Historical index OHLCV |
| GET | `/api/market/top-movers` | Top gainers/losers |
| GET | `/api/market/news` | General market news |
| GET | `/api/market/pe-chart` | PE ratio trends (CafeF) |
| GET | `/api/market/world-indices` | Global indices (S&P500, Gold, BTC) |
| GET | `/api/market/gold` | Gold prices |
| GET | `/api/market/prices` | Current prices for specified symbols |
| GET | `/api/market/lottery` | Lottery results |

### WebSocket (Real-time Streams)

| Path | Description |
|---|---|
| `wss://api.quanganh.org/v1/valuation/ws/market/indices` | Live VNINDEX, VN30, HNX updates |
| `wss://api.quanganh.org/v1/valuation/ws/market/prices` | Live price updates for all stocks |

> Vercel does not proxy WebSocket. The browser connects directly to `api.quanganh.org`.

### Other

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/api/polymarket/events` | Economic prediction markets (Fed, S&P, recession) |

---

## Cron Schedule

All jobs managed via `crontab` + one systemd service.

| Schedule | Script | Output DB | Log |
|---|---|---|---|
| Every 5 min | `fetch_sqlite/fetch_vci_screener.py` | `vci_screening.sqlite` | `cron_screener.log` |
| Every 5 min | `fetch_sqlite/fetch_vci_news.py` | `vci_ai_news.sqlite` | `cron_vci_ai_news.log` |
| Every 15 min | `fetch_sqlite/fetch_vci.py` | `index_history.sqlite` | `cron.log` |
| Every 15 min | `fetch_sqlite/fetch_vci_standouts.py` | `vci_ai_standouts.sqlite` | `cron_vci_ai_standouts.log` |
| Every 30 min | `scripts/telegram_uptime_report.sh` | — | `telegram_uptime.log` |
| Every hour | `fetch_sqlite/fetch_vci_stats_financial.py` | `vci_stats_financial.sqlite` | `cron_stats_financial.log` |
| Daily 11:30 UTC | `backend/updater/update_price_history.py` | `price_history.sqlite` | `price_history_update.log` |
| Daily 13:00 | `fetch_sqlite/fetch_vci_shareholders.py` | `vci_shareholders.sqlite` | `cron_shareholders.log` |
| Daily 13:30 | `fetch_sqlite/fetch_vci_ratio_daily.py` | `vci_ratio_daily.sqlite` | `cron_ratio_daily.log` |
| **Daily 18:00** (systemd) | `run_pipeline.py` | `stocks_optimized.db` | `logs/pipeline.log` |

Reinstall cron jobs:
```bash
bash /var/www/valuation/automation/setup_cron_vps.sh
```

---

## Caching Strategy

| Layer | TTL | Type | What |
|---|---|---|---|
| VCI prices | 7s | In-memory (`VCIClient._price_cache`) | Real-time stock prices |
| VCI indices | 3s | In-memory (`VCIClient._indices_cache`) | VNINDEX, VN30, HNX |
| Heatmap / overview | 45s | In-memory (market_cache) | Sector heatmap |
| Market news, PE chart | 45–600s | In-memory (market_cache) | Varies by endpoint |
| Stock routes | 10 min | In-memory (cache_utils) | Historical charts, banking KPIs |
| Company profile, news | 10 min | In-memory (per-symbol) | Company data |
| Next.js proxy | 30–120s | Vercel edge (s-maxage) | API responses at CDN layer |

---

## Key Components

### VCIClient (`backend/data_sources/vci.py`)
Real-time prices and market indices from Vietcap API.
- Background refresh thread polls REST API every 3s
- RAM cache with 7s TTL; supplies all `/ws/market/prices` WebSocket updates
- No vnstock quota consumed

### StockDataProvider (`backend/stock_provider.py`)
Central data aggregation layer. Loads from SQLite, VCI cache, and vnstock API.
Key methods: `get_stock_data()`, `get_current_price_with_change()`, `get_stock_peers()`

### ValuationService (`backend/services/valuation_service.py`)
DCF (Discounted Cash Flow) + comparable company valuation engine.
Produces target price, growth projections, and sensitivity tables.

### SourcePriority (`backend/services/source_priority.py`)
Merges financial data from VCI screening DB, stats DB, and vnstock.
Implements quality ranking and fallback logic across sources.

### Heatmap (`backend/routes/market/heatmap.py`)
- Stock list + sector grouping → `vci_screening.sqlite` (sorted by market cap)
- Real-time price + change % → `VCIClient._price_cache` (falls back to SQLite)
- Each stock: `{ ticker, name, sector, cap, price, change }`
- NOT using VCI's `getByIcb` endpoint

---

## Daily Pipeline (`run_pipeline.py`)

Runs at 18:00 VN time via systemd:

1. **Update financials** — fetch BCTC (balance sheet, income, cashflow, ratios) via vnstock API
   Smart-skip: stocks updated within the last 30 days are skipped to save API quota
2. **Update companies** (Sundays only) — company info, officers
3. **Refresh compatibility views** — recreate `overview`, `ratio_wide`, `company`, `fin_stmt` views
4. **Update price history** — sync OHLCV from VCI IQ API into `price_history.sqlite`

Check pipeline status:
```bash
tail -f /var/www/valuation/logs/pipeline.log
journalctl -u valuation.service -n 50
```

---

## Local Setup

```bash
python -m venv .venv
source .venv/bin/activate       # Linux/Mac
# .venv\Scripts\activate        # Windows
pip install -r requirements.txt
```

Create `.env` (copy from `.env.example`):
```env
VNSTOCK_API_KEY=vnstock_xxxxxxxxxxxxxxxxxxxxxxxx
STOCKS_DB_PATH=/var/www/valuation/stocks_optimized.db
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...
```

Start API server:
```bash
python backend/server.py
```

Run pipeline manually:
```bash
python run_pipeline.py
```

Run price history update only:
```bash
python -m backend.updater.update_price_history
# Test mode (first 5 symbols):
python -m backend.updater.update_price_history --test
# Specific symbols:
python -m backend.updater.update_price_history --symbols VCB,FPT,VNM
```

---

## Deploy to VPS

From Windows developer machine using PowerShell:

```powershell
# Standard deploy
.\automation\deploy.ps1 -CommitMessage "update"

# With DB upload to GitHub Releases
.\automation\deploy.ps1 -CommitMessage "update" -IncludeDatabase

# Custom performance gate thresholds
.\automation\deploy.ps1 -CommitMessage "update" -PerfP95HardLimitMs 320 -PerfP99HardLimitMs 650

# Auto profile (production/staging/local)
.\automation\deploy.ps1 -CommitMessage "update" -PerfProfile auto

# Skip performance gate (not recommended)
.\automation\deploy.ps1 -CommitMessage "update" -SkipPerfGate
```

Deploy script:
- Commits and pushes code to git
- SSHes into VPS, pulls, restarts service
- Runs benchmark (p50/p95/p99) against live API
- Sends Telegram pass/fail notification
- Appends perf results to `logs/perf/deploy_perf_history.jsonl`

View perf trend:
```bash
python scripts/summarize_deploy_perf_history.py --last 30
```

---

## VPS Operations

### Service Management

```bash
# Restart backend
systemctl restart valuation.service

# View live logs
journalctl -u valuation.service -f

# Health check
curl -s http://localhost:8000/health | python3 -m json.tool
```

### Quick API Test

```bash
BASE="http://localhost:8000"
for ep in /health "/api/stock/VCB" "/api/current-price/VCB" "/api/tickers" \
  "/api/market/vci-indices" "/api/market/news" "/api/market/heatmap?exchange=HSX&limit=10" \
  "/api/market/top-movers" "/api/market/gold"; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$ep")
  echo "$status  $ep"
done
```

### First-Time VPS Setup

```bash
# 1. Install systemd service
bash /var/www/valuation/automation/setup_systemd.sh

# 2. Install cron jobs
bash /var/www/valuation/automation/setup_cron_vps.sh

# 3. Telegram credentials
printf 'TELEGRAM_BOT_TOKEN=<token>\nTELEGRAM_CHAT_ID=<chat_id>\n' \
  > /var/www/valuation/.telegram_uptime.env
chmod 600 /var/www/valuation/.telegram_uptime.env

# 4. Rebuild compatibility views if missing
source /var/www/valuation/.env
/var/www/valuation/.venv/bin/python3 /var/www/valuation/scripts/sync_overview.py

# 5. Start
systemctl start valuation.service
```

---

## Troubleshooting

**"no such table: overview" or "no such table: company"**
Views were dropped (after DB replacement or WAL checkpoint). Recreate them:
```bash
source /var/www/valuation/.env
/var/www/valuation/.venv/bin/python3 /var/www/valuation/scripts/sync_overview.py
systemctl restart valuation.service
```

**Pipeline crashes with rate-limit after a few seconds**
`VNSTOCK_API_KEY` is missing or service doesn't load `.env`. Check:
```bash
systemctl show valuation.service | grep EnvironmentFile
```

**History chart shows blank (all zero prices)**
VCI IQ API uses `openPrice`/`closePrice`/`highestPrice`/`lowestPrice`/`totalVolume` field names.
Re-run the price history updater:
```bash
python -m backend.updater.update_price_history
```

**Crontab not running (log file ends in `.log\r`)**
CRLF line endings in crontab. Fix:
```bash
crontab -l | tr -d '\r' | crontab -
```

**Wrong DB used at startup**
Confirm `STOCKS_DB_PATH` is set in `/etc/systemd/system/valuation.service`:
```ini
Environment="STOCKS_DB_PATH=/var/www/valuation/stocks_optimized.db"
```

**WebSocket not connecting**
Vercel does not proxy WebSocket. Browser must connect directly to `wss://api.quanganh.org/v1/valuation/ws/market/indices`.
Check env var `NEXT_PUBLIC_BACKEND_WS_URL=wss://api.quanganh.org/v1/valuation` is set in Vercel dashboard.

---

## Environment Variables

### Backend (`.env` on VPS)

| Variable | Description |
|---|---|
| `VNSTOCK_API_KEY` | vnstock API key (get free at vnstocks.com/login) |
| `VNSTOCK_API_KEYS` | Multiple keys for rotation (comma-separated) |
| `STOCKS_DB_PATH` | Path to `stocks_optimized.db` |
| `PRICE_HISTORY_DB_PATH` | Path to `price_history.sqlite` |
| `VCI_SCREENING_DB_PATH` | Path to `vci_screening.sqlite` |
| `VCI_STATS_FINANCIAL_DB_PATH` | Path to `vci_stats_financial.sqlite` |
| `VCI_SHAREHOLDERS_DB_PATH` | Path to `vci_shareholders.sqlite` |
| `VCI_RATIO_DAILY_DB_PATH` | Path to `vci_ratio_daily.sqlite` |
| `R2_ACCOUNT_ID` | Cloudflare R2 account |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret key |
| `R2_BUCKET_NAME` | R2 bucket for Excel exports |
| `OVERVIEW_PRICE_SYNC_SECONDS` | Price cache TTL (default: 45) |
| `OVERVIEW_NEWS_CACHE_SECONDS` | News cache TTL |
| `OVERVIEW_PE_CACHE_SECONDS` | PE chart cache TTL |
| `VCI_INDEX_REST_POLL_IDLE_SECONDS` | Index polling interval (default: 3) |

### Frontend (Vercel Dashboard)

| Variable | Value |
|---|---|
| `BACKEND_API_URL` | `https://api.quanganh.org/v1/valuation` |
| `BACKEND_API_URL_LOCAL` | `http://127.0.0.1:8000/api` |
| `NEXT_PUBLIC_BACKEND_WS_URL` | `wss://api.quanganh.org/v1/valuation` |

---

## Data Sources

| Source | What | Rate Limit |
|---|---|---|
| **VCI (Vietcap) IQ API** | Real-time prices, OHLCV history, screening data, news, shareholders, banking KPIs | 1000s req/sec (no auth) |
| **vnstock** | Financial statements (BCTC), company info | 20 req/min (guest) / higher with API key |
| **CafeF** | PE/PB market chart data | Proxied, ~10 req/min |
| **Polymarket** | Economic prediction markets | Public API |

> **Important:** Without a valid `VNSTOCK_API_KEY`, the pipeline runs as "Guest" (20 req/min) and will crash from rate limiting within seconds.
