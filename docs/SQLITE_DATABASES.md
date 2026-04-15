# SQLite Databases Overview

> Last updated: 2026-04-15

## Summary Table

| # | Database File | Size | Source | Tables | Rows | Updated |
|---|---|---|---|---|---|---|
| 1 | ~~`stocks_optimized.db`~~ | — | *(removed — KBS/vnstock pipeline)* | — | — | *(defunct)* |
| 2 | `vci_financials.sqlite` | 132MB | VCI API | balance_sheet, income_statement, cash_flow, note | ~33k/tbl | daily |
| 3 | `vci_screening.sqlite` | 2.6MB | VCI API | screening_data, meta | ~1550 | every 7min |
| 4 | `vci_stats_financial.sqlite` | 10MB | VCI API | stats_financial, stats_financial_history | 1539 + 46k | hourly |
| 5 | `vci_company.sqlite` | 3.5MB | VCI API | companies | ~2075 | weekly |
| 6 | `price_history.sqlite` | 217MB | VCI API | stock_price_history | 2M+ | daily |
| 7 | `vci_news_events.sqlite` | 183MB | VCI API | items, fetch_meta | 178k | daily |
| 8 | `vci_ai_news.sqlite` | 6.5MB | VCI API + AI | news_items, news_meta | ~2.7k | every 10min |
| 9 | `vci_ratio_daily.sqlite` | 0.1MB | VCI API | ratio_daily, meta | ~1382 | daily |
| 10 | `vci_shareholders.sqlite` | 5.1MB | VCI API | shareholders | 27k+ | daily |
| 11 | `vci_foreign.sqlite` | 0.7MB | VCI API | foreign_net_snapshot, foreign_volume_minute | 17 + 4.6k | every 2min |
| 12 | `vci_valuation.sqlite` | 1.4MB | VCI API | valuation_history, valuation_stats, ema_breadth_history | ~5.5k | daily |
| 13 | `index_history.sqlite` | 0.2MB | VCI API | market_index_history | ~272 | every 15min |
| 14 | `macro_history.sqlite` | 0.6MB | VCI API | macro_prices | ~6k | weekly |
| 15 | `fireant_macro.sqlite` | 0.4MB | Fireant API | macro_indicators, macro_data | 96 + 6.7k | weekly |
| 16 | `valuation_cache.sqlite` | 0.1MB | Self-calculated | valuations | ~1.5k | on-demand |

---

## Detailed Schema

### ~~1. `stocks_optimized.db`~~ — REMOVED

**Status:** Removed 2026-04-15. The KBS/vnstock pipeline that populated this DB (`run_pipeline.py`) is no longer run.

**Replaced by:**
- `vci_company.sqlite` → company names, industry classification, company profiles
- `vci_stats_financial.sqlite` → PE, PB, PS, ROE, ROA, shares, market cap (TTM)
- `vci_screening.sqlite` → live market price, exchange, sector
- `vci_financials.sqlite` → full financial statements (income, balance sheet, cash flow)

---

### 1. `vci_financials.sqlite` — Financial Statements
**Source:** VCI Financial API (`fetch_vci_financial_statement.py`)
**Used by:** `vci_financial_adapter.py`, `/api/financial-report/`
**Field mapping:** `fetch_sqlite/vci_field_codes.json`
**Format:** Wide format — one column per VCI field code

| Table | Key Columns | Types | Notes |
|---|---|---|---|
| `balance_sheet` | ticker, period_kind, year_report, quarter_report, bsa1..bsa278, bsb*, bsi*, bss*, nos* | TEXT/INTEGER/REAL | ~330 cols, bank/insurance/securities variants |
| `income_statement` | ticker, period_kind, year_report, quarter_report, isa1..isa102, isb*, isi*, iss* | TEXT/INTEGER/REAL | ~180 cols |
| `cash_flow` | ticker, period_kind, year_report, quarter_report, cfa1..cfa105, cfb*, cfi*, cfs* | TEXT/INTEGER/REAL | ~225 cols |
| `note` | ticker, period_kind, year_report, quarter_report, noc* | TEXT/INTEGER/REAL | ~710 cols, thuyết minh BCTC |
| `fetch_log` | ticker, status, message, fetched_at | TEXT | Per-ticker fetch status |
| `meta` | k, v | TEXT | Last run timestamp |

**VCI Field Code Prefixes:**
- `*a*` → Standard companies (isa*, bsa*, cfa*, noc*)
- `*b*` → Banks (isb*, bsb*, cfb*)
- `*i*` → Insurance (isi*, bsi*, cfi*)
- `*s*` → Securities (iss*, bss*, cfs*)
- `nos*` → Off-balance-sheet items

**Key fields used in valuation:**
| Field | Meaning |
|---|---|
| `isa1` | Revenue (Doanh thu bán hàng) |
| `isa3` | Net sales (Doanh thu thuần) |
| `isa5` | Gross Profit |
| `isa7` | Financial expenses |
| `isa20` | Net profit after tax |
| `isa22` | Net profit attributable to parent company |
| `isa23` | EPS basic (VND) |
| `bsa78` | Owner's Equity (Vốn chủ sở hữu) |
| `bsa80` | Paid-in capital |
| `bsa96` | Total resource (Total liabilities + Equity) |
| `cfa2` | Depreciation and amortization |
| `cfa19` | Purchases of fixed assets (CapEx outflow) |

---

### 2. `vci_screening.sqlite` — Real-time Screener
**Source:** VCI Screener API (`fetch_vci_screener.py`)
**Used by:** `/api/market/screener`, peer comparison, valuation (current price)
**Update:** Every 7 minutes

| Table | Columns | Types |
|---|---|---|
| `screening_data` | ticker, exchange, marketPrice, refPrice, ceiling, floor, marketCap, accumulatedValue, accumulatedVolume, ttmPe, ttmPb, ttmRoe, npatmiGrowthYoyQm1, revenueGrowthYoy, netMargin, grossMargin, enOrganName, viOrganName, viOrganShortName, icbCodeLv2, icbCodeLv4, enSector, viSector, stockStrength, raw_json, fetched_at | TEXT/REAL |
| `meta` | k, v | TEXT |

**Key columns:**
- `marketPrice` — live price (primary source for valuation)
- `icbCodeLv2` — industry group code (used for peer comparison)
- `viSector` / `enSector` — sector name in VI/EN

---

### 3. `vci_stats_financial.sqlite` — TTM Financial Ratios
**Source:** VCI Stats Financial API (`fetch_vci_stats_financial.py`)
**Used by:** `valuation_service.py` (PE, PB, PS, ROE, shares), `source_priority.py`
**Update:** Every hour

| Table | Columns | Types |
|---|---|---|
| `stats_financial` | ticker, pe, pb, ps, price_to_cash_flow, ev_to_ebitda, roe, roa, gross_margin, pre_tax_margin, after_tax_margin, net_interest_margin, cir, car, casa_ratio, npl, ldr, loans_growth, deposit_growth, debt_to_equity, financial_leverage, current_ratio, quick_ratio, cash_ratio, asset_turnover, market_cap, shares, period_date, raw_json, fetched_at | TEXT/REAL |
| `stats_financial_history` | ticker, year_report, quarter_report, period_date, pe, pb, ps, roe, roa, gross_margin, after_tax_margin, ... | TEXT/INTEGER/REAL |

**Key columns used in valuation:**
- `pe`, `pb`, `ps` — TTM multiples → derive EPS = marketPrice/pe, BVPS = marketPrice/pb
- `shares` — shares outstanding
- `market_cap` — market cap in VND

---

### 4. `vci_company.sqlite` — Company Profiles & Industry Classification
**Source:** VCI Company Info API (`fetch_vci_company.py`)
**Used by:** `valuation_service.py` (industry), `/api/companies`, `/api/stock/overview`
**Update:** Weekly (bi-weekly, Sunday 02:00)

| Table | Columns | Types |
|---|---|---|
| `companies` | ticker, organ_name, en_organ_name, short_name, en_short_name, floor, logo_url, target_price, isbank, is_index, icb_code1..4, icb_name1..4, en_icb_name1..4, company_id, company_profile, fetched_at | TEXT/INTEGER |
| `fetch_log` | ticker, status, message, fetched_at | TEXT |

**Key columns:**
- `icb_name4` — most specific industry label (e.g. "Thép và sản phẩm thép") — primary industry key for valuation
- `icb_name3` / `icb_name2` — broader industry labels (fallback)
- `isbank` — 1 if bank (affects valuation model weighting)
- `company_profile` — company description text
- `floor` — exchange (HOSE/HNX/UPCOM)

---

### 5. `price_history.sqlite` — OHLCV Price History
**Source:** VCI Price History API (`update_price_history.py`)
**Used by:** `/api/stock/[symbol]/history`, chart rendering
**Update:** Daily 11:30 UTC

| Table | Columns | Types |
|---|---|---|
| `stock_price_history` | symbol, time, open, high, low, close, volume | TEXT/REAL/INTEGER |

---

### 6. `vci_news_events.sqlite` — News & Corporate Events
**Source:** VCI InvestorQuest API (`fetch_vci_news.py`)
**Used by:** `/api/stock/[symbol]/news`, news tab
**Update:** Daily

| Table | Columns | Types |
|---|---|---|
| `items` | id, symbol, tab (news/dividend/events), public_date, title, raw_json, fetched_at | TEXT |
| `fetch_meta` | symbol, tab, last_fetched, item_count | TEXT/INTEGER |

---

### 7. `vci_ai_news.sqlite` — AI-Analyzed News
**Source:** VCI API + AI processing (`fetch_vci_news.py`)
**Used by:** Frontend news widgets, sidebar
**Update:** Every 10 minutes

| Table | Columns | Types |
|---|---|---|
| `news_items` | id, title, summary, sentiment, ticker, url, published_at, fetched_at | TEXT |
| `news_meta` | k, v | TEXT |

---

### 8. `vci_ratio_daily.sqlite` — Daily PE/PB Tracker
**Source:** VCI Daily Ratios API (`fetch_vci_ratio_daily.py`)
**Used by:** `source_priority.py` (PRIORITY #1 for PE/PB in screener)
**Update:** Daily 13:30

| Table | Columns | Types |
|---|---|---|
| `ratio_daily` | ticker, pe, pb, trading_date, fetched_at | TEXT/REAL |
| `meta` | k, v | TEXT |

---

### 9. `vci_shareholders.sqlite` — Shareholder Lists
**Source:** VCI Shareholders API (`fetch_vci_shareholders.py`)
**Used by:** `/api/stock/[symbol]/shareholders`, Holders tab
**Update:** Daily 13:00

| Table | Columns | Types |
|---|---|---|
| `shareholders` | ticker, owner_code, owner_name, owner_name_en, position_name, quantity, percentage, owner_type (CORPORATE/INDIVIDUAL), update_date, public_date | TEXT/REAL |

---

### 10. `vci_foreign.sqlite` — Foreign Trading Flow
**Source:** VCI Foreign Trading API (`fetch_vci_foreign.py`)
**Used by:** `/api/market/foreign`
**Update:** Every 2 minutes during market hours

| Table | Columns | Types |
|---|---|---|
| `foreign_net_snapshot` | trading_date, raw_json, fetched_at | TEXT |
| `foreign_volume_minute` | trading_date, minute, buy_volume, sell_volume, buy_value, sell_value | TEXT/REAL |

---

### 11. `vci_valuation.sqlite` — VNINDEX Valuation Chart
**Source:** VCI API (`fetch_vci_valuation.py`)
**Used by:** `/api/market/pe-chart`, `/api/market/index-valuation-chart`
**Update:** Daily

| Table | Columns | Types |
|---|---|---|
| `valuation_history` | date, pe, pb, price, open, high, low, close | TEXT/REAL |
| `valuation_stats` | metric, avg, sd1_up, sd1_down, sd2_up, sd2_down | TEXT/REAL |
| `ema_breadth_history` | date, breadth_pct | TEXT/REAL |
| `meta` | k, v | TEXT |

---

### 12. `index_history.sqlite` — Market Index History
**Source:** VCI Index API (`fetch_vci.py`)
**Used by:** `/api/market/index-history`
**Update:** Every 15 minutes

| Table | Columns | Types |
|---|---|---|
| `market_index_history` | symbol, tradingDate, indexValue, indexChange, percentIndexChange, openIndex, closeIndex, highestIndex, lowestIndex, totalVolume, totalValue, ... (62 cols) | TEXT/REAL/INTEGER |
| `meta` | k, v | TEXT |

---

### 13. `macro_history.sqlite` / `fireant_macro.sqlite` — Macro Economics
**Source:** VCI Macro API / Fireant API
**Used by:** `/api/macro`
**Update:** Weekly

| Table | Columns | Notes |
|---|---|---|
| `macro_prices` | symbol, date, close | VCI macro time series |
| `macro_indicators` | type, name, name_vn, unit, frequency, source | Fireant indicator metadata |
| `macro_data` | indicator_id, date, value | Fireant historical series |

---

### 14. `valuation_cache.sqlite` — DCF Valuation Cache
**Source:** Self-calculated (`batch_valuations.py`)
**Used by:** Batch valuation pre-computation
**Update:** On-demand

| Table | Columns | Types |
|---|---|---|
| `valuations` | symbol, request_hash, result_json, created_at | TEXT |

---

## Data Flow

```
VCI API  ──────────────────────────────────────────────────────────┐
  │                                                                 │
  ├── fetch_vci_screener.py (7min)  → vci_screening.sqlite         │
  ├── fetch_vci_stats_financial.py (1h) → vci_stats_financial.sqlite│
  ├── fetch_vci_financial_statement.py (daily) → vci_financials.sqlite│
  ├── fetch_vci_company.py (weekly) → vci_company.sqlite           │
  ├── fetch_vci_ratio_daily.py (daily) → vci_ratio_daily.sqlite    │
  ├── fetch_vci_shareholders.py (daily) → vci_shareholders.sqlite  │
  ├── fetch_vci_foreign.py (2min) → vci_foreign.sqlite             │
  ├── fetch_vci_valuation.py (daily) → vci_valuation.sqlite        │
  ├── update_price_history.py (daily) → price_history.sqlite       │
  └── fetch_vci.py (15min) → index_history.sqlite                  │
                                                                    │
Fireant API → fetch_fireant_macro.py → fireant_macro.sqlite        │
                                                                    │
                   Flask Backend                                    │
  ┌────────────────────────────────────────────────────────────┐   │
  │  valuation_service.py                                       │   │
  │    1. industry    ← vci_company.companies.icb_name4        │   │
  │    2. price       ← vci_screening.marketPrice              │   │
  │    3. PE/PB/PS    ← vci_stats_financial.stats_financial    │   │
  │    4. EPS history ← vci_financials.income_statement.isa23  │   │
  │    5. Net income  ← vci_financials.income_statement.isa22  │   │
  │    6. Capex/WC    ← vci_financials.cash_flow               │   │
  │    7. Peers PE/PB ← vci_screening + vci_stats_financial    │   │
  │                                                             │   │
  │  source_priority.py (PE/PB priority chain):                │   │
  │    1. vci_ratio_daily  2. vci_stats_financial              │   │
  │    3. vci_screening    4. vnstock live API                  │   │
  └────────────────────────────────────────────────────────────┘   │
                                                                    │
                   Frontend (Next.js)                               │
  /stock/[symbol] → overview, financials, valuation, news, etc.    │
  /screener → vci_screening + vci_stats_financial                  │
```

---

## Fetch Schedule

| Frequency | Script | Output |
|---|---|---|
| Every 2 min (market hours) | `fetch_vci_foreign.py` | `vci_foreign.sqlite` |
| Every 7 min | `fetch_vci_screener.py` | `vci_screening.sqlite` |
| Every 10 min | `fetch_vci_news.py` | `vci_ai_news.sqlite` |
| Every 15 min | `fetch_vci.py` | `index_history.sqlite` |
| Every 1 hour | `fetch_vci_stats_financial.py` | `vci_stats_financial.sqlite` |
| Daily 11:30 UTC | `update_price_history.py` | `price_history.sqlite` |
| Daily 13:00 | `fetch_vci_shareholders.py` | `vci_shareholders.sqlite` |
| Daily 13:30 | `fetch_vci_ratio_daily.py` | `vci_ratio_daily.sqlite` |
| Daily | `fetch_vci_financial_statement.py` | `vci_financials.sqlite` |
| Daily | `fetch_vci_news.py` (events) | `vci_news_events.sqlite` |
| Daily | `fetch_vci_valuation.py` | `vci_valuation.sqlite` |
| Weekly (Sun 02:00) | `fetch_vci_company.py` | `vci_company.sqlite` |
| Weekly | `fetch_macro_history.py` | `macro_history.sqlite` |
| Weekly | `fetch_fireant_macro.py` | `fireant_macro.sqlite` |
| On-demand | `batch_valuations.py` | `valuation_cache.sqlite` |

---

## PE/PB Source Priority Chain

```
1. vci_ratio_daily.sqlite       → Daily PE/PB (most current, PRIORITY #1)
2. vci_stats_financial.sqlite   → TTM ratios (updated hourly)
3. vci_screening.sqlite         → Screener snapshot (ttmPe/ttmPb columns)
4. vnstock API (live)           → Last resort fallback
```

> `stocks_optimized.db` has been removed from the priority chain.
