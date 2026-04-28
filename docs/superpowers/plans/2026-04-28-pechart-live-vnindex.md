# PEChart Live VNINDEX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update the VNINDEX line on PEChart with live WebSocket price during trading hours, appending a "today" data point that tracks the current index value in real-time.

**Architecture:** Reuse the existing `/ws/market/indices` WebSocket (already consumed by HeroIndexCard). In `PEChart.tsx`, subscribe to `subscribeIndicesStream`, store the latest live price in a ref (`liveVnindexRef`), and call `areaSeriesRef.current.update()` to paint the today-point. Re-apply the live point after every `setData()` call so tab switches don't wipe it.

**Tech Stack:** lightweight-charts `series.update()`, existing `subscribeIndicesStream` + `isTradingHours` from `@/lib/api`

---

### Task 1: Add live VNINDEX WebSocket subscription to PEChart

**Files:**
- Modify: `frontend-next/src/components/PEChart/PEChart.tsx`

- [ ] **Step 1: Add imports**

At line 16, extend the import from `@/lib/api`:
```tsx
import { fetchPEChart, fetchPEChartByRange, PEChartData, PEChartResult, ValuationStats, subscribeIndicesStream, isTradingHours } from '@/lib/api';
```

- [ ] **Step 2: Add `liveVnindexRef` and `applyLivePoint` helper**

After `const activeChartRef = useRef<ActiveChart>('vnindex');` (around line 179), add:
```tsx
const liveVnindexRef = useRef<{ time: UTCTime; value: number } | null>(null);

const applyLivePoint = useCallback(() => {
    if (!liveVnindexRef.current || !areaSeriesRef.current) return;
    try { areaSeriesRef.current.update(liveVnindexRef.current); } catch {}
}, []);
```

- [ ] **Step 3: Add WebSocket subscription effect**

After the `useEffect(() => { activeChartRef.current = activeChart; }, [activeChart]);` line (~line 185), add:
```tsx
// Live VNINDEX "today" point via WebSocket — only active during trading hours
useEffect(() => {
    if (!isTradingHours()) return;
    const unsubscribe = subscribeIndicesStream({
        onData: (marketData) => {
            const vnindex = marketData['1']; // '1' = VNINDEX
            if (!vnindex?.CurrentIndex) return;
            const now = new Date();
            const vnMs = now.getTime() + now.getTimezoneOffset() * 60_000 + 7 * 3_600_000;
            const vn = new Date(vnMs);
            const todayTime: UTCTime = { year: vn.getFullYear(), month: vn.getMonth() + 1, day: vn.getDate() };
            liveVnindexRef.current = { time: todayTime, value: vnindex.CurrentIndex };
            applyLivePoint();
        },
    });
    return unsubscribe;
}, [applyLivePoint]);
```

- [ ] **Step 4: Re-apply live point after setData in "Push VNIndex data" effect**

In the effect around line 397-416, after `closeByDayRef.current = new Map(...)`, add `applyLivePoint();`:
```tsx
areaSeriesRef.current.setData(vnTVData.map(d => ({ time: d.time, value: d.close })));
closeByDayRef.current = new Map(vnTVData.map(d => [utcDayKey(d.time), d.close]));
applyLivePoint(); // re-apply live today-point after data reset

volumeSeriesRef.current.setData(vnTVData.map((d, i) => ({
```

- [ ] **Step 5: Re-apply live point after setData in "Tab switch" effect**

In the tab switch effect (~line 465-474), after the `area.setData(...)` + `volume.setData(...)` block for the vnindex branch, add `applyLivePoint();`:
```tsx
} else if (vnTVData.length) {
    area.setData(vnTVData.map(d => ({ time: d.time, value: d.close })));
    volume.setData(vnTVData.map((d, i) => ({
        time:  d.time,
        value: d.volume,
        color: i === 0 || d.close >= vnTVData[i - 1].close
            ? 'rgba(34,197,94,0.45)'
            : 'rgba(239,68,68,0.45)',
    })));
    applyLivePoint(); // re-apply live today-point after tab switch reset
}
```

- [ ] **Step 6: Build and verify**

```bash
cd /var/www/valuation/frontend-next && npm run build 2>&1 | tail -20
```
Expected: no TypeScript errors, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add frontend-next/src/components/PEChart/PEChart.tsx
git commit -m "feat(pechart): live VNINDEX today-point via WebSocket during trading hours"
```
