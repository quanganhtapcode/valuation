# Earnings Season Key Stats — Design Spec

**Date:** 2026-05-06  
**Feature:** AI Key Stats section on Overview page  
**Status:** Approved

---

## Overview

Add an "AI Key Stats" section to the Overview page between the HeatmapVN30 and NewsSection components. The section displays aggregate earnings season statistics computed from `vci_financials.sqlite` and `vci_screening.sqlite`, with no LLM involved in this phase (Gemini integration planned later).

---

## Architecture

```
vci_financials.sqlite (income_statement)  +  vci_screening.sqlite (screening_data)
         ↓
Flask: GET /api/earnings-season
         ↓
Next.js proxy: /api/earnings-season (existing [...path]/route.ts proxy)
         ↓
React: <EarningsSeason /> inserted in OverviewClient.tsx
```

### Exchange filter

Only HOSE (`HSX`) and HNX (`HNX`) stocks are included. UPCOM is excluded. Join via `ticker` between `income_statement` and `screening_data`.

---

## Backend

### Endpoint

`GET /api/earnings-season`

No parameters. Response is cached in-process for 30 minutes.

### Logic

1. **Auto-detect current quarter:** Find `(year_report, quarter_report)` with the highest distinct ticker count where `quarter_report != 0`. This automatically advances as new quarters roll in.

2. **Coverage stats:**
   - `reported_count`: COUNT DISTINCT tickers in detected quarter, joined to screening_data where `exchange IN ('HSX','HNX')`
   - `total_count`: COUNT DISTINCT tickers in screening_data where `exchange IN ('HSX','HNX')`
   - `reported_pct`: reported_count / total_count × 100

3. **Market cap coverage:**
   - Sum `marketCap` of reported tickers / sum `marketCap` of all HOSE+HNX tickers × 100
   - Both sums from `screening_data`

4. **Top growers (revenue YoY, revenue QoQ, profit YoY, profit QoQ):**
   - Column `isa1` = net revenue, `isa22` = net profit after tax
   - **YoY:** compare current quarter vs same quarter prior year (e.g., Q1.2026 vs Q1.2025)
   - **QoQ:** compare current quarter vs prior quarter (e.g., Q1.2026 vs Q4.2025)
   - Filter: base period value must be > 10 billion VND (1e10) to exclude outliers
   - Filter: both periods must exist for the ticker
   - Sort descending by growth %, take top 5
   - Return: ticker, organ_short_name (from `stocks` table in vci_financials), growth_pct, base_value, current_value

### Response shape

```json
{
  "quarter": "Q1.2026",
  "year": 2026,
  "q": 1,
  "reported_count": 933,
  "total_count": 620,
  "reported_pct": 60.1,
  "market_cap_pct": 72.4,
  "top_revenue_yoy": [
    { "ticker": "VHM", "name": "Vinhomes", "growth_pct": 185.2, "base_value": 5.2e12, "current_value": 1.48e13 }
  ],
  "top_revenue_qoq": [...],
  "top_profit_yoy": [...],
  "top_profit_qoq": [...],
  "updated_at": "2026-05-06T11:15:00Z"
}
```

### Flask blueprint

New file: `backend/routes/market/earnings_season.py`  
Registered in the existing market blueprint or as its own blueprint mounted at `/api`.

---

## Frontend

### New component

`frontend-next/src/components/EarningsSeason/EarningsSeason.tsx`

**Structure:**
- 3 stat cards (reported count, % companies, % market cap)
- 4 sub-tabs: Doanh thu YoY | Doanh thu QoQ | Lợi nhuận YoY | Lợi nhuận QoQ
- Each tab: ranked list of top 5 tickers with growth % badge and link to `/stock/[ticker]`
- Skeleton loading state while fetching
- Fetch on mount, no periodic refresh (data changes at most once daily)

**API helper:** Add `fetchEarningsSeason()` to `src/lib/api.ts`

### Placement in OverviewClient.tsx

```tsx
<HeatmapVN30 />
<EarningsSeason />          {/* ← new */}
<div className="order-2">
  <NewsSection ... />
</div>
```

### Styling

Follow existing Tremor card patterns (ring-1, rounded-2xl, dark mode). Sub-tabs use a pill-style tab group. Growth % shown as a colored badge (green for positive).

---

## Notification (Phase 2 — after core feature)

### Telegram

In `fetch_sqlite/fetch_vci_financial_statement.py`: after each fetch run, compare newly inserted tickers vs previous run. If new tickers found, send Telegram message listing them.

### In-app

A small "New today" badge on the EarningsSeason section header when the `updated_at` date matches today.

---

## Out of scope (this iteration)

- AI/LLM narrative summary (Gemini — future)
- Negative growers / worst performers list
- Industry-level breakdown
- User-selectable quarter override
