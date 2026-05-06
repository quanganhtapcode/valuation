# Earnings Season Key Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "AI Key Stats" section between HeatmapVN30 and NewsSection on the Overview page showing Q1.2026 earnings season coverage and top growers from HOSE+HNX stocks.

**Architecture:** Flask endpoint `/api/market/earnings-season` queries `vci_financials.sqlite`, `vci_screening.sqlite`, and `vci_company.sqlite` to compute stats; Next.js proxies through existing `[...path]/route.ts`; React `<EarningsSeason />` component fetches on mount and renders stat cards + 4-tab top-growers table.

**Tech Stack:** Python/Flask (SQLite), React 19, TypeScript, Tailwind CSS, Tremor-style card patterns

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `backend/routes/market/paths.py` | Add `financials_db_path()` and `company_db_path()` helpers |
| Create | `backend/routes/market/earnings_season.py` | Flask route + all SQL logic |
| Modify | `backend/routes/market/__init__.py` | Register new route |
| Modify | `frontend-next/src/lib/api.ts` | Add `EARNINGS_SEASON` constant + `fetchEarningsSeason()` |
| Create | `frontend-next/src/components/EarningsSeason/EarningsSeason.tsx` | Full UI component |
| Create | `frontend-next/src/components/EarningsSeason/index.ts` | Re-export |
| Modify | `frontend-next/src/app/OverviewClient.tsx` | Insert `<EarningsSeason />` between HeatmapVN30 and NewsSection |

---

## Task 1: Add DB path helpers

**Files:**
- Modify: `backend/routes/market/paths.py`

- [ ] **Step 1: Read current paths.py**

Open `backend/routes/market/paths.py`. It currently contains:
```python
from __future__ import annotations
import os

def project_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

def screener_db_path() -> str:
    return os.path.join(project_root(), "fetch_sqlite", "vci_screening.sqlite")
```

- [ ] **Step 2: Add two new helpers**

Append to `backend/routes/market/paths.py`:
```python
def financials_db_path() -> str:
    return os.environ.get(
        "VCI_FINANCIAL_STATEMENT_DB_PATH",
        os.path.join(project_root(), "fetch_sqlite", "vci_financials.sqlite"),
    )

def company_db_path() -> str:
    return os.environ.get(
        "VCI_COMPANY_DB_PATH",
        os.path.join(project_root(), "fetch_sqlite", "vci_company.sqlite"),
    )
```

- [ ] **Step 3: Verify Python syntax**

```bash
python3 -c "from backend.routes.market.paths import financials_db_path, company_db_path; print(financials_db_path()); print(company_db_path())"
```

Expected: two absolute paths printed, no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/routes/market/paths.py
git commit -m "feat(earnings): add financials and company db path helpers"
```

---

## Task 2: Flask endpoint — earnings_season.py

**Files:**
- Create: `backend/routes/market/earnings_season.py`

- [ ] **Step 1: Create the file**

Create `backend/routes/market/earnings_season.py` with this exact content:

```python
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone
from typing import Any

from flask import Blueprint, jsonify

from .deps import cache_func
from .paths import company_db_path, financials_db_path, screener_db_path

logger = logging.getLogger(__name__)

_CACHE_SECONDS = 1800  # 30 minutes
_MIN_BASE_VALUE = 1e10  # 10 billion VND — filter tiny companies from top-growers


def _detect_current_quarter(fin_conn: sqlite3.Connection) -> tuple[int, int]:
    """Return (year, quarter) with the most distinct tickers, excluding annual (quarter=0)."""
    row = fin_conn.execute(
        """
        SELECT year_report, quarter_report, COUNT(DISTINCT ticker) AS cnt
        FROM income_statement
        WHERE quarter_report != 0
        GROUP BY year_report, quarter_report
        ORDER BY cnt DESC
        LIMIT 1
        """
    ).fetchone()
    if row is None:
        now = datetime.now(timezone.utc)
        return now.year, (now.month - 1) // 3 or 1
    return int(row[0]), int(row[1])


def _prev_year_quarter(year: int, q: int) -> tuple[int, int]:
    return year - 1, q


def _prev_quarter(year: int, q: int) -> tuple[int, int]:
    if q == 1:
        return year - 1, 4
    return year, q - 1


def _load_company_names(company_db: str) -> dict[str, str]:
    try:
        conn = sqlite3.connect(f"file:{company_db}?mode=ro", uri=True)
        rows = conn.execute("SELECT ticker, short_name FROM companies").fetchall()
        conn.close()
        return {r[0]: r[1] for r in rows}
    except Exception:
        return {}


def _load_hose_hnx_tickers(screener_db: str) -> dict[str, float]:
    """Return {ticker: marketCap} for HOSE+HNX only."""
    conn = sqlite3.connect(f"file:{screener_db}?mode=ro", uri=True)
    rows = conn.execute(
        "SELECT ticker, marketCap FROM screening_data WHERE exchange IN ('HSX', 'HNX')"
    ).fetchall()
    conn.close()
    return {r[0]: float(r[1] or 0) for r in rows}


def _top_growers(
    fin_conn: sqlite3.Connection,
    column: str,
    cur_year: int,
    cur_q: int,
    prev_year: int,
    prev_q: int,
    allowed_tickers: set[str],
    names: dict[str, str],
    limit: int = 5,
) -> list[dict[str, Any]]:
    rows = fin_conn.execute(
        f"""
        SELECT cur.ticker, cur.{column} AS cur_val, prv.{column} AS prv_val
        FROM income_statement cur
        JOIN income_statement prv
          ON cur.ticker = prv.ticker
         AND prv.year_report = ?
         AND prv.quarter_report = ?
        WHERE cur.year_report = ?
          AND cur.quarter_report = ?
          AND prv.{column} > ?
          AND cur.{column} IS NOT NULL
        """,
        (prev_year, prev_q, cur_year, cur_q, _MIN_BASE_VALUE),
    ).fetchall()

    results = []
    for ticker, cur_val, prv_val in rows:
        if ticker not in allowed_tickers:
            continue
        if not prv_val or prv_val == 0:
            continue
        growth_pct = (cur_val - prv_val) / abs(prv_val) * 100
        results.append(
            {
                "ticker": ticker,
                "name": names.get(ticker, ticker),
                "growth_pct": round(growth_pct, 1),
                "base_value": round(prv_val),
                "current_value": round(cur_val),
            }
        )

    results.sort(key=lambda x: x["growth_pct"], reverse=True)
    return results[:limit]


def compute_earnings_season() -> dict[str, Any]:
    fin_db = financials_db_path()
    scr_db = screener_db_path()
    cmp_db = company_db_path()

    fin_conn = sqlite3.connect(f"file:{fin_db}?mode=ro", uri=True)

    try:
        cur_year, cur_q = _detect_current_quarter(fin_conn)
        hose_hnx = _load_hose_hnx_tickers(scr_db)
        names = _load_company_names(cmp_db)
        allowed = set(hose_hnx.keys())
        total_market_cap = sum(hose_hnx.values())

        # Reported tickers in current quarter that are in HOSE/HNX
        reported_rows = fin_conn.execute(
            "SELECT DISTINCT ticker FROM income_statement WHERE year_report=? AND quarter_report=?",
            (cur_year, cur_q),
        ).fetchall()
        reported_tickers = {r[0] for r in reported_rows} & allowed

        reported_count = len(reported_tickers)
        total_count = len(allowed)
        reported_pct = round(reported_count / total_count * 100, 1) if total_count else 0

        reported_cap = sum(hose_hnx.get(t, 0) for t in reported_tickers)
        market_cap_pct = round(reported_cap / total_market_cap * 100, 1) if total_market_cap else 0

        py_year, py_q = _prev_year_quarter(cur_year, cur_q)
        pq_year, pq_q = _prev_quarter(cur_year, cur_q)

        return {
            "quarter": f"Q{cur_q}.{cur_year}",
            "year": cur_year,
            "q": cur_q,
            "reported_count": reported_count,
            "total_count": total_count,
            "reported_pct": reported_pct,
            "market_cap_pct": market_cap_pct,
            "top_revenue_yoy": _top_growers(fin_conn, "isa1", cur_year, cur_q, py_year, py_q, allowed, names),
            "top_revenue_qoq": _top_growers(fin_conn, "isa1", cur_year, cur_q, pq_year, pq_q, allowed, names),
            "top_profit_yoy": _top_growers(fin_conn, "isa22", cur_year, cur_q, py_year, py_q, allowed, names),
            "top_profit_qoq": _top_growers(fin_conn, "isa22", cur_year, cur_q, pq_year, pq_q, allowed, names),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    finally:
        fin_conn.close()


def register(market_bp: Blueprint) -> None:
    @market_bp.route("/earnings-season")
    def api_earnings_season():
        cache_key = "earnings_season_v1"

        def fetch():
            return compute_earnings_season()

        try:
            data, is_cached = cache_func()(cache_key, _CACHE_SECONDS, fetch)
            resp = jsonify(data)
            resp.headers["X-Cache"] = "HIT" if is_cached else "MISS"
            return resp
        except Exception as e:
            logger.error(f"Earnings season error: {e}")
            return jsonify({"error": str(e)}), 500
```

- [ ] **Step 2: Verify syntax**

```bash
python3 -c "from backend.routes.market.earnings_season import compute_earnings_season; import json; print(json.dumps(compute_earnings_season(), indent=2, ensure_ascii=False))" 2>&1 | head -60
```

Expected: JSON output with `quarter`, `reported_count`, `top_revenue_yoy` list, etc. No errors.

- [ ] **Step 3: Commit**

```bash
git add backend/routes/market/earnings_season.py
git commit -m "feat(earnings): add Flask earnings-season endpoint"
```

---

## Task 3: Register route in market blueprint

**Files:**
- Modify: `backend/routes/market/__init__.py`

- [ ] **Step 1: Add import and register call**

In `backend/routes/market/__init__.py`, add after the last `from .events import register as register_events` line:
```python
    from .earnings_season import register as register_earnings_season
```

And after `register_events(bp)`:
```python
    register_earnings_season(bp)
```

- [ ] **Step 2: Start backend and test endpoint**

```bash
python -m backend.server &
sleep 2
curl -s http://localhost:5000/api/market/earnings-season | python3 -m json.tool | head -40
kill %1
```

Expected: JSON with `quarter: "Q1.2026"`, `reported_count` ~933, lists of top growers.

- [ ] **Step 3: Commit**

```bash
git add backend/routes/market/__init__.py
git commit -m "feat(earnings): register earnings-season route in market blueprint"
```

---

## Task 4: Add frontend API constant and fetch function

**Files:**
- Modify: `frontend-next/src/lib/api.ts`

- [ ] **Step 1: Add API constant**

In `frontend-next/src/lib/api.ts`, inside the `API` object (after `LOTTERY` line), add:
```typescript
    EARNINGS_SEASON: `${API_BASE}/market/earnings-season`,
```

- [ ] **Step 2: Add TypeScript types and fetch function**

At the end of `frontend-next/src/lib/api.ts`, append:

```typescript
export interface EarningsGrower {
    ticker: string;
    name: string;
    growth_pct: number;
    base_value: number;
    current_value: number;
}

export interface EarningsSeasonData {
    quarter: string;
    year: number;
    q: number;
    reported_count: number;
    total_count: number;
    reported_pct: number;
    market_cap_pct: number;
    top_revenue_yoy: EarningsGrower[];
    top_revenue_qoq: EarningsGrower[];
    top_profit_yoy: EarningsGrower[];
    top_profit_qoq: EarningsGrower[];
    updated_at: string;
}

export async function fetchEarningsSeason(): Promise<EarningsSeasonData | null> {
    try {
        return await fetchAPI<EarningsSeasonData>(API.EARNINGS_SEASON);
    } catch {
        return null;
    }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend-next && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend-next/src/lib/api.ts
git commit -m "feat(earnings): add fetchEarningsSeason API helper"
```

---

## Task 5: Build EarningsSeason React component

**Files:**
- Create: `frontend-next/src/components/EarningsSeason/EarningsSeason.tsx`
- Create: `frontend-next/src/components/EarningsSeason/index.ts`

- [ ] **Step 1: Create the component**

Create `frontend-next/src/components/EarningsSeason/EarningsSeason.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchEarningsSeason, EarningsSeasonData, EarningsGrower } from '@/lib/api';

type TabKey = 'revenue_yoy' | 'revenue_qoq' | 'profit_yoy' | 'profit_qoq';

const TABS: { key: TabKey; label: string }[] = [
    { key: 'revenue_yoy', label: 'Doanh thu YoY' },
    { key: 'revenue_qoq', label: 'Doanh thu QoQ' },
    { key: 'profit_yoy', label: 'Lợi nhuận YoY' },
    { key: 'profit_qoq', label: 'Lợi nhuận QoQ' },
];

function formatTrillions(val: number): string {
    if (val >= 1e12) return (val / 1e12).toFixed(1) + 'T';
    if (val >= 1e9) return (val / 1e9).toFixed(1) + 'B';
    return (val / 1e6).toFixed(0) + 'M';
}

function GrowthBadge({ pct }: { pct: number }) {
    const color = pct >= 0
        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
        : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    return (
        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${color}`}>
            {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
        </span>
    );
}

function GrowerRow({ rank, item }: { rank: number; item: EarningsGrower }) {
    return (
        <div className="flex items-center gap-3 py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
            <span className="w-5 text-xs text-gray-400 dark:text-gray-600 text-right tabular-nums">{rank}</span>
            <div className="flex-1 min-w-0">
                <Link
                    href={`/stock/${item.ticker}`}
                    className="text-sm font-semibold text-blue-600 hover:text-blue-500 dark:text-blue-400"
                >
                    {item.ticker}
                </Link>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.name}</p>
            </div>
            <div className="text-right">
                <GrowthBadge pct={item.growth_pct} />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 tabular-nums">
                    {formatTrillions(item.base_value)} → {formatTrillions(item.current_value)}
                </p>
            </div>
        </div>
    );
}

function Skeleton() {
    return (
        <div className="animate-pulse space-y-3">
            <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3].map(i => (
                    <div key={i} className="rounded-xl bg-gray-100 dark:bg-gray-800 h-16" />
                ))}
            </div>
            <div className="flex gap-2">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className="h-7 w-28 rounded-full bg-gray-100 dark:bg-gray-800" />
                ))}
            </div>
            {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-10 rounded-lg bg-gray-100 dark:bg-gray-800" />
            ))}
        </div>
    );
}

export default function EarningsSeason() {
    const [data, setData] = useState<EarningsSeasonData | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabKey>('revenue_yoy');

    useEffect(() => {
        fetchEarningsSeason().then(d => {
            setData(d);
            setLoading(false);
        });
    }, []);

    const growers: EarningsGrower[] = data
        ? activeTab === 'revenue_yoy' ? data.top_revenue_yoy
        : activeTab === 'revenue_qoq' ? data.top_revenue_qoq
        : activeTab === 'profit_yoy' ? data.top_profit_yoy
        : data.top_profit_qoq
        : [];

    return (
        <section className="rounded-2xl bg-white dark:bg-gray-900 ring-1 ring-gray-200 dark:ring-gray-800 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">
                        AI Key Stats
                        {data && (
                            <span className="ml-2 text-xs font-normal text-gray-400 dark:text-gray-500">
                                Mùa BCTC {data.quarter}
                            </span>
                        )}
                    </h2>
                </div>
                {data && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                        {new Date(data.updated_at).toLocaleDateString('vi-VN')}
                    </span>
                )}
            </div>

            {loading ? (
                <Skeleton />
            ) : !data ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">Không thể tải dữ liệu.</p>
            ) : (
                <>
                    {/* Stat cards */}
                    <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
                            <p className="text-xs text-gray-500 dark:text-gray-400">Đã có BCTC</p>
                            <p className="text-lg font-bold text-gray-900 dark:text-gray-50 tabular-nums">
                                {data.reported_count.toLocaleString('vi-VN')}
                                <span className="text-sm font-normal text-gray-400 dark:text-gray-500">
                                    /{data.total_count.toLocaleString('vi-VN')}
                                </span>
                            </p>
                        </div>
                        <div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
                            <p className="text-xs text-gray-500 dark:text-gray-400">% Số công ty</p>
                            <p className="text-lg font-bold text-gray-900 dark:text-gray-50 tabular-nums">
                                {data.reported_pct}%
                            </p>
                        </div>
                        <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 p-3">
                            <p className="text-xs text-blue-600 dark:text-blue-400">% Vốn hóa</p>
                            <p className="text-lg font-bold text-blue-700 dark:text-blue-300 tabular-nums">
                                {data.market_cap_pct}%
                            </p>
                        </div>
                    </div>

                    {/* Sub-tabs */}
                    <div className="flex gap-1.5 mb-3 flex-wrap">
                        {TABS.map(tab => (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                    activeTab === tab.key
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Growers list */}
                    <div>
                        {growers.length === 0 ? (
                            <p className="text-xs text-gray-400 dark:text-gray-500 py-4 text-center">
                                Không có dữ liệu cho kỳ này.
                            </p>
                        ) : (
                            growers.map((item, i) => (
                                <GrowerRow key={item.ticker} rank={i + 1} item={item} />
                            ))
                        )}
                    </div>
                </>
            )}
        </section>
    );
}
```

- [ ] **Step 2: Create index.ts**

Create `frontend-next/src/components/EarningsSeason/index.ts`:

```typescript
export { default as EarningsSeason } from './EarningsSeason';
```

- [ ] **Step 3: Check TypeScript**

```bash
cd frontend-next && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend-next/src/components/EarningsSeason/
git commit -m "feat(earnings): add EarningsSeason React component"
```

---

## Task 6: Wire component into OverviewClient

**Files:**
- Modify: `frontend-next/src/app/OverviewClient.tsx`

- [ ] **Step 1: Add import**

At the top of `frontend-next/src/app/OverviewClient.tsx`, after the `HeatmapVN30` import line, add:
```typescript
import { EarningsSeason } from '@/components/EarningsSeason';
```

- [ ] **Step 2: Insert component in JSX**

In `OverviewClient.tsx`, find:
```tsx
                    <HeatmapVN30 />

                    <div className="order-2">
                        <NewsSection news={news} isLoading={newsLoading} error={newsError} />
                    </div>
```

Replace with:
```tsx
                    <HeatmapVN30 />

                    <EarningsSeason />

                    <div className="order-2">
                        <NewsSection news={news} isLoading={newsLoading} error={newsError} />
                    </div>
```

- [ ] **Step 3: Build and verify**

```bash
cd frontend-next && npm run build 2>&1 | tail -20
```

Expected: build completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend-next/src/app/OverviewClient.tsx
git commit -m "feat(earnings): insert EarningsSeason between heatmap and news on overview"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Auto-detect quarter → `_detect_current_quarter()` in Task 2
- ✅ HOSE+HNX filter only → `_load_hose_hnx_tickers()` filters `exchange IN ('HSX','HNX')`
- ✅ Coverage count + % companies + % market cap → Task 2 compute block
- ✅ Top revenue YoY/QoQ, top profit YoY/QoQ → `_top_growers()` called 4× with correct periods
- ✅ Min base value filter (10B VND) → `_MIN_BASE_VALUE = 1e10` used in SQL
- ✅ 30-min backend cache → `_CACHE_SECONDS = 1800`
- ✅ 3 stat cards + 4 tabs + top 5 per tab → Task 5 component
- ✅ Ticker links to `/stock/[ticker]` → `<Link href={/stock/${item.ticker}}>` in GrowerRow
- ✅ Skeleton loading state → `<Skeleton />` component in Task 5
- ✅ Dark mode → all Tailwind classes include `dark:` variants
- ✅ Placement between HeatmapVN30 and NewsSection → Task 6

**Notification (Phase 2) is explicitly out of scope for this plan.**
