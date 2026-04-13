# 📊 SQLite Databases — Full Analysis

> Last updated: 2026-04-13 | Total files: **16** | Total size: **~2.5 GB**

---

## Overview by Category

| Category | Files | Total Size | Purpose |
|---|---|---|---|
| **Core DB** | 1 | 836 MB | Master database — financial statements, stock profiles, valuation datamart |
| **Price Data** | 1 | 218 MB | Daily OHLCV for all stocks |
| **Financial Statements (VCI)** | 1 | 132 MB | BCTC wide-format from VCI (balance sheet, income, cash flow, notes) |
| **Market Screener** | 1 | 2.7 MB | Real-time screener snapshot — price, PE, PB, ROE, sector, market cap |
| **Financial Ratios** | 2 | 10.1 MB | TTM ratios (current + history) + daily PE/PB tracking |
| **News & Events** | 2 | 191 MB | Raw news + AI-analyzed news |
| **Company Info** | 1 | 3.6 MB | Company profiles, organization names |
| **Market Indices** | 1 | 0.2 MB | VNINDEX, VN30, HNX daily index history |
| **Foreign Trading** | 1 | 0.8 MB | Foreign buy/sell snapshots + intraday volume |
| **Macro Economics** | 2 | 1.0 MB | GDP, CPI, M2, interest rates from VCI + Fireant |
| **Valuation Cache** | 2 | 1.5 MB | Cached DCF results + VNINDEX valuation chart history |
| **Shareholders** | 1 | 5.1 MB | Shareholder lists per company |

---

## Detailed File Analysis

### 1. `stocks_optimized.db` — ⭐ Master Database

| Property | Value |
|---|---|
| **Size** | 836 MB |
| **Location** | `/var/www/valuation/` |
| **Source** | KBS API via vnstock library + self-calculated fields |
| **Update** | Daily 18:00 via `run_pipeline.py` (systemd timer) |
| **Used by** | `stock_provider.py`, `valuation_service.py`, all stock overview APIs |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `income_statement` | 73,906 | Quarterly/annual income statements (revenue → net income) |
| `balance_sheet` | 73,898 | Quarterly/annual balance sheets (assets, liabilities, equity) |
| `cash_flow_statement` | 73,875 | Quarterly/annual cash flow statements (operating, investing, financing) |
| `financial_ratios` | 73,407 | Calculated financial ratios (liquidity, leverage, profitability) |
| `shareholders` | 92,196 | Historical shareholder lists |
| `company_overview` | 1,673 | Company profiles, industry classification |
| `stocks` | 1,738 | Stock symbols, exchange, trading status |
| `valuation_datamart` | 1,738 | Pre-calculated intrinsic value, upside %, quality grade |
| `officers` | 46 | Company officers/management |
| `exchanges` | 4 | HOSE, HNX, UPCOM, Unlisted |
| `indices` | 2 | VNINDEX, HNXINDEX metadata |

**Empty tables** (reserved for future use): `industries`, `stock_exchange`, `stock_industry`, `update_log`, `stock_price_history`, `subsidiaries`, `events`, `news`, `financial_reports`

**Assessment:**
- ✅ **Backbone** of the system — all DCF calculations depend on it
- ✅ ~73k financial statement rows covering ~1,730 stocks × multiple quarters
- ⚠️ Several tables are empty — may indicate incomplete migration or reserved schema
- ⚠️ Largest file — consider VACUUM periodically to reclaim space

---

### 2. `price_history.sqlite` — 📈 Price Data

| Property | Value |
|---|---|
| **Size** | 218 MB |
| **Location** | `/var/www/valuation/` |
| **Source** | VCI Price History API |
| **Update** | Daily 11:30 UTC via `backend/updater/update_price_history.py` |
| **Used by** | `/api/stock/[symbol]/history`, chart rendering, technical analysis |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `stock_price_history` | 2,070,601 | Daily OHLCV (open, high, low, close, volume) per stock |

**Assessment:**
- ✅ Single source of truth for price history — clean, focused schema
- ✅ 2M+ rows provides multi-year history for ~1,700+ stocks
- 💡 Could consider partitioning by year if query performance degrades

---

### 3. `vci_financials.sqlite` — 📋 VCI Financial Statements

| Property | Value |
|---|---|
| **Size** | 132 MB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI Financial API |
| **Update** | Daily via `fetch_vci_financial_statement.py` |
| **Used by** | `vci_financial_adapter.py`, `/api/financial-report/` |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `income_statement` | 33,382 | VCI-wide format income statements (isa*, isb*, isi*, iss* columns) |
| `balance_sheet` | 33,333 | VCI-wide format balance sheets (bsa*, bsb*, bsi*, bss* columns) |
| `cash_flow` | 32,936 | VCI-wide format cash flows (cfa*, cfb*, cfi*, cfs* columns) |
| `note` | 29,260 | Thuyết minh BCTC — footnote details (noc*, nob*, noi*, nos* columns) |
| `fetch_log` | — | Fetch status tracking per ticker |
| `meta` | — | Last run timestamp |

**VCI Field Code Prefixes:**
- `*a*` → Standard companies
- `*b*` → Banks
- `*i*` → Insurance
- `*s*` → Securities
- `nos*` → Off-balance-sheet items

**Assessment:**
- ✅ Much more granular than `stocks_optimized.db` — hundreds of VCI-specific field codes
- ✅ Supports banking/insurance/securities industry-specific columns
- ⚠️ ~33k rows vs 73k in stocks_optimized — fewer quarters covered, may still be populating
- 💡 Wide format (700+ columns in balance_sheet) — hard to query directly, frontend maps via `vci_financial_statement_metrics_hose_hnx.json`

---

### 4. `vci_screening.sqlite` — 🔍 Stock Screener

| Property | Value |
|---|---|
| **Size** | 2.7 MB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI Screener API |
| **Update** | Every 7 minutes via cron `fetch_vci_screener.py` |
| **Used by** | `/api/market/screener`, frontend `/screener` page |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `screening_data` | 1,547 | All listed stocks with real-time metrics |
| `meta` | — | Last run timestamp |

**Key Columns:**
- **Price:** `refPrice`, `marketPrice`, `ceiling`, `floor`, `dailyPriceChangePercent`
- **Volume:** `accumulatedValue`, `accumulatedVolume`, `adtv30Days`, `avgVolume30Days`
- **Valuation:** `ttmPe`, `ttmPb`, `ttmRoe`
- **Growth:** `npatmiGrowthYoyQm1`, `revenueGrowthYoy`
- **Margins:** `netMargin`, `grossMargin`
- **Info:** `enOrganName`, `viOrganShortName`, `enSector`, `viSector`, `icbCodeLv2`, `icbCodeLv4`
- **Other:** `exchange` (HSX/HNX/UPCOM), `stockStrength`, `marketCap`

**Assessment:**
- ✅ Most frequently updated (every 7 min) — near real-time market snapshot
- ✅ Primary data source for the stock screener frontend
- ✅ Small file (2.7 MB) but rich in screening metrics
- 💡 Source priority fallback: `vci_ratio_daily` → `vci_stats_financial` → `vci_screening`

---

### 5. `vci_stats_financial.sqlite` — 📊 Financial Ratios (TTM + History)

| Property | Value |
|---|---|
| **Size** | 10 MB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI Stats API |
| **Update** | Every hour via cron `fetch_vci_stats_financial.py` |
| **Used by** | `source_priority.py`, valuation services, stock overview |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `stats_financial` | 1,539 | Latest TTM ratios per stock (25+ metrics) |
| `stats_financial_history` | 46,460 | Historical quarterly snapshots |

**Current Metrics (`stats_financial`):**
- **Valuation:** PE, PB, PS, Price-to-Cash-Flow, EV/EBITDA
- **Profitability:** ROE, ROA, Gross Margin, Pre-tax Margin, After-tax Margin
- **Banking:** Net Interest Margin, CIR, CAR, CASA Ratio, NPL, LDR, Loans Growth, Deposit Growth
- **Leverage:** Debt-to-Equity, Financial Leverage
- **Liquidity:** Current Ratio, Quick Ratio, Cash Ratio, Asset Turnover
- **Market:** Market Cap, Shares Outstanding

**Assessment:**
- ✅ Most comprehensive ratio dataset — 25+ metrics per stock
- ✅ History table goes back years (e.g., VCB data from 2018) — excellent for trend analysis
- ✅ Banking-specific metrics — critical for bank stock analysis
- 💡 46k history rows = ~30 quarters × 1,500 stocks — good depth

---

### 6. `vci_ratio_daily.sqlite` — 📅 Daily PE/PB Tracker

| Property | Value |
|---|---|
| **Size** | 136 KB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI Daily Ratios API |
| **Update** | Daily 13:30 via cron `fetch_vci_ratio_daily.py` |
| **Used by** | `source_priority.py` (PRIORITY #1 for PE/PB) |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `ratio_daily` | 1,382 | Latest daily PE/PB per stock |
| `meta` | — | Last run timestamp |

**Columns:** `ticker` (PK), `pe`, `pb`, `trading_date`, `fetched_at`

**Assessment:**
- ✅ **Smallest file** (136 KB) but **highest priority** for PE/PB data
- ✅ Used by `/api/market/screener` as first-choice source for PE/PB when filtering
- ✅ Source priority chain: `vci_ratio_daily` → `vci_stats_financial` → `vci_screening` → `vnstock`
- ⚠️ Only stores 2 ratios (PE, PB) — limited scope but very fast to query
- 💡 Trading date range: ~2 weeks of data (one snapshot per day per stock)

---

### 7. `vci_news_events.sqlite` — 📰 News & Events

| Property | Value |
|---|---|
| **Size** | 184 MB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI InvestorQuest API |
| **Update** | Daily via `fetch_vci_news.py` |
| **Used by** | `/api/stock/[symbol]/news`, news tab in stock detail |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `items` | 178,436 | News articles, dividend announcements, corporate events |
| `fetch_meta` | 7,735 | Fetch tracking per symbol/tab |

**Assessment:**
- ⚠️ **2nd largest file** (184 MB) — stores raw JSON for 178k items
- ✅ Comprehensive coverage of news, dividends, events per stock
- 💡 Consider archiving older items (>1 year) to reduce size

---

### 8. `vci_ai_news.sqlite` — 🤖 AI-Analyzed News

| Property | Value |
|---|---|
| **Size** | 6.5 MB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI API + AI processing |
| **Update** | Every 10 minutes via cron `fetch_vci_news.py` |
| **Used by** | Frontend news widgets |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `news_items` | 2,734 | AI-summarized/analyzed news articles |
| `news_meta` | 3 | Source tracking |

**Assessment:**
- ✅ AI-processed news — more structured than raw news feed
- ✅ Small file, fast to query

---

### 9. `vci_company.sqlite` — 🏢 Company Profiles

| Property | Value |
|---|---|
| **Size** | 3.6 MB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI Company Info API |
| **Update** | Weekly (bi-weekly on Sunday) via `fetch_vci_company.py` |
| **Used by** | Stock profile display, company details |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `companies` | 2,075 | Company names (EN/VN), short names, sector info |
| `fetch_log` | 5 | Fetch status tracking |

**Assessment:**
- ✅ Covers 2,075 companies — more than listed stocks (includes delisted/OTC)
- ✅ Small, clean file — fast lookups for company names

---

### 10. `vci_shareholders.sqlite` — 👥 Shareholder Lists

| Property | Value |
|---|---|
| **Size** | 5.1 MB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI Shareholders API |
| **Update** | Daily 13:00 via cron `fetch_vci_shareholders.py` |
| **Used by** | `/api/stock/[symbol]/shareholders`, Holders tab |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `shareholders` | 27,000+ | Top shareholders per company (quantity, %, type) |

**Columns:** `ticker`, `owner_code`, `owner_name`, `owner_name_en`, `position_name`, `quantity`, `percentage`, `owner_type` (CORPORATE/INDIVIDUAL)

**Assessment:**
- ✅ Useful for institutional ownership analysis
- ✅ Clean schema with EN/VN names

---

### 11. `vci_valuation.sqlite` — 📉 VNINDEX Valuation Chart

| Property | Value |
|---|---|
| **Size** | 1.4 MB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI API |
| **Update** | Daily via `fetch_vci_valuation.py` |
| **Used by** | `/api/market/pe-chart`, `/api/market/index-valuation-chart` |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `valuation_history` | 5,547 | Daily VNINDEX PE/PB/price/OHLC |
| `valuation_stats` | 2 | PE/PB statistical bands (avg, ±1SD, ±2SD) |
| `ema_breadth_history` | 5,897 | Daily EMA50 breadth (% stocks above EMA50) |
| `meta` | 1 | Last run timestamp |

**Assessment:**
- ✅ Market-level valuation — PE/PB bands help identify overvalued/undervalued market
- ✅ EMA50 breadth data for market health analysis
- ✅ Statistical bands (±1SD, ±2SD) — useful for visualization on chart

---

### 12. `vci_foreign.sqlite` — 🌏 Foreign Trading

| Property | Value |
|---|---|
| **Size** | 760 KB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI Foreign Trading API |
| **Update** | Every 2 min during market hours via cron `fetch_vci_foreign.py` |
| **Used by** | `/api/market/foreign` |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `foreign_net_snapshot` | 17 | Daily foreign buy/sell top lists (raw JSON) |
| `foreign_volume_minute` | 4,624 | Intraday minute foreign trading volume |

**Assessment:**
- ✅ Snapshot table stores raw JSON — flexible but harder to query directly
- ✅ Minute-level data for intraday foreign flow analysis
- ⚠️ Only 17 snapshot rows — very recent data, no long history

---

### 13. `index_history.sqlite` — 📊 Market Index History

| Property | Value |
|---|---|
| **Size** | 160 KB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI Index API |
| **Update** | Every 15 minutes via cron `fetch_vci.py` |
| **Used by** | `/api/market/index-history` |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `market_index_history` | 272 | Daily index data (VNINDEX, VN30, HNXINDEX, UPCOM) |
| `meta` | 2 | Last run timestamps |

**Columns:** 62 columns including value, change %, OHLC index, volume/value, net buy/sell, foreign ownership ratio

**Assessment:**
- ✅ Only 272 rows = ~1 year of trading days for 4 indices
- ⚠️ Relatively short history — consider backfilling
- ✅ Rich column set — comprehensive index data

---

### 14. `macro_history.sqlite` — 📈 VCI Macro Data

| Property | Value |
|---|---|
| **Size** | 636 KB |
| **Location** | `fetch_sqlite/` |
| **Source** | VCI Macro API |
| **Update** | Weekly via `fetch_macro_history.py` |
| **Used by** | `/api/macro` |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `macro_prices` | 6,126 | Time series for macro indicators (symbol, date, close) |

**Assessment:**
- ✅ Simple schema (symbol, date, close) — easy to query
- ✅ 6,126 data points across multiple indicators

---

### 15. `fireant_macro.sqlite` — 📉 Fireant Macro Data

| Property | Value |
|---|---|
| **Size** | 376 KB |
| **Location** | `fetch_sqlite/` |
| **Source** | Fireant API |
| **Update** | Weekly via `fetch_fireant_macro.py` |
| **Used by** | `/api/macro` (alternative source) |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `macro_indicators` | 96 | Indicator metadata (GDP, CPI, M2, interest rates, etc.) |
| `macro_data` | 6,695 | Historical time series data |

**Assessment:**
- ✅ Alternative source to VCI macro — good for redundancy
- ✅ 96 indicators across GDP, CPI, M2, interest rates, exchange rates
- 💡 Two macro sources (VCI + Fireant) — useful for cross-validation

---

### 16. `valuation_cache.sqlite` — 💾 Valuation Cache

| Property | Value |
|---|---|
| **Size** | 124 KB |
| **Location** | `fetch_sqlite/` |
| **Source** | Self-calculated (DCF results) |
| **Update** | On-demand via `batch_valuations.py` |
| **Used by** | `/api/stock/[symbol]/valuation` |

**Tables:**

| Table | Rows | Description |
|---|---|---|
| `valuations` | 1,463 | Cached DCF valuation results per symbol |

**Assessment:**
- ✅ Cache for expensive DCF calculations — speeds up repeat queries
- ✅ Only 124 KB — very efficient
- 💡 Consider TTL-based cleanup for stale entries

---

## API Endpoints (Split Design)

| Endpoint | Size | Content | Used by |
|---|---|---|---|
| `GET /api/stock/{symbol}/summary` | ~500 B | Identity + price + 38 key ratios | Header, quick stats |
| `GET /api/stock/{symbol}/profile` | ~1.5 KB | company_profile, description | Overview tab |
| `GET /api/stock/{symbol}/ratio-history` | ~1.5 KB | 12-year PE/PB/ROE/ROA/Debt array | 12-year ratio chart |
| `GET /api/stock/{symbol}/ratio-series` | ~500 B | current_ratio_data, quick_ratio_data, ev_ebitda… | Mini-charts |
| `GET /api/stock/{symbol}/overview-full` | ~4 KB | All 4 combined (legacy) | Downloads, old clients |
| `GET /api/stock/{symbol}` | ~4 KB | Legacy endpoint (kept for compat) | Old clients |
| `GET /api/stock/history/{symbol}` | ~110 KB | 1245 days OHLCV | Price chart |
| `GET /api/financial-report/{symbol}` | ~16 KB | Full BCTC (VCI field codes) | Financials tab |
| `GET /api/valuation/{symbol}` | ~12 KB | DCF valuation result | Valuation tab |
| `GET /api/stock/holders/{symbol}` | ~2 KB | Shareholder list | Holders tab |

**Before:** 1 call × 4 KB = 4 KB (monolithic, slow)
**After:** 4 calls × 500B–1.5KB in parallel = same total, but **header renders first** (fastest endpoint returns first)

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      EXTERNAL APIs                               │
├──────────────────────┬────────────────────────┬──────────────────┤
│  VCI API             │  Fireant API           │  KBS (vnstock)   │
│  (vietcap.com.vn)    │  (fireant.vn)          │                 │
└────┬─────────────────┴────┬───────────────────┴────────┬────────┘
     │                      │                            │
     ▼                      ▼                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              FETCH SCRIPTS (fetch_sqlite/*.py)                    │
│  Cron jobs: every 2min–weekly                                     │
└────┬────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LOCAL SQLITE DATABASES                         │
│                                                                  │
│  CORE:                                                           │
│  ├── stocks_optimized.db (836 MB)  ← Master DB, pipeline daily  │
│  ├── price_history.sqlite (218 MB)  ← OHLCV daily               │
│  └── vci_financials.sqlite (132 MB)  ← VCI BCTC wide-format     │
│                                                                  │
│  MARKET DATA:                                                    │
│  ├── vci_screening.sqlite (2.7 MB)  ← Real-time screener        │
│  ├── vci_stats_financial.sqlite (10 MB)  ← TTM ratios + history │
│  ├── vci_ratio_daily.sqlite (136 KB)  ← Daily PE/PB             │
│  ├── vci_company.sqlite (3.6 MB)  ← Company profiles            │
│  ├── vci_shareholders.sqlite (5.1 MB)  ← Shareholder lists      │
│  └── vci_foreign.sqlite (760 KB)  ← Foreign trading             │
│                                                                  │
│  INDICES & MACRO:                                                │
│  ├── index_history.sqlite (160 KB)  ← Index OHLC                │
│  ├── macro_history.sqlite (636 KB)  ← VCI macro                 │
│  └── fireant_macro.sqlite (376 KB)  ← Fireant macro             │
│                                                                  │
│  NEWS & AI:                                                      │
│  ├── vci_news_events.sqlite (184 MB)  ← Raw news/events         │
│  └── vci_ai_news.sqlite (6.5 MB)  ← AI-analyzed news            │
│                                                                  │
│  VALUATION:                                                      │
│  ├── vci_valuation.sqlite (1.4 MB)  ← VNINDEX PE/PB chart       │
│  └── valuation_cache.sqlite (124 KB)  ← DCF cache               │
└────┬────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│              BACKEND (Flask API)                                  │
│  source_priority.py → merges VCI + KBS data (priority chain)    │
│  vci_financial_adapter.py → maps VCI field codes to standard    │
│  valuation_service.py → DCF calculation (FCFE/FCFF/P/E/P/B)     │
│  stock_provider.py → reads stocks_optimized.db                   │
└────┬────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│              FRONTEND (Next.js)                                   │
│  /screener → /api/market/screener (vci_screening + ratio_daily)  │
│  /stock/[symbol] → overview, financials, valuation, news, etc.   │
│  Market → index-valuation-chart, ema50-breadth, foreign, macro   │
└─────────────────────────────────────────────────────────────────┘
```

## Update Schedule

| Frequency | Script(s) | Output File(s) | Cron |
|---|---|---|---|
| Every 2 min (market hours) | `fetch_vci_foreign.py` | `vci_foreign.sqlite` | ✅ |
| Every 5 min | `fetch_vci_screener.py` | `vci_screening.sqlite` | ✅ |
| Every 7 min | `fetch_vci_screener.py` (full) | `vci_screening.sqlite` | ✅ |
| Every 10 min | `fetch_vci_news.py` | `vci_ai_news.sqlite` | ✅ |
| Every 15 min | `fetch_vci.py` | `index_history.sqlite` | ✅ |
| Every hour | `fetch_vci_stats_financial.py` | `vci_stats_financial.sqlite` | ✅ |
| Daily 11:30 | `update_price_history.py` | `price_history.sqlite` | systemd |
| Daily 13:00 | `fetch_vci_shareholders.py` | `vci_shareholders.sqlite` | ✅ |
| Daily 13:30 | `fetch_vci_ratio_daily.py` | `vci_ratio_daily.sqlite` | ✅ |
| Daily 18:00 | `run_pipeline.py` | `stocks_optimized.db` | systemd |
| Daily | `fetch_vci_financial_statement.py` | `vci_financials.sqlite` | ✅ |
| Daily | `fetch_vci_news.py` (events) | `vci_news_events.sqlite` | ✅ |
| Daily | `fetch_vci_valuation.py` | `vci_valuation.sqlite` | ✅ |
| Weekly (Sun 02:00, bi-weekly) | `fetch_vci_company.py` | `vci_company.sqlite` | ✅ |
| Weekly | `fetch_macro_history.py` | `macro_history.sqlite` | ✅ |
| Weekly | `fetch_fireant_macro.py` | `fireant_macro.sqlite` | ✅ |
| On-demand | `batch_valuations.py` | `valuation_cache.sqlite` | — |

## Source Priority Chain (for PE/PB)

When the backend resolves PE/PB ratios, it checks sources in this order:

```
1. vci_ratio_daily.sqlite        → Latest daily PE/PB (PRIORITY #1)
2. vci_stats_financial.sqlite    → TTM ratios from stats API
3. vci_screening.sqlite          → Screener snapshot TTM PE/PB
4. stocks_optimized.db           → KBS/vnstock PE/PB
5. vnstock API (live)            → Fallback if all else fails
```

## Key Observations & Recommendations

### ✅ Strengths
- **Multi-source redundancy:** VCI + KBS + Fireant — data resilience
- **Good coverage:** 1,500+ stocks, multi-year financial history
- **Fast queries:** Small files for frequently accessed data (screening, ratios)
- **Clean separation:** Each file has a single responsibility

### ⚠️ Areas for Improvement
1. **`vci_news_events.sqlite` (184 MB):** Consider archiving items older than 1 year
2. **Empty tables in `stocks_optimized.db`:** Clean up or populate: `news`, `events`, `subsidiaries`, `stock_price_history`
3. **`index_history.sqlite` (272 rows):** Only ~1 year of index data — consider backfilling
4. **Periodic VACUUM:** Run `VACUUM` on large databases quarterly to reclaim space

### 💡 Optimization Ideas
- Partition `price_history.sqlite` by year for faster queries
- Add indexes on frequently-queried columns (`ticker`, `trading_date`)
- Consider a single unified "ratios" view that joins all 3 ratio sources
- Add data quality checks (null PE/PB, negative market cap, etc.)
