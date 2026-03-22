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
  { label: 'Upside %', value: 'upside_pct' },
  { label: 'P/E', value: 'pe' },
  { label: 'P/B', value: 'pb' },
  { label: 'ROE', value: 'roe' },
  { label: 'Price', value: 'price' },
  { label: 'Daily Change', value: 'daily_change' },
  { label: 'Revenue Growth', value: 'revenue_growth' },
  { label: 'Net Profit Growth', value: 'net_profit_growth' },
];

const PE_RANGE             = { min: 0,    max: 60,      step: 1    };
const PB_RANGE             = { min: 0,    max: 10,      step: 0.1  };
const ROE_RANGE            = { min: -20,  max: 40,      step: 1    };
const PRICE_RANGE          = { min: 0,    max: 200000,  step: 1000 };
const MARKET_CAP_BN_RANGE  = { min: 0,    max: 1200000, step: 5000 };
const NET_MARGIN_RANGE     = { min: -30,  max: 50,      step: 1    };
const GROSS_MARGIN_RANGE   = { min: -10,  max: 80,      step: 1    };
const REVENUE_GROWTH_RANGE = { min: -100, max: 300,     step: 5    };
const NET_PROFIT_GROWTH_RANGE = { min: -100, max: 300,  step: 5    };
const UPSIDE_PCT_RANGE     = { min: -100, max: 300,     step: 5    };

function fmtNum(v: number | null | undefined, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: digits });
}

function fmtPct(v: number | null | undefined) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  return `${Number(v).toFixed(1)}%`;
}

function fmtMCap(v: number | null | undefined) {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return '-';
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9)  return `${(v / 1e9).toFixed(0)}B`;
  if (v >= 1e6)  return `${(v / 1e6).toFixed(0)}M`;
  return fmtNum(v, 0);
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
  const isActive = value.min > range.min || value.max < range.max;
  return (
    <div className={`rounded-xl border p-3 ${isActive ? 'border-blue-400 dark:border-blue-600 bg-blue-50/60 dark:bg-blue-950/30' : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`font-semibold text-sm ${isActive ? 'text-blue-700 dark:text-blue-300' : ''}`}>{label}</span>
        <span className="text-xs text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-md px-2 py-0.5 border border-slate-200 dark:border-slate-700 tabular-nums">
          {fmt(value.min)} – {fmt(value.max)}
        </span>
      </div>
      <div className="space-y-2">
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-xs text-slate-400">Min</span>
            <span className="text-xs text-slate-500 tabular-nums">{fmt(value.min)}</span>
          </div>
          <input
            type="range" min={range.min} max={range.max} step={range.step} value={value.min}
            onChange={(e) => { const n = Number(e.target.value); onChange({ min: Math.min(n, value.max), max: value.max }); }}
            className="single-slider"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-xs text-slate-400">Max</span>
            <span className="text-xs text-slate-500 tabular-nums">{fmt(value.max)}</span>
          </div>
          <input
            type="range" min={range.min} max={range.max} step={range.step} value={value.max}
            onChange={(e) => { const n = Number(e.target.value); onChange({ min: value.min, max: Math.max(n, value.min) }); }}
            className="single-slider"
          />
        </div>
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
  const [hasValuationData, setHasValuationData] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortBy, setSortBy] = useState<ScreenerSortKey>('market_cap');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const [peRange, setPeRange]         = useState<SliderRange>({ min: PE_RANGE.min,             max: PE_RANGE.max             });
  const [pbRange, setPbRange]         = useState<SliderRange>({ min: PB_RANGE.min,             max: PB_RANGE.max             });
  const [roeRange, setRoeRange]       = useState<SliderRange>({ min: ROE_RANGE.min,            max: ROE_RANGE.max            });
  const [priceRange, setPriceRange]   = useState<SliderRange>({ min: PRICE_RANGE.min,          max: PRICE_RANGE.max          });
  const [marketCapBnRange, setMarketCapBnRange] = useState<SliderRange>({ min: MARKET_CAP_BN_RANGE.min, max: MARKET_CAP_BN_RANGE.max });
  const [netMarginRange, setNetMarginRange]     = useState<SliderRange>({ min: NET_MARGIN_RANGE.min,    max: NET_MARGIN_RANGE.max    });
  const [grossMarginRange, setGrossMarginRange] = useState<SliderRange>({ min: GROSS_MARGIN_RANGE.min,  max: GROSS_MARGIN_RANGE.max  });
  const [revenueGrowthRange, setRevenueGrowthRange]     = useState<SliderRange>({ min: REVENUE_GROWTH_RANGE.min,     max: REVENUE_GROWTH_RANGE.max     });
  const [netProfitGrowthRange, setNetProfitGrowthRange] = useState<SliderRange>({ min: NET_PROFIT_GROWTH_RANGE.min,  max: NET_PROFIT_GROWTH_RANGE.max  });
  const [upsidePctRange, setUpsidePctRange]     = useState<SliderRange>({ min: UPSIDE_PCT_RANGE.min,   max: UPSIDE_PCT_RANGE.max   });
  const [debouncedFilters, setDebouncedFilters] = useState<ScreenerFilters>({});

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const liveFilters = useMemo<ScreenerFilters>(() => ({
    pe_min:              peRange.min > PE_RANGE.min             ? peRange.min             : undefined,
    pe_max:              peRange.max < PE_RANGE.max             ? peRange.max             : undefined,
    pb_min:              pbRange.min > PB_RANGE.min             ? pbRange.min             : undefined,
    pb_max:              pbRange.max < PB_RANGE.max             ? pbRange.max             : undefined,
    roe_min:             roeRange.min > ROE_RANGE.min           ? roeRange.min            : undefined,
    roe_max:             roeRange.max < ROE_RANGE.max           ? roeRange.max            : undefined,
    price_min:           priceRange.min > PRICE_RANGE.min       ? priceRange.min          : undefined,
    price_max:           priceRange.max < PRICE_RANGE.max       ? priceRange.max          : undefined,
    market_cap_min:      marketCapBnRange.min > MARKET_CAP_BN_RANGE.min ? marketCapBnRange.min * 1_000_000_000 : undefined,
    market_cap_max:      marketCapBnRange.max < MARKET_CAP_BN_RANGE.max ? marketCapBnRange.max * 1_000_000_000 : undefined,
    net_margin_min:      netMarginRange.min > NET_MARGIN_RANGE.min     ? netMarginRange.min     : undefined,
    net_margin_max:      netMarginRange.max < NET_MARGIN_RANGE.max     ? netMarginRange.max     : undefined,
    gross_margin_min:    grossMarginRange.min > GROSS_MARGIN_RANGE.min ? grossMarginRange.min   : undefined,
    gross_margin_max:    grossMarginRange.max < GROSS_MARGIN_RANGE.max ? grossMarginRange.max   : undefined,
    revenue_growth_min:  revenueGrowthRange.min > REVENUE_GROWTH_RANGE.min     ? revenueGrowthRange.min     : undefined,
    revenue_growth_max:  revenueGrowthRange.max < REVENUE_GROWTH_RANGE.max     ? revenueGrowthRange.max     : undefined,
    net_profit_growth_min: netProfitGrowthRange.min > NET_PROFIT_GROWTH_RANGE.min ? netProfitGrowthRange.min : undefined,
    net_profit_growth_max: netProfitGrowthRange.max < NET_PROFIT_GROWTH_RANGE.max ? netProfitGrowthRange.max : undefined,
    upside_pct_min:      upsidePctRange.min > UPSIDE_PCT_RANGE.min ? upsidePctRange.min : undefined,
    upside_pct_max:      upsidePctRange.max < UPSIDE_PCT_RANGE.max ? upsidePctRange.max : undefined,
  }), [peRange, pbRange, roeRange, priceRange, marketCapBnRange, netMarginRange, grossMarginRange, revenueGrowthRange, netProfitGrowthRange, upsidePctRange]);

  const activeFilterCount = useMemo(
    () => Object.values(liveFilters).filter((v) => v !== undefined).length,
    [liveFilters],
  );

  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); setDebouncedFilters(liveFilters); }, 180);
    return () => clearTimeout(timer);
  }, [liveFilters]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchScreener({ page, pageSize: PAGE_SIZE, sortBy, sortOrder, filters: debouncedFilters });
      setItems(resp.items || []);
      setTotal(resp.total || 0);
      setHasValuationData(!!resp.hasValuationData);
    } catch (e: any) {
      setError(e?.message || 'Failed to load screener');
    } finally {
      setLoading(false);
    }
  }, [debouncedFilters, page, sortBy, sortOrder]);

  useEffect(() => { loadData(); }, [loadData]);

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
    setUpsidePctRange({ min: UPSIDE_PCT_RANGE.min, max: UPSIDE_PCT_RANGE.max });
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
      <div className="mx-auto max-w-[1500px] p-3 md:p-6 space-y-3">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-4xl font-bold">Stock Screener</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 hidden md:block">
              Filter by valuation and financial metrics from VCI screening data.
            </p>
          </div>
          {/* Mobile filter toggle */}
          <button
            onClick={() => setFiltersOpen((o) => !o)}
            className="flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-medium md:hidden"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 12h10M11 20h2" />
            </svg>
            Filters
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-blue-600 text-white text-xs px-1.5 py-0.5 leading-none">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Filter panel — always visible on md+, toggle on mobile */}
        <div className={`rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 md:p-5 ${filtersOpen ? 'block' : 'hidden md:block'}`}>
          <div className="hidden md:flex items-center justify-between mb-3">
            <span className="font-semibold text-sm text-slate-700 dark:text-slate-300">Filters</span>
            {activeFilterCount > 0 && (
              <button onClick={resetFilters} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                Reset {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 md:gap-3">
            <RangeSlider label="P/E" range={PE_RANGE} value={peRange} onChange={setPeRange} />
            <RangeSlider label="P/B" range={PB_RANGE} value={pbRange} onChange={setPbRange} valueFormatter={(n) => n.toFixed(1)} />
            <RangeSlider label="ROE (%)" range={ROE_RANGE} value={roeRange} onChange={setRoeRange} valueFormatter={(n) => `${n}%`} />
            <RangeSlider label="Price (VND)" range={PRICE_RANGE} value={priceRange} onChange={setPriceRange} valueFormatter={(n) => n >= 1000 ? `${(n/1000).toFixed(0)}k` : String(n)} />
            <RangeSlider label="MCap (B VND)" range={MARKET_CAP_BN_RANGE} value={marketCapBnRange} onChange={setMarketCapBnRange} valueFormatter={(n) => n >= 1000 ? `${(n/1000).toFixed(0)}T` : `${n}B`} />
            {hasValuationData && (
              <RangeSlider label="Upside (%)" range={UPSIDE_PCT_RANGE} value={upsidePctRange} onChange={setUpsidePctRange} valueFormatter={(n) => `${n > 0 ? '+' : ''}${n}%`} />
            )}
            <RangeSlider label="Net Margin (%)" range={NET_MARGIN_RANGE} value={netMarginRange} onChange={setNetMarginRange} valueFormatter={(n) => `${n}%`} />
            <RangeSlider label="Gross Margin (%)" range={GROSS_MARGIN_RANGE} value={grossMarginRange} onChange={setGrossMarginRange} valueFormatter={(n) => `${n}%`} />
            <RangeSlider label="Rev Growth (%)" range={REVENUE_GROWTH_RANGE} value={revenueGrowthRange} onChange={setRevenueGrowthRange} valueFormatter={(n) => `${n}%`} />
            <RangeSlider label="NP Growth (%)" range={NET_PROFIT_GROWTH_RANGE} value={netProfitGrowthRange} onChange={setNetProfitGrowthRange} valueFormatter={(n) => `${n}%`} />
          </div>
          {/* Mobile footer */}
          <div className="mt-3 flex gap-2 md:hidden">
            {activeFilterCount > 0 && (
              <button onClick={resetFilters} className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm">
                Reset ({activeFilterCount})
              </button>
            )}
            <button onClick={() => setFiltersOpen(false)} className="rounded-lg bg-blue-600 text-white px-4 py-1.5 text-sm font-medium ml-auto">
              Done
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 md:p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="text-sm text-slate-500 dark:text-slate-400 tabular-nums">{summary}</div>
            <div className="flex gap-2">
              <select className="input" value={sortBy} onChange={(e) => setSortBy(e.target.value as ScreenerSortKey)}>
                {SORT_OPTIONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
              <select className="input" value={sortOrder} onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}>
                <option value="desc">↓</option>
                <option value="asc">↑</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto -mx-3 md:mx-0">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="text-left border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                  <th className="py-2 pl-3 md:pl-0 pr-2 font-medium">Ticker</th>
                  <th className="py-2 px-2 font-medium text-right">Price</th>
                  {hasValuationData && <th className="py-2 px-2 font-medium text-right">Intrinsic</th>}
                  {hasValuationData && <th className="py-2 px-2 font-medium text-right">Upside</th>}
                  <th className="py-2 px-2 font-medium text-right hidden sm:table-cell">MCap</th>
                  <th className="py-2 px-2 font-medium text-right">P/E</th>
                  <th className="py-2 px-2 font-medium text-right hidden sm:table-cell">P/B</th>
                  <th className="py-2 px-2 font-medium text-right">ROE</th>
                  <th className="py-2 px-2 font-medium text-right hidden md:table-cell">Net Mgn</th>
                  <th className="py-2 px-2 font-medium text-right hidden md:table-cell">Rev Grw</th>
                  <th className="py-2 px-2 font-medium text-right hidden md:table-cell">NP Grw</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const upside = row.upsidePct;
                  const upsideColor =
                    upside === null ? '' :
                    upside >= 20  ? 'text-emerald-600 dark:text-emerald-400 font-semibold' :
                    upside >= 0   ? 'text-emerald-500 dark:text-emerald-500' :
                    upside >= -20 ? 'text-amber-600 dark:text-amber-400' :
                                    'text-red-500 dark:text-red-400';
                  return (
                    <tr key={row.ticker} className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 pl-3 md:pl-0 pr-2">
                        <Link href={`/stock/${row.ticker}`} className="font-semibold text-blue-600 dark:text-blue-400 hover:underline">
                          {row.ticker}
                        </Link>
                        <div className="text-xs text-slate-400 truncate max-w-[90px] sm:max-w-none">
                          {row.exchange || '-'} · {row.sector || '-'}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtNum(row.marketPrice, 0)}</td>
                      {hasValuationData && (
                        <td className="py-2 px-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
                          {row.intrinsicValue != null ? fmtNum(row.intrinsicValue, 0) : '—'}
                          {row.qualityGrade && row.intrinsicValue != null && (
                            <span className="ml-0.5 text-xs text-slate-400">({row.qualityGrade})</span>
                          )}
                        </td>
                      )}
                      {hasValuationData && (
                        <td className={`py-2 px-2 text-right tabular-nums ${upsideColor}`}>
                          {upside != null ? `${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%` : '—'}
                        </td>
                      )}
                      <td className="py-2 px-2 text-right tabular-nums hidden sm:table-cell">{fmtMCap(row.marketCap)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtNum(row.ttmPe, 1)}</td>
                      <td className="py-2 px-2 text-right tabular-nums hidden sm:table-cell">{fmtNum(row.ttmPb, 1)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtPct(row.ttmRoe)}</td>
                      <td className="py-2 px-2 text-right tabular-nums hidden md:table-cell">{fmtPct(row.netMargin)}</td>
                      <td className="py-2 px-2 text-right tabular-nums hidden md:table-cell">{fmtPct(row.revenueGrowthYoy)}</td>
                      <td className="py-2 px-2 text-right tabular-nums hidden md:table-cell">{fmtPct(row.npatmiGrowthYoyQm1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && items.length === 0 && (
              <div className="py-10 text-center text-sm text-slate-400">No results</div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <button
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm disabled:opacity-40"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >← Prev</button>
            <div className="text-sm text-slate-500 tabular-nums">{page} / {totalPages}</div>
            <button
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm disabled:opacity-40"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
            >Next →</button>
          </div>
        </div>
      </div>

      <style jsx>{`
        .input {
          border: 1px solid rgb(203 213 225);
          background: white;
          color: rgb(15 23 42);
          border-radius: 0.5rem;
          padding: 0.35rem 0.5rem;
          font-size: 0.8rem;
          min-width: 0;
        }
        .single-slider {
          width: 100%;
          appearance: none;
          background: transparent;
        }
        .single-slider::-webkit-slider-thumb {
          appearance: none;
          height: 14px;
          width: 14px;
          margin-top: -4px;
          border-radius: 9999px;
          background: rgb(37 99 235);
          border: 2px solid white;
          box-shadow: 0 0 0 1px rgb(148 163 184);
          cursor: pointer;
        }
        .single-slider::-moz-range-thumb {
          height: 14px;
          width: 14px;
          border-radius: 9999px;
          background: rgb(37 99 235);
          border: 2px solid white;
          box-shadow: 0 0 0 1px rgb(148 163 184);
          cursor: pointer;
        }
        .single-slider::-webkit-slider-runnable-track {
          height: 5px;
          border-radius: 9999px;
          background: rgb(226 232 240);
        }
        .single-slider::-moz-range-track {
          height: 5px;
          border-radius: 9999px;
          background: rgb(226 232 240);
        }
        @media (prefers-color-scheme: dark) {
          .input {
            border-color: rgb(51 65 85);
            background: rgb(15 23 42);
            color: rgb(241 245 249);
          }
          .single-slider::-webkit-slider-runnable-track {
            background: rgb(51 65 85);
          }
          .single-slider::-moz-range-track {
            background: rgb(51 65 85);
          }
        }
      `}</style>
    </div>
  );
}
