'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  fetchScreener,
  ScreenerFilters,
  ScreenerItem,
  ScreenerSortKey,
} from '@/lib/api';

const PAGE_SIZE = 50;

const SORT_OPTIONS: Array<{ label: string; value: ScreenerSortKey }> = [
  { label: 'Market Cap', value: 'market_cap' },
  { label: 'P/E', value: 'pe' },
  { label: 'P/B', value: 'pb' },
  { label: 'ROE', value: 'roe' },
  { label: 'Price', value: 'price' },
  { label: 'Daily Change', value: 'daily_change' },
  { label: 'Revenue Growth', value: 'revenue_growth' },
  { label: 'Net Profit Growth', value: 'net_profit_growth' },
];

const EXCHANGES = ['HOSE', 'HNX', 'UPCOM'];
const PE_RANGE = { min: 0, max: 60, step: 1 };
const PB_RANGE = { min: 0, max: 10, step: 0.1 };
const ROE_RANGE = { min: -20, max: 40, step: 1 };
const PRICE_RANGE = { min: 0, max: 200000, step: 1000 };
const MARKET_CAP_BN_RANGE = { min: 0, max: 1200000, step: 5000 }; // billion VND
const NET_MARGIN_RANGE = { min: -30, max: 50, step: 1 };
const GROSS_MARGIN_RANGE = { min: -10, max: 80, step: 1 };
const REVENUE_GROWTH_RANGE = { min: -100, max: 300, step: 5 };
const NET_PROFIT_GROWTH_RANGE = { min: -100, max: 300, step: 5 };

function fmtNum(v: number | null | undefined, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: digits });
}

function fmtPct(v: number | null | undefined) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  return `${Number(v).toFixed(2)}%`;
}

type SliderRange = { min: number; max: number };

function RangeSlider({
  label,
  range,
  value,
  onChange,
  valueFormatter,
}: {
  label: string;
  range: { min: number; max: number; step: number };
  value: SliderRange;
  onChange: (v: SliderRange) => void;
  valueFormatter?: (n: number) => string;
}) {
  const fmt = valueFormatter || ((n: number) => String(n));
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
      <div className="flex items-center justify-between text-sm mb-2">
        <span className="font-medium">{label}</span>
        <span className="text-slate-600 dark:text-slate-400">
          {fmt(value.min)} - {fmt(value.max)}
        </span>
      </div>
      <div className="relative h-10">
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value.min}
          onChange={(e) => {
            const nextMin = Number(e.target.value);
            onChange({
              min: Math.min(nextMin, value.max),
              max: value.max,
            });
          }}
          className="range-slider"
        />
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value.max}
          onChange={(e) => {
            const nextMax = Number(e.target.value);
            onChange({
              min: value.min,
              max: Math.max(nextMax, value.min),
            });
          }}
          className="range-slider"
        />
      </div>
    </div>
  );
}

export default function ScreenerPage() {
  const [items, setItems] = useState<ScreenerItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<ScreenerSortKey>('market_cap');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [peRange, setPeRange] = useState<SliderRange>({
    min: PE_RANGE.min,
    max: PE_RANGE.max,
  });
  const [pbRange, setPbRange] = useState<SliderRange>({
    min: PB_RANGE.min,
    max: PB_RANGE.max,
  });
  const [roeRange, setRoeRange] = useState<SliderRange>({
    min: ROE_RANGE.min,
    max: ROE_RANGE.max,
  });
  const [priceRange, setPriceRange] = useState<SliderRange>({
    min: PRICE_RANGE.min,
    max: PRICE_RANGE.max,
  });
  const [marketCapBnRange, setMarketCapBnRange] = useState<SliderRange>({
    min: MARKET_CAP_BN_RANGE.min,
    max: MARKET_CAP_BN_RANGE.max,
  });
  const [netMarginRange, setNetMarginRange] = useState<SliderRange>({
    min: NET_MARGIN_RANGE.min,
    max: NET_MARGIN_RANGE.max,
  });
  const [grossMarginRange, setGrossMarginRange] = useState<SliderRange>({
    min: GROSS_MARGIN_RANGE.min,
    max: GROSS_MARGIN_RANGE.max,
  });
  const [revenueGrowthRange, setRevenueGrowthRange] = useState<SliderRange>({
    min: REVENUE_GROWTH_RANGE.min,
    max: REVENUE_GROWTH_RANGE.max,
  });
  const [netProfitGrowthRange, setNetProfitGrowthRange] = useState<SliderRange>({
    min: NET_PROFIT_GROWTH_RANGE.min,
    max: NET_PROFIT_GROWTH_RANGE.max,
  });
  const [debouncedFilters, setDebouncedFilters] = useState<ScreenerFilters>({});

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const liveFilters = useMemo<ScreenerFilters>(() => ({
    pe_min: peRange.min > PE_RANGE.min ? peRange.min : undefined,
    pe_max: peRange.max < PE_RANGE.max ? peRange.max : undefined,
    pb_min: pbRange.min > PB_RANGE.min ? pbRange.min : undefined,
    pb_max: pbRange.max < PB_RANGE.max ? pbRange.max : undefined,
    roe_min: roeRange.min > ROE_RANGE.min ? roeRange.min : undefined,
    roe_max: roeRange.max < ROE_RANGE.max ? roeRange.max : undefined,
    price_min: priceRange.min > PRICE_RANGE.min ? priceRange.min : undefined,
    price_max: priceRange.max < PRICE_RANGE.max ? priceRange.max : undefined,
    market_cap_min: marketCapBnRange.min > MARKET_CAP_BN_RANGE.min ? marketCapBnRange.min * 1_000_000_000 : undefined,
    market_cap_max: marketCapBnRange.max < MARKET_CAP_BN_RANGE.max ? marketCapBnRange.max * 1_000_000_000 : undefined,
    net_margin_min: netMarginRange.min > NET_MARGIN_RANGE.min ? netMarginRange.min : undefined,
    net_margin_max: netMarginRange.max < NET_MARGIN_RANGE.max ? netMarginRange.max : undefined,
    gross_margin_min: grossMarginRange.min > GROSS_MARGIN_RANGE.min ? grossMarginRange.min : undefined,
    gross_margin_max: grossMarginRange.max < GROSS_MARGIN_RANGE.max ? grossMarginRange.max : undefined,
    revenue_growth_min: revenueGrowthRange.min > REVENUE_GROWTH_RANGE.min ? revenueGrowthRange.min : undefined,
    revenue_growth_max: revenueGrowthRange.max < REVENUE_GROWTH_RANGE.max ? revenueGrowthRange.max : undefined,
    net_profit_growth_min: netProfitGrowthRange.min > NET_PROFIT_GROWTH_RANGE.min ? netProfitGrowthRange.min : undefined,
    net_profit_growth_max: netProfitGrowthRange.max < NET_PROFIT_GROWTH_RANGE.max ? netProfitGrowthRange.max : undefined,
  }), [
    peRange, pbRange, roeRange, priceRange, marketCapBnRange,
    netMarginRange, grossMarginRange, revenueGrowthRange, netProfitGrowthRange,
  ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setDebouncedFilters(liveFilters);
    }, 180);
    return () => clearTimeout(timer);
  }, [liveFilters]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchScreener({
        page,
        pageSize: PAGE_SIZE,
        sortBy,
        sortOrder,
        filters: debouncedFilters,
      });
      setItems(resp.items || []);
      setTotal(resp.total || 0);
    } catch (e: any) {
      setError(e?.message || 'Failed to load screener');
    } finally {
      setLoading(false);
    }
  }, [debouncedFilters, page, sortBy, sortOrder]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const resetFilters = () => {
    setPeRange({ min: PE_RANGE.min, max: PE_RANGE.max });
    setPbRange({ min: PB_RANGE.min, max: PB_RANGE.max });
    setRoeRange({ min: ROE_RANGE.min, max: ROE_RANGE.max });
    setPriceRange({ min: PRICE_RANGE.min, max: PRICE_RANGE.max });
    setMarketCapBnRange({ min: MARKET_CAP_BN_RANGE.min, max: MARKET_CAP_BN_RANGE.max });
    setNetMarginRange({ min: NET_MARGIN_RANGE.min, max: NET_MARGIN_RANGE.max });
    setGrossMarginRange({ min: GROSS_MARGIN_RANGE.min, max: GROSS_MARGIN_RANGE.max });
    setRevenueGrowthRange({ min: REVENUE_GROWTH_RANGE.min, max: REVENUE_GROWTH_RANGE.max });
    setNetProfitGrowthRange({ min: NET_PROFIT_GROWTH_RANGE.min, max: NET_PROFIT_GROWTH_RANGE.max });
    setPage(1);
    setDebouncedFilters({});
  };

  const summary = useMemo(() => {
    if (loading) return 'Loading...';
    if (error) return error;
    return `${total.toLocaleString('en-US')} stocks`;
  }, [loading, error, total]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="mx-auto max-w-[1500px] p-4 md:p-6 space-y-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold">Stock Screener</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
            Filter by valuation and financial metrics from VCI screening data.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 md:p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <RangeSlider label="P/E" range={PE_RANGE} value={peRange} onChange={setPeRange} />
            <RangeSlider label="P/B" range={PB_RANGE} value={pbRange} onChange={setPbRange} valueFormatter={(n) => n.toFixed(1)} />
            <RangeSlider label="ROE (%)" range={ROE_RANGE} value={roeRange} onChange={setRoeRange} />
            <RangeSlider label="Price (VND)" range={PRICE_RANGE} value={priceRange} onChange={setPriceRange} valueFormatter={(n) => n.toLocaleString('en-US')} />
            <RangeSlider
              label="Market Cap (Billion VND)"
              range={MARKET_CAP_BN_RANGE}
              value={marketCapBnRange}
              onChange={setMarketCapBnRange}
              valueFormatter={(n) => n.toLocaleString('en-US')}
            />
            <RangeSlider label="Net Margin (%)" range={NET_MARGIN_RANGE} value={netMarginRange} onChange={setNetMarginRange} />
            <RangeSlider label="Gross Margin (%)" range={GROSS_MARGIN_RANGE} value={grossMarginRange} onChange={setGrossMarginRange} />
            <RangeSlider label="Revenue Growth (%)" range={REVENUE_GROWTH_RANGE} value={revenueGrowthRange} onChange={setRevenueGrowthRange} />
            <RangeSlider label="Net Profit Growth (%)" range={NET_PROFIT_GROWTH_RANGE} value={netProfitGrowthRange} onChange={setNetProfitGrowthRange} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm" onClick={resetFilters}>Reset</button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
            <div className="text-sm text-slate-600 dark:text-slate-400">{summary}</div>
            <div className="flex gap-2">
              <select className="input" value={sortBy} onChange={(e) => setSortBy(e.target.value as ScreenerSortKey)}>
                {SORT_OPTIONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
              <select className="input" value={sortOrder} onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}>
                <option value="desc">Desc</option>
                <option value="asc">Asc</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2">Ticker</th>
                  <th className="py-2">Price</th>
                  <th className="py-2">MCap</th>
                  <th className="py-2">P/E</th>
                  <th className="py-2">P/B</th>
                  <th className="py-2">ROE</th>
                  <th className="py-2">Net Margin</th>
                  <th className="py-2">Rev Growth</th>
                  <th className="py-2">NP Growth</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.ticker} className="border-b border-slate-100 dark:border-slate-800/70">
                    <td className="py-2">
                      <Link href={`/stock/${row.ticker}`} className="font-semibold text-blue-600 hover:underline">
                        {row.ticker}
                      </Link>
                      <div className="text-xs text-slate-500">{row.exchange || '-'} · {row.sector || '-'}</div>
                    </td>
                    <td className="py-2">{fmtNum(row.marketPrice)}</td>
                    <td className="py-2">{fmtNum(row.marketCap, 0)}</td>
                    <td className="py-2">{fmtNum(row.ttmPe)}</td>
                    <td className="py-2">{fmtNum(row.ttmPb)}</td>
                    <td className="py-2">{fmtPct(row.ttmRoe)}</td>
                    <td className="py-2">{fmtPct(row.netMargin)}</td>
                    <td className="py-2">{fmtPct(row.revenueGrowthYoy)}</td>
                    <td className="py-2">{fmtPct(row.npatmiGrowthYoyQm1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && items.length === 0 && (
              <div className="py-8 text-center text-sm text-slate-500">No results</div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <button
              className="rounded border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              Prev
            </button>
            <div className="text-sm text-slate-600 dark:text-slate-400">
              Page {page} / {totalPages}
            </div>
            <button
              className="rounded border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm disabled:opacity-50"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        .input {
          border: 1px solid rgb(203 213 225);
          background: white;
          color: rgb(15 23 42);
          border-radius: 0.6rem;
          padding: 0.45rem 0.6rem;
          font-size: 0.875rem;
          min-width: 0;
        }
        .range-slider {
          position: absolute;
          left: 0;
          top: 0.35rem;
          width: 100%;
          pointer-events: none;
          appearance: none;
          background: transparent;
        }
        .range-slider::-webkit-slider-thumb {
          appearance: none;
          height: 16px;
          width: 16px;
          border-radius: 9999px;
          background: rgb(37 99 235);
          border: 2px solid white;
          box-shadow: 0 0 0 1px rgb(148 163 184);
          pointer-events: auto;
          cursor: pointer;
        }
        .range-slider::-moz-range-thumb {
          height: 16px;
          width: 16px;
          border-radius: 9999px;
          background: rgb(37 99 235);
          border: 2px solid white;
          box-shadow: 0 0 0 1px rgb(148 163 184);
          pointer-events: auto;
          cursor: pointer;
        }
        .range-slider::-webkit-slider-runnable-track {
          height: 6px;
          border-radius: 9999px;
          background: rgb(226 232 240);
        }
        .range-slider::-moz-range-track {
          height: 6px;
          border-radius: 9999px;
          background: rgb(226 232 240);
        }
        @media (prefers-color-scheme: dark) {
          .input {
            border-color: rgb(51 65 85);
            background: rgb(15 23 42);
            color: rgb(241 245 249);
          }
          .range-slider::-webkit-slider-runnable-track {
            background: rgb(51 65 85);
          }
          .range-slider::-moz-range-track {
            background: rgb(51 65 85);
          }
        }
      `}</style>
    </div>
  );
}
