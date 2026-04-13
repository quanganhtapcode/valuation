# 📊 SQLite Databases Overview

## Summary Table

| # | Database File | Size | Source | Tables | Rows | Updated |
|---|---|---|---|---|---|---|
| 1 | `stocks_optimized.db` | ~100MB | KBS (vnstock) + self-calculated | overview, company, income_statement, balance_sheet, cash_flow_statement, financial_ratios, valuation_datamart | varies | daily |
| 2 | `vci_financials.sqlite` | 132MB | VCI API | balance_sheet, income_statement, cash_flow, note, fetch_log, meta | ~33k/tbl | daily |
| 3 | `vci_screening.sqlite` | 2.6MB | VCI API | screening_data, meta | 1547 | hourly |
| 4 | `vci_stats_financial.sqlite` | 9.9MB | VCI API | stats_financial, stats_financial_history | 1539 + 46k | daily |
| 5 | `price_history.sqlite` | 217MB | VCI API | stock_price_history | 2M | daily |
| 6 | `vci_news_events.sqlite` | 183MB | VCI API | items, fetch_meta | 178k | daily |
| 7 | `vci_ai_news.sqlite` | ~50MB | VCI API + AI processing | articles, meta | varies | daily |
| 8 | `vci_ratio_daily.sqlite` | 0.1MB | VCI API | ratio_daily, meta | 1382 | daily |
| 9 | `vci_shareholders.sqlite` | 5.1MB | VCI API | shareholders, meta | 27k | daily |
| 10 | `vci_foreign.sqlite` | 0.7MB | VCI API | foreign_net_snapshot, foreign_volume_minute | 17 + 4.6k | daily |
| 11 | `vci_valuation.sqlite` | ~5MB | VCI API | valuation_data, meta | varies | daily |
| 12 | `vci_company.sqlite` | ~1MB | VCI API | company_info | ~1500 | weekly |
| 13 | `vci_ai_standouts.sqlite` | ~2MB | VCI API + AI | standouts, meta | varies | hourly |
| 14 | `macro_history.sqlite` | ~2MB | VCI API | macro_indicators, macro_data | varies | weekly |
| 15 | `fireant_macro.sqlite` | 0.4MB | Fireant API | macro_indicators, macro_data | 96 + 6.7k | weekly |
| 16 | `index_history.sqlite` | 0.2MB | VCI API | market_index_history | 272 | daily |
| 17 | `valuation_cache.sqlite` | ~1MB | Self-calculated | cache_entries | varies | on-demand |

---

## Detailed Schema

### 1. `stocks_optimized.db`
**Source:** KBS API via vnstock library + self-calculated fields
**Used by:** StockProvider, ValuationService, Overview API

| Table | Key Columns | Types |
|---|---|---|
| `overview` | symbol, exchange, industry, pe, pb, ps, roe, roa, market_cap, current_price, eps, bvps, updated_at | TEXT/REAL |
| `company` | symbol, name, exchange, industry, company_profile, updated_at | TEXT |
| `income_statement` | symbol, year, quarter, revenue, cogs, gross_profit, operating_profit, net_income, eps, ... | TEXT/INTEGER/REAL |
| `balance_sheet` | symbol, year, quarter, total_assets, total_liabilities, total_equity, cash, total_debt, ... | TEXT/INTEGER/REAL |
| `cash_flow_statement` | symbol, year, quarter, net_income, depreciation, operating_cf, investing_cf, financing_cf, ... | TEXT/INTEGER/REAL |
| `financial_ratios` | symbol, year, quarter, current_ratio, quick_ratio, debt_to_equity, roe, roa, ... | TEXT/INTEGER/REAL |
| `valuation_datamart` | symbol, intrinsic_value, upside_pct, quality_grade, ... | TEXT/REAL |

---

### 2. `vci_financials.sqlite`
**Source:** VCI Financial API
**Used by:** vci_financial_adapter.py, /api/financial-report/
**Format:** Wide format — one column per VCI field code

| Table | Key Columns | Types | Notes |
|---|---|---|---|
| `balance_sheet` | ticker, year_report, quarter_report, bsa1..bsa278, bsb*, bsi*, bss*, nos* | TEXT/INTEGER/REAL | ~700 cols, bank/insurance/securities variants |
| `income_statement` | ticker, year_report, quarter_report, isa1..isa102, isb*, isi*, iss* | TEXT/INTEGER/REAL | ~180 cols |
| `cash_flow` | ticker, year_report, quarter_report, cfa1..cfa105, cfb*, cfi*, cfs* | TEXT/INTEGER/REAL | ~225 cols |
| `note` | ticker, year_report, quarter_report, noc1..noc709 | TEXT/INTEGER/REAL | ~710 cols, thuyết minh BCTC |

**VCI Field Code Prefixes:**
- `isa*` / `bsa*` / `cfa*` / `noc*` → Standard companies
- `isb*` / `bsb*` / `cfb*` → Banks
- `isi*` / `bsi*` / `cfi*` → Insurance
- `iss*` / `bss*` / `cfs*` → Securities
- `nos*` → Off-balance-sheet items

---

### 3. `vci_screening.sqlite`
**Source:** VCI Screener API
**Used by:** /api/screener, /api/market/*, Peer comparison

| Table | Columns | Types | Description |
|---|---|---|---|
| `screening_data` | ticker, exchange, refPrice, ceiling, marketPrice, floor, marketCap, dailyPriceChangePercent, accumulatedValue, accumulatedVolume, ttmPe, ttmPb, ttmRoe, npatmiGrowthYoyQm1, revenueGrowthYoy, netMargin, grossMargin, enOrganName, viOrganName, icbCodeLv2, icbCodeLv4, enSector, viSector, stockStrength, raw_json | TEXT/REAL | All listed stocks with screening metrics |
| `meta` | k, v | TEXT | Last run timestamp |

---

### 4. `vci_stats_financial.sqlite`
**Source:** VCI Financial Stats API
**Used by:** ValuationService, Stock overview metrics

| Table | Columns | Types | Description |
|---|---|---|---|
| `stats_financial` | ticker, pe, pb, ps, price_to_cash_flow, ev_to_ebitda, roe, roa, gross_margin, pre_tax_margin, after_tax_margin, net_interest_margin, cir, car, casa_ratio, npl, ldr, loans_growth, deposit_growth, debt_to_equity, financial_leverage, current_ratio, quick_ratio, cash_ratio, asset_turnover, inventory_turnover, ebit_margin, net_margin, market_cap, shares | TEXT/REAL | Latest TTM ratios per stock |
| `stats_financial_history` | ticker, year_report, quarter_report, pe, pb, ps, roe, roa, gross_margin, after_tax_margin, net_interest_margin, cir, car, casa_ratio, npl, ldr, loans_growth, deposit_growth | TEXT/INTEGER/REAL | Historical quarterly data |

---

### 5. `price_history.sqlite`
**Source:** VCI Price History API
**Used by:** /api/stock/[symbol]/history, Chart rendering

| Table | Columns | Types | Description |
|---|---|---|---|
| `stock_price_history` | symbol, time, open, high, low, close, volume | TEXT/REAL/INTEGER | Daily OHLCV for all stocks |

---

### 6. `vci_news_events.sqlite`
**Source:** VCI InvestorQuest API
**Used by:** /api/stock/[symbol]/news, News tab

| Table | Columns | Types | Description |
|---|---|---|---|
| `items` | id, symbol, tab (news/dividend/events), public_date, title, raw_json, fetched_at | TEXT | News articles, dividend announcements, corporate events |
| `fetch_meta` | symbol, tab, last_fetched, item_count | TEXT/INTEGER | Fetch tracking per symbol |

---

### 7. `vci_ratio_daily.sqlite`
**Source:** VCI Daily Ratios API
**Used by:** Daily PE/PB updates

| Table | Columns | Types | Description |
|---|---|---|---|
| `ratio_daily` | ticker, pe, pb, trading_date, fetched_at | TEXT/REAL | Daily PE/PB TTM per stock |
| `meta` | k, v | TEXT | Last run timestamp |

---

### 8. `vci_shareholders.sqlite`
**Source:** VCI Shareholders API
**Used by:** /api/stock/[symbol]/shareholders

| Table | Columns | Types | Description |
|---|---|---|---|
| `shareholders` | ticker, owner_code, owner_name, owner_name_en, position_name, quantity, percentage, owner_type (CORPORATE/INDIVIDUAL), update_date, public_date | TEXT/INTEGER/REAL | Top shareholders per company |
| `meta` | k, v | TEXT | Last run timestamp |

---

### 9. `vci_foreign.sqlite`
**Source:** VCI Foreign Trading API
**Used by:** /api/market/foreign

| Table | Columns | Types | Description |
|---|---|---|---|
| `foreign_net_snapshot` | trading_date, raw_json (buyList/sellList), fetched_at | TEXT | Daily foreign buy/sell snapshot |
| `foreign_volume_minute` | trading_date, minute, buy_volume, sell_volume, buy_value, sell_value | TEXT/REAL | Intraday minute foreign trading volume |

---

### 10. `macro_history.sqlite` / `fireant_macro.sqlite`
**Source:** VCI Macro API / Fireant API
**Used by:** /api/macro

| Table | Columns | Types | Description |
|---|---|---|---|
| `macro_indicators` | type, name, name_vn, unit, frequency, source, last_value, last_date | TEXT/REAL | GDP, CPI, M2, interest rates, etc. |
| `macro_data` | indicator_id, date, value | INTEGER/TEXT/REAL | Historical time series |

---

### 11. `index_history.sqlite`
**Source:** VCI Index API
**Used by:** /api/market/index-history

| Table | Columns | Types | Description |
|---|---|---|---|
| `market_index_history` | symbol, tradingDate, indexValue, indexChange, percentIndexChange, referenceIndex, openIndex, closeIndex, highestIndex, lowestIndex, totalVolume, totalValue, ... (62 cols) | TEXT/REAL/INTEGER | VNINDEX, VN30, HNXINDEX daily data |

---

### 12. `valuation_cache.sqlite`
**Source:** Self-calculated
**Used by:** /api/stock/[symbol]/valuation

| Table | Columns | Types | Description |
|---|---|---|---|
| `cache_entries` | symbol, request_hash, result_json, created_at | TEXT | Cached valuation results |

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      EXTERNAL APIs                               │
├──────────────────────┬──────────────────────────────────────────┤
│  VCI API             │  Fireant API                              │
│  (vietcap.com.vn)    │  (fireant.vn)                             │
└────┬─────────────────┴────┬─────────────────────────────────────┘
     │                      │
     ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│              FETCH SCRIPTS (fetch_sqlite/*.py)                    │
│  Run via cron jobs: hourly, daily, weekly                        │
└────┬────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LOCAL SQLITE DATABASES                         │
│  fetch_sqlite/vci_screening.sqlite                               │
│  fetch_sqlite/vci_stats_financial.sqlite                         │
│  fetch_sqlite/vci_financials.sqlite (balance_sheet, income, cf)  │
│  price_history.sqlite                                            │
│  ...etc                                                          │
└────┬────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│              BACKEND (Flask API)                                  │
│  stock_provider.py → reads stocks_optimized.db                   │
│  vci_financial_adapter.py → reads vci_financials.sqlite          │
│  source_priority.py → merges VCI + KBS data                      │
│  valuation_service.py → DCF calculation                          │
└────┬────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│              FRONTEND (Next.js)                                   │
│  FinancialsTab.tsx → /api/financial-report/ (VCI codes)          │
│  StockDetail → /api/stock/ (overview + history)                  │
│  Screener → /api/screener/                                       │
│  ...etc                                                          │
└─────────────────────────────────────────────────────────────────┘
```

## Fetch Schedule

| Script | Frequency | Updates |
|---|---|---|
| `fetch_vci_screener.py` | 1 hour | screening_data |
| `fetch_vci_stats_financial.py` | Daily | stats_financial (TTM) |
| `fetch_vci_financial_statement.py` | Daily | balance_sheet, income_statement, cash_flow, note |
| `fetch_vci_ratio_daily.py` | Daily | ratio_daily |
| `fetch_vci_shareholders.py` | Daily | shareholders |
| `fetch_vci_foreign.py` | Daily | foreign_net_snapshot, foreign_volume_minute |
| `fetch_vci_news.py` | Daily | news items |
| `update_price_history.py` | Daily | OHLCV data |
| `batch_news.py` | Daily | news events |
| `batch_valuations.py` | Daily | valuation cache |
