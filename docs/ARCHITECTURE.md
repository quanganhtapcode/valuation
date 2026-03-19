# Kiến trúc Hệ thống

## Tổng quan

```
                    ┌─────────────────────────────────────┐
                    │          VPS (203.55.176.10)         │
                    │                                     │
  18:00 daily  ─── │  systemd stock-fetch.timer           │
                    │    └─► run_pipeline.py               │
                    │          └─► backend/updater/        │  ─► vietnam_stocks.db
                    │              (vnstock API)           │
                    │                                     │
  cron */5min  ─── │  fetch_vci_screener.py               │  ─► vci_screening.sqlite
  cron */5min  ─── │  fetch_vci_news.py                   │  ─► vci_ai_news.sqlite
  cron */15min ─── │  fetch_vci.py                        │  ─► index_history.sqlite
  cron */15min ─── │  fetch_vci_standouts.py              │  ─► vci_ai_standouts.sqlite
                    │                                     │
  always-on    ─── │  backend/server.py (gunicorn)        │
                    │    ├── routes/stock_routes.py        │  ◄── reads vietnam_stocks.db
                    │    ├── routes/market/               │  ◄── reads index_history.sqlite
                    │    ├── routes/valuation_routes.py   │  ◄── reads vci_screening.sqlite
                    │    └── routes/download_routes.py    │  ◄── Cloudflare R2
                    └─────────────────────────────────────┘
                                  │
                              nginx proxy
                                  │
                         ┌────────┴────────┐
                         │   Vercel CDN    │
                         │  frontend-next  │
                         └─────────────────┘
```

---

## Hai luồng dữ liệu độc lập

### Luồng 1: Real-time (crontab)

Chạy liên tục, không phụ thuộc `run_pipeline.py`.

```
VCI API (iq.vietcap.com.vn / ai.vietcap.com.vn)
  │
  ├─ fetch_vci.py           → index_history.sqlite
  ├─ fetch_vci_screener.py  → vci_screening.sqlite
  ├─ fetch_vci_news.py      → vci_ai_news.sqlite
  └─ fetch_vci_standouts.py → vci_ai_standouts.sqlite
```

### Luồng 2: Daily BCTC (systemd 18:00)

Dùng vnstock API (cần `VNSTOCK_API_KEY`).

```
vnstock API (VCI source)
  │
  └─ run_pipeline.py
       ├─ Step 1: backend/updater/pipeline_steps.py → update_financials()
       │           └─ FinancialUpdater               → balance_sheet
       │                (smart-skip nếu updated         income_statement
       │                 < SKIP_IF_UPDATED_WITHIN_DAYS)  cash_flow_statement
       │                                            → vietnam_stocks.db
       │
       ├─ Step 2 (Chủ nhật): update_companies()
       │           └─ CompanyUpdater                → company_overview
       │
       └─ Step 3: scripts/create_compat_views.py   → refresh views
```

#### Smart-skip logic

`FinancialUpdater._was_recently_updated(symbol, table)` kiểm tra `updated_at` trong bảng `balance_sheet`. Nếu mã đã được cập nhật trong vòng `SKIP_IF_UPDATED_WITHIN_DAYS` ngày (mặc định 30), bỏ qua để tiết kiệm API quota.

---

## Cấu trúc thư mục

```
├── backend/
│   ├── server.py                  Flask app entry point
│   ├── extensions.py              Global service instances (init_provider)
│   ├── db_path.py                 DB path resolution logic
│   ├── models.py                  Valuation models (DCF, PE, PB)
│   ├── utils.py                   Shared utilities
│   ├── cache_utils.py             Cache helpers
│   ├── r2_client.py               Cloudflare R2 client
│   ├── stock_provider.py          Legacy StockDataProvider (backward compat)
│   │
│   ├── data_sources/
│   │   ├── financial_repository.py  Low-level DB reader
│   │   ├── sqlite_db.py             SQLite connection wrapper
│   │   └── vci.py                   VCI real-time data client
│   │
│   ├── services/
│   │   ├── valuation_service.py     DCF + peer comparison
│   │   ├── financial_service.py     Financial statement queries
│   │   ├── stock_service.py         Stock overview queries
│   │   ├── news_service.py          News aggregation
│   │   ├── gold.py                  Gold price service
│   │   ├── vci_news_sqlite.py       VCI news from SQLite
│   │   └── vci_standouts_sqlite.py  VCI standouts from SQLite
│   │
│   ├── routes/
│   │   ├── stock_routes.py          /api/stock/*
│   │   ├── valuation_routes.py      /api/valuation/*
│   │   ├── health_routes.py         /health
│   │   ├── download_routes.py       /api/download/*
│   │   ├── market.py                Blueprint aggregator cho /api/market/*
│   │   ├── market/                  Market sub-modules
│   │   │   ├── vci_indices.py, gold.py, news.py, movers.py, ...
│   │   ├── stock/                   Stock sub-modules
│   │   │   ├── financial_dashboard.py, charts.py, profile.py, ...
│   │   └── handlers/                Standalone route handlers
│   │       ├── index_history.py, lottery_rss.py, ...
│   │
│   └── updater/                   Daily pipeline (was: db_updater/)
│       ├── database.py            StockDatabase class + schema
│       ├── updaters.py            FinancialUpdater, CompanyUpdater
│       └── pipeline_steps.py     update_financials(), update_companies()
│
├── fetch_sqlite/                  Real-time VCI data fetchers (cron)
├── scripts/
│   ├── create_compat_views.py     Refresh DB views post-pipeline
│   ├── test_local.ps1             Pre-deploy test suite
│   └── sync_overview.py           Sync overview table
├── automation/
│   ├── deploy.ps1                 Windows deploy script
│   └── *.sh / *.service / *.timer systemd & shell automation
├── run_pipeline.py                Pipeline entry point (systemd)
└── docs/
    ├── ARCHITECTURE.md            This file
    └── RUNBOOK.md                 Operations guide
```

---

## Database (vietnam_stocks.db)

Tất cả 3 env vars đều trỏ về 1 file:
- `VIETNAM_STOCK_DB_PATH` — dùng bởi `run_pipeline.py` + `backend/updater/`
- `STOCKS_DB_PATH` — dùng bởi Flask backend
- Cả hai mặc định về `/var/www/valuation/vietnam_stocks.db` trên VPS

### Bảng thật (pipeline viết)

| Bảng | Mô tả |
|---|---|
| `stocks` | Danh sách cổ phiếu niêm yết |
| `company_overview` | Hồ sơ công ty |
| `balance_sheet` | CĐKT năm/quý |
| `income_statement` | KQKD năm/quý |
| `cash_flow_statement` | LCTT năm/quý |
| `financial_ratios` | Tỷ số tài chính |
| `update_log` | Lịch sử cập nhật |

### Views tương thích (tạo sau mỗi pipeline)

| View | Backend dùng |
|---|---|
| `overview` | `/api/stock/`, `/api/valuation/` |
| `ratio_wide` | `/api/stock/VCB` financial data |
| `company` | `/api/stock/VCB` profile |
| `fin_stmt` | `/api/stock/VCB/revenue-profit` |

---

## Backend API endpoints

| Prefix | File | Mô tả |
|---|---|---|
| `/api/stock/` | `routes/stock_routes.py` + `routes/stock/` | Dữ liệu cổ phiếu |
| `/api/market/` | `routes/market.py` + `routes/market/` | Index, news, screener |
| `/api/valuation/` | `routes/valuation_routes.py` | DCF, so sánh ngành |
| `/api/download/` | `routes/download_routes.py` | Export Excel (R2) |
| `/health` | `routes/health_routes.py` | System health check |

---

## Môi trường biến quan trọng

| Biến | Mặc định | Mô tả |
|---|---|---|
| `VNSTOCK_API_KEY` | — | **Bắt buộc** cho daily pipeline |
| `STOCKS_DB_PATH` | auto-resolve | Override đường dẫn DB |
| `SKIP_IF_UPDATED_WITHIN_DAYS` | `30` | Smart-skip threshold |
| `FETCH_PERIOD` | `year` | `year` hoặc `quarter` |
| `FETCH_DELAY_SECONDS` | `0` | Extra inter-symbol delay (giây) |
| `R2_*` | — | Cloudflare R2 (tuỳ chọn) |
