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
const PE_RANGE = { min: 0, max: 60 };

function fmtNum(v: number | null | undefined, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: digits });
}

function fmtPct(v: number | null | undefined) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  return `${Number(v).toFixed(2)}%`;
}

function toNumberOrUndef(v: string): number | undefined {
  if (!v.trim()) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export default function ScreenerPage() {
  const [items, setItems] = useState<ScreenerItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<ScreenerSortKey>('market_cap');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [peRange, setPeRange] = useState<{ min: number; max: number }>({
    min: PE_RANGE.min,
    max: PE_RANGE.max,
  });
  const [form, setForm] = useState({
    q: '',
    exchange: '',
    sector: '',
    pbMax: '',
    roeMin: '',
    priceMin: '',
    priceMax: '',
    marketCapMin: '',
    netMarginMin: '',
    grossMarginMin: '',
    revenueGrowthMin: '',
    netProfitGrowthMin: '',
  });
  const [appliedFilters, setAppliedFilters] = useState<ScreenerFilters>({});

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchScreener({
        page,
        pageSize: PAGE_SIZE,
        sortBy,
        sortOrder,
        filters: appliedFilters,
      });
      setItems(resp.items || []);
      setTotal(resp.total || 0);
    } catch (e: any) {
      setError(e?.message || 'Failed to load screener');
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, page, sortBy, sortOrder]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const applyFilters = () => {
    const next: ScreenerFilters = {
      q: form.q || undefined,
      exchange: form.exchange || undefined,
      sector: form.sector || undefined,
      pe_min: peRange.min > PE_RANGE.min ? peRange.min : undefined,
      pe_max: peRange.max < PE_RANGE.max ? peRange.max : undefined,
      pb_max: toNumberOrUndef(form.pbMax),
      roe_min: toNumberOrUndef(form.roeMin),
      price_min: toNumberOrUndef(form.priceMin),
      price_max: toNumberOrUndef(form.priceMax),
      market_cap_min: toNumberOrUndef(form.marketCapMin),
      net_margin_min: toNumberOrUndef(form.netMarginMin),
      gross_margin_min: toNumberOrUndef(form.grossMarginMin),
      revenue_growth_min: toNumberOrUndef(form.revenueGrowthMin),
      net_profit_growth_min: toNumberOrUndef(form.netProfitGrowthMin),
    };
    setPage(1);
    setAppliedFilters(next);
  };

  const resetFilters = () => {
    setForm({
      q: '',
      exchange: '',
      sector: '',
      pbMax: '',
      roeMin: '',
      priceMin: '',
      priceMax: '',
      marketCapMin: '',
      netMarginMin: '',
      grossMarginMin: '',
      revenueGrowthMin: '',
      netProfitGrowthMin: '',
    });
    setPeRange({ min: PE_RANGE.min, max: PE_RANGE.max });
    setPage(1);
    setAppliedFilters({});
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
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            <input className="input" placeholder="Ticker / Name" value={form.q} onChange={(e) => setForm((p) => ({ ...p, q: e.target.value }))} />
            <select className="input" value={form.exchange} onChange={(e) => setForm((p) => ({ ...p, exchange: e.target.value }))}>
              <option value="">All Exchange</option>
              {EXCHANGES.map((ex) => <option key={ex} value={ex}>{ex}</option>)}
            </select>
            <input className="input" placeholder="Sector" value={form.sector} onChange={(e) => setForm((p) => ({ ...p, sector: e.target.value }))} />
            <input className="input" placeholder="PB max" value={form.pbMax} onChange={(e) => setForm((p) => ({ ...p, pbMax: e.target.value }))} />
            <input className="input" placeholder="ROE min (%)" value={form.roeMin} onChange={(e) => setForm((p) => ({ ...p, roeMin: e.target.value }))} />
            <input className="input" placeholder="Price min" value={form.priceMin} onChange={(e) => setForm((p) => ({ ...p, priceMin: e.target.value }))} />
            <input className="input" placeholder="Price max" value={form.priceMax} onChange={(e) => setForm((p) => ({ ...p, priceMax: e.target.value }))} />
            <input className="input" placeholder="Market cap min" value={form.marketCapMin} onChange={(e) => setForm((p) => ({ ...p, marketCapMin: e.target.value }))} />
            <input className="input" placeholder="Net margin min (%)" value={form.netMarginMin} onChange={(e) => setForm((p) => ({ ...p, netMarginMin: e.target.value }))} />
            <input className="input" placeholder="Gross margin min (%)" value={form.grossMarginMin} onChange={(e) => setForm((p) => ({ ...p, grossMarginMin: e.target.value }))} />
            <input className="input" placeholder="Revenue growth min (%)" value={form.revenueGrowthMin} onChange={(e) => setForm((p) => ({ ...p, revenueGrowthMin: e.target.value }))} />
            <input className="input" placeholder="Net profit growth min (%)" value={form.netProfitGrowthMin} onChange={(e) => setForm((p) => ({ ...p, netProfitGrowthMin: e.target.value }))} />
          </div>
          <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="font-medium">P/E Range</span>
              <span className="text-slate-600 dark:text-slate-400">
                {peRange.min} - {peRange.max}
              </span>
            </div>
            <div className="relative h-10">
              <input
                type="range"
                min={PE_RANGE.min}
                max={PE_RANGE.max}
                step={1}
                value={peRange.min}
                onChange={(e) => {
                  const nextMin = Number(e.target.value);
                  setPeRange((prev) => ({
                    min: Math.min(nextMin, prev.max),
                    max: prev.max,
                  }));
                }}
                className="range-slider"
              />
              <input
                type="range"
                min={PE_RANGE.min}
                max={PE_RANGE.max}
                step={1}
                value={peRange.max}
                onChange={(e) => {
                  const nextMax = Number(e.target.value);
                  setPeRange((prev) => ({
                    min: prev.min,
                    max: Math.max(nextMax, prev.min),
                  }));
                }}
                className="range-slider"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-medium" onClick={applyFilters}>Apply</button>
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
