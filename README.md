# Vietnam Stock Valuation Platform

Nền tảng định giá và theo dõi thị trường chứng khoán Việt Nam. Hệ thống gồm
Next.js frontend, Flask backend, WebSocket real-time và một tầng SQLite cục bộ
trong `fetch_sqlite/`.

> Data source hiện tại: dùng các DB trong `fetch_sqlite/`. Hai DB legacy
> `stocks_optimized.db` và `stocks_optimized.new.db` đã bỏ, không còn là nguồn
> dữ liệu chuẩn.

## Production Topology

| Domain | Host | Vai trò |
|---|---|---|
| `stock.quanganh.org` | Vercel | Next.js frontend |
| `api.quanganh.org` | VPS `203.55.176.10` | nginx gateway tới Flask/Gunicorn |

Luồng request:

```text
Browser
  REST      stock.quanganh.org/api/* -> Next.js proxy -> api.quanganh.org/v1/valuation/* -> Flask /api/*
  WebSocket wss://api.quanganh.org/v1/valuation/ws/* -> nginx -> Flask /ws/*
```

Vercel không proxy WebSocket. Frontend phải dùng
`NEXT_PUBLIC_BACKEND_WS_URL=wss://api.quanganh.org/v1/valuation`.

## Repository Layout

```text
/var/www/valuation
├── backend/                 Flask app, routes, services, adapters
│   ├── server.py            API/WebSocket entrypoint
│   ├── db_path.py           SQLite path resolver and legacy fallback handling
│   ├── routes/              /api/* and /ws/* endpoints
│   ├── services/            Valuation, source priority, news, stock services
│   └── updater/             Legacy/batch helpers that should read fetch_sqlite data
├── fetch_sqlite/            Canonical SQLite DBs and fetch scripts
├── frontend-next/           Next.js 16 + React 19 frontend
├── scripts/                 Utility scripts
├── automation/              VPS deploy/systemd/cron helpers
├── docs/                    Architecture, runbook, SQLite docs
├── update_excel_data.py     VietCap Excel download/upload workflow
├── requirements.txt         Python dependencies
└── package.json             Convenience scripts
```

Runtime files such as `fetch_sqlite/*.sqlite`, WAL/SHM files, `*.db`, logs and
backups are generated artifacts. Do not commit them unless the task explicitly
requires a data artifact.

## Development Commands

Install backend dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Run backend and frontend:

```bash
npm run start-backend
npm run start-frontend
```

Frontend:

```bash
cd frontend-next
npm run dev
npm run lint
npm run build
```

Run selected fetchers locally:

```bash
python fetch_sqlite/fetch_vci_screener.py --db fetch_sqlite/vci_screening.sqlite
python fetch_sqlite/fetch_vci_stats_financial.py --db fetch_sqlite/vci_stats_financial.sqlite
python fetch_sqlite/fetch_vci_market_news.py --db fetch_sqlite/vci_market_news.sqlite --pages 5 --page-size 50
python fetch_sqlite/fetch_vci_ratio_daily.py --db fetch_sqlite/vci_ratio_daily.sqlite
python fetch_sqlite/fetch_vci_company.py --db fetch_sqlite/vci_company.sqlite
PRICE_HISTORY_DB_PATH=fetch_sqlite/price_history.sqlite python -m backend.updater.update_price_history
```

## Canonical SQLite Layer

All canonical data lives in `fetch_sqlite/`.

| File | Writer | Purpose |
|---|---|---|
| `fetch_sqlite/vci_company.sqlite` | `fetch_vci_company.py` | Company names, profiles, floor and ICB industry classification |
| `fetch_sqlite/vci_financials.sqlite` | `fetch_vci_financial_statement.py` | Wide-format VCI financial statements |
| `fetch_sqlite/vci_screening.sqlite` | `fetch_vci_screener.py` | Market snapshot: price, sector, market cap, PE/PB/ROE |
| `fetch_sqlite/vci_stats_financial.sqlite` | `fetch_vci_stats_financial.py` | TTM ratios, shares, market cap and banking KPIs |
| `fetch_sqlite/vci_ratio_daily.sqlite` | `fetch_vci_ratio_daily.py` | Highest-priority daily PE/PB |
| `fetch_sqlite/vci_shareholders.sqlite` | `fetch_vci_shareholders.py` | Shareholders by ticker |
| `fetch_sqlite/vci_market_news.sqlite` | `fetch_vci_market_news.py` | Market AI news cache |
| `fetch_sqlite/vci_news_events.sqlite` | `backend/updater/batch_news.py` | Per-symbol news/events/dividends |
| `fetch_sqlite/vci_foreign.sqlite` | `fetch_vci_foreign.py` | Foreign trading flow |
| `fetch_sqlite/vci_valuation.sqlite` | `fetch_vci_valuation.py` | VNINDEX PE/PB chart and EMA breadth |
| `fetch_sqlite/index_history.sqlite` | `fetch_vci.py` | Market index OHLCV |
| `fetch_sqlite/macro_history.sqlite` | `fetch_macro_history.py` | VCI macro time series |
| `fetch_sqlite/fireant_macro.sqlite` | `fetch_fireant_macro.py` | FireAnt macro indicators |
| `fetch_sqlite/valuation_cache.sqlite` | `backend/updater/batch_valuations.py` | Cached valuation outputs |
| `fetch_sqlite/price_history.sqlite` | `backend/updater/update_price_history.py` | Daily stock OHLCV history |

Legacy DBs:

| File | Status |
|---|---|
| `stocks_optimized.db` | Removed/deprecated. Do not use as canonical source. |
| `stocks_optimized.new.db` | Removed/deprecated. Do not use as canonical source. |
| `vietnam_stocks.db` | Legacy name only. Do not introduce new references. |

If old code still references `STOCKS_DB_PATH` or `VIETNAM_STOCK_DB_PATH`, treat
that as migration debt and point new work to the relevant `fetch_sqlite` DB.

See [docs/SQLITE_DATABASES.md](docs/SQLITE_DATABASES.md) for full schema notes
and [docs/SQLITE_ANALYSIS.md](docs/SQLITE_ANALYSIS.md) for source priority and
maintenance guidance.

## Refresh Automation

Active cron jobs are managed by `automation/setup_cron_vps.sh`.

| Schedule | Job | Output |
|---|---|---|
| `*/7 * * * *` | `fetch_sqlite/fetch_vci_screener.py` | `vci_screening.sqlite` |
| `5 * * * *` | `fetch_sqlite/fetch_vci_stats_financial.py` | `vci_stats_financial.sqlite` |
| `*/10 * * * *` | `fetch_sqlite/fetch_vci_market_news.py` | `vci_market_news.sqlite` |
| `30 11 * * *` | `PRICE_HISTORY_DB_PATH=fetch_sqlite/price_history.sqlite python -m backend.updater.update_price_history` | `fetch_sqlite/price_history.sqlite` |
| `10 13 * * *` | `fetch_sqlite/fetch_vci_shareholders.py` | `vci_shareholders.sqlite` |
| `35 13 * * *` | `fetch_sqlite/fetch_vci_ratio_daily.py` | `vci_ratio_daily.sqlite` |
| `30 18 * * *` | `fetch_sqlite/fetch_vci_valuation.py` | `vci_valuation.sqlite` |
| `*/2 9-15 * * 1-5` | `fetch_sqlite/fetch_vci_foreign.py` | `vci_foreign.sqlite` |
| Sunday 02:00, even ISO weeks | `fetch_sqlite/fetch_vci_company.py` | `vci_company.sqlite` |
| `*/30 * * * *` | `scripts/telegram_uptime_report.sh` | `telegram_uptime.log` |

Index and macro scripts exist but should have explicit cron entries if their
freshness is production-critical:

```bash
python fetch_sqlite/fetch_vci.py --indexes VNINDEX,VN30,HNXINDEX,UPCOM --db fetch_sqlite/index_history.sqlite
python fetch_sqlite/fetch_macro_history.py --db fetch_sqlite/macro_history.sqlite
python fetch_sqlite/fetch_fireant_macro.py --db fetch_sqlite/fireant_macro.sqlite
```

## Backend API Surface

Common stock endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/stock/<symbol>` | Stock payload |
| `GET` | `/api/app-data/<symbol>` | Reduced payload for frontend |
| `GET` | `/api/price/<symbol>` | Current price |
| `GET` | `/api/batch-price?symbols=VCB,FPT` | Batch prices |
| `GET` | `/api/tickers` | Ticker list |
| `GET` | `/api/stock/<symbol>/revenue-profit` | Revenue and margin history |
| `GET/POST` | `/api/valuation/<symbol>` | DCF and comparable valuation |
| `GET` | `/api/stock/peers/<symbol>` | Peer comparison |
| `GET` | `/api/download/excel/<symbol>` | Excel export via Cloudflare R2 |

Common market endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/market/overview-refresh` | Market overview bundle |
| `GET` | `/api/market/heatmap` | Sector heatmap |
| `GET` | `/api/market/vci-indices` | Live indices |
| `GET` | `/api/market/index-history` | Index history |
| `GET` | `/api/market/top-movers` | Top gainers/losers |
| `GET` | `/api/market/news` | Market news |
| `GET` | `/api/market/gold` | Gold prices |
| `GET` | `/api/market/foreign` | Foreign trading |
| `GET` | `/api/macro/*` | Macro datasets |

WebSocket:

| Path | Description |
|---|---|
| `/ws/market/indices` | Live VNINDEX/VN30/HNX stream |
| `/ws/market/prices` | Live stock price stream |

Production prefix: `https://api.quanganh.org/v1/valuation`.

## Environment Variables

Backend:

| Variable | Purpose |
|---|---|
| `VNSTOCK_API_KEY`, `VNSTOCK_API_KEYS` | Only needed for legacy vnstock-backed jobs |
| `PRICE_HISTORY_DB_PATH` | Override for `fetch_sqlite/price_history.sqlite` |
| `VCI_SCREENING_DB_PATH` | Override for `vci_screening.sqlite` |
| `VCI_STATS_FINANCIAL_DB_PATH` | Override for `vci_stats_financial.sqlite` |
| `VCI_RATIO_DAILY_DB_PATH` | Override for `vci_ratio_daily.sqlite` |
| `VCI_SHAREHOLDERS_DB_PATH` | Override for `vci_shareholders.sqlite` |
| `VCI_FINANCIAL_STATEMENT_DB_PATH` | Override for `vci_financials.sqlite` |
| `VCI_COMPANY_DB_PATH` | Override for `vci_company.sqlite` |
| `VCI_MARKET_NEWS_DB_PATH` | Override for `vci_market_news.sqlite` |
| `VCI_NEWS_EVENTS_DB_PATH` | Override for `vci_news_events.sqlite` |
| `VCI_VALUATION_DB_PATH` | Override for `vci_valuation.sqlite` |
| `INDEX_HISTORY_DB_PATH` | Override for `index_history.sqlite` |
| `VALUATION_CACHE_DB_PATH` | Override for `valuation_cache.sqlite` |
| `VCI_STANDOUTS_DB_PATH` | Override for `vci_ai_standouts.sqlite` if used |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Excel export storage |

Frontend variables are documented in `frontend-next/.env.example`.

## Deploy

Windows PowerShell deploy helper:

```powershell
.\automation\deploy.ps1 -CommitMessage "fix: describe change"
.\automation\deploy.ps1 -CommitMessage "update data" -IncludeDatabase
.\automation\deploy.ps1 -CommitMessage "perf tune" -PerfProfile auto
```

Manual VPS flow:

```bash
cd /var/www/valuation
git pull --ff-only
source .venv/bin/activate
pip install -r requirements.txt
cd frontend-next && npm ci && npm run build
systemctl restart valuation.service
```

## Operations Checks

```bash
systemctl status valuation.service
journalctl -u valuation.service -n 100 --no-pager
curl -s http://127.0.0.1:8000/health | python3 -m json.tool
```

SQLite checks:

```bash
sqlite3 /var/www/valuation/fetch_sqlite/vci_screening.sqlite "SELECT COUNT(*) FROM screening_data;"
sqlite3 /var/www/valuation/fetch_sqlite/vci_stats_financial.sqlite "SELECT COUNT(*) FROM stats_financial;"
sqlite3 /var/www/valuation/fetch_sqlite/vci_ratio_daily.sqlite "SELECT COUNT(*) FROM ratio_daily;"
sqlite3 /var/www/valuation/fetch_sqlite/vci_market_news.sqlite "SELECT key, value FROM news_meta;"
sqlite3 /var/www/valuation/fetch_sqlite/price_history.sqlite "SELECT COUNT(*) FROM stock_price_history;"
```

## Troubleshooting

**Backend accidentally reads legacy DB**

Search for old references and migrate them to a specific `fetch_sqlite` source:

```bash
rg -n "stocks_optimized|stocks_optimized\\.new|vietnam_stocks|STOCKS_DB_PATH|VIETNAM_STOCK_DB_PATH"
```

**Screener or stats stale**

```bash
tail -50 /var/www/valuation/fetch_sqlite/cron_screener.log
tail -50 /var/www/valuation/fetch_sqlite/cron_stats_financial.log
crontab -l
```

**News cache stale**

```bash
tail -50 /var/www/valuation/fetch_sqlite/cron_vci_market_news.log
sqlite3 /var/www/valuation/fetch_sqlite/vci_market_news.sqlite \
  "SELECT key, value FROM news_meta;"
```

**WebSocket fails in browser**

Confirm Vercel has:

```text
NEXT_PUBLIC_BACKEND_WS_URL=wss://api.quanganh.org/v1/valuation
```

## Documentation Map

| Document | Purpose |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture and data flow |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | VPS operations and recovery commands |
| [docs/SQLITE_DATABASES.md](docs/SQLITE_DATABASES.md) | Canonical SQLite inventory |
| [docs/SQLITE_ANALYSIS.md](docs/SQLITE_ANALYSIS.md) | SQLite source priority and maintenance |
| [docs/NEWS_SQLITE_CACHE.md](docs/NEWS_SQLITE_CACHE.md) | AI news cache behavior |
| [frontend-next/README.md](frontend-next/README.md) | Frontend commands and env |
