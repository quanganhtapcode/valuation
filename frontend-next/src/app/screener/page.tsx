'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  fetchScreener,
  fetchScreenerIcbSectors,
  IcbSector,
  ScreenerFilters,
  ScreenerItem,
  ScreenerSortKey,
} from '@/lib/api';

const PAGE_SIZE = 50;

const SORT_OPTIONS: Array<{ label: string; value: ScreenerSortKey }> = [
  { label: 'Market Cap', value: 'market_cap' },
  { label: 'Upside %',   value: 'upside_pct' },
  { label: 'P/E',        value: 'pe' },
  { label: 'P/B',        value: 'pb' },
  { label: 'ROE',        value: 'roe' },
  { label: 'Price',      value: 'price' },
  { label: 'Daily Chg',  value: 'daily_change' },
  { label: 'Rev Growth', value: 'revenue_growth' },
  { label: 'NP Growth',  value: 'net_profit_growth' },
];

const PE_RANGE             = { min: 0,    max: 60,      step: 1   };
const PB_RANGE             = { min: 0,    max: 10,      step: 0.1 };
const ROE_RANGE            = { min: -20,  max: 40,      step: 1   };
const PRICE_RANGE          = { min: 0,    max: 200000,  step: 1000 };
const MARKET_CAP_BN_RANGE  = { min: 0,    max: 1200000, step: 5000 };
const NET_MARGIN_RANGE     = { min: -30,  max: 50,      step: 1   };
const GROSS_MARGIN_RANGE   = { min: -10,  max: 80,      step: 1   };
const REVENUE_GROWTH_RANGE    = { min: -100, max: 300, step: 5 };
const NET_PROFIT_GROWTH_RANGE = { min: -100, max: 300, step: 5 };
const UPSIDE_PCT_RANGE     = { min: -100, max: 300,     step: 5   };

type SliderRange = { min: number; max: number };
type FilterTab = 'valuation' | 'quality' | 'growth';

function fmtNum(v: number | null | undefined, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: digits });
}
function fmtPct(v: number | null | undefined) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '-';
  return `${Number(v).toFixed(1)}%`;
}
function fmtMCap(v: number | null | undefined) {
  if (!v || !Number.isFinite(v)) return '-';
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9)  return `${(v / 1e9).toFixed(0)}B`;
  if (v >= 1e6)  return `${(v / 1e6).toFixed(0)}M`;
  return fmtNum(v, 0);
}

function isActive(value: SliderRange, range: { min: number; max: number }) {
  return value.min > range.min || value.max < range.max;
}

function RangeSlider({
  label, range, value, onChange, valueFormatter,
}: {
  label: string;
  range: { min: number; max: number; step: number };
  value: SliderRange;
  onChange: (v: SliderRange) => void;
  valueFormatter?: (n: number) => string;
}) {
  const fmt = valueFormatter ?? String;
  const active = isActive(value, range);
  return (
    <div className={`rounded-xl border p-3 transition-colors ${active ? 'border-blue-400 dark:border-blue-600 bg-blue-50/50 dark:bg-blue-950/25' : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60'}`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`font-semibold text-sm ${active ? 'text-blue-700 dark:text-blue-300' : ''}`}>{label}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded px-2 py-0.5 border border-slate-200 dark:border-slate-700 tabular-nums">
          {fmt(value.min)} – {fmt(value.max)}
        </span>
      </div>
      <div className="space-y-2">
        {(['min', 'max'] as const).map((side) => (
          <div key={side}>
            <div className="flex justify-between mb-0.5">
              <span className="text-xs text-slate-400 capitalize">{side}</span>
              <span className="text-xs text-slate-500 tabular-nums">{fmt(value[side])}</span>
            </div>
            <input
              type="range" min={range.min} max={range.max} step={range.step} value={value[side]}
              onChange={(e) => {
                const n = Number(e.target.value);
                onChange(side === 'min'
                  ? { min: Math.min(n, value.max), max: value.max }
                  : { min: value.min, max: Math.max(n, value.min) });
              }}
              className="single-slider"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ScreenerPage() {
  const [items, setItems]                     = useState<ScreenerItem[]>([]);
  const [total, setTotal]                     = useState(0);
  const [page, setPage]                       = useState(1);
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState<string | null>(null);
  const [hasValuationData, setHasValuationData] = useState(false);
  const [activeTab, setActiveTab]             = useState<FilterTab>('valuation');
  const [filtersOpen, setFiltersOpen]         = useState(false);
  const [exchanges, setExchanges]             = useState<Set<string>>(new Set(['HSX', 'HNX', 'UPCOM']));
  const [sortBy, setSortBy]                   = useState<ScreenerSortKey>('market_cap');
  const [sortOrder, setSortOrder]             = useState<'asc' | 'desc'>('desc');
  const [selectedSector, setSelectedSector]   = useState('');
  const [icbSectors, setIcbSectors]           = useState<IcbSector[]>([]);

  // Valuation tab
  const [peRange, setPeRange]         = useState<SliderRange>({ min: PE_RANGE.min,            max: PE_RANGE.max            });
  const [pbRange, setPbRange]         = useState<SliderRange>({ min: PB_RANGE.min,            max: PB_RANGE.max            });
  const [priceRange, setPriceRange]   = useState<SliderRange>({ min: PRICE_RANGE.min,         max: PRICE_RANGE.max         });
  const [mcapRange, setMcapRange]     = useState<SliderRange>({ min: MARKET_CAP_BN_RANGE.min, max: MARKET_CAP_BN_RANGE.max });
  const [upsideRange, setUpsideRange] = useState<SliderRange>({ min: UPSIDE_PCT_RANGE.min,    max: UPSIDE_PCT_RANGE.max    });
  // Quality tab
  const [roeRange, setRoeRange]             = useState<SliderRange>({ min: ROE_RANGE.min,         max: ROE_RANGE.max         });
  const [netMarginRange, setNetMarginRange] = useState<SliderRange>({ min: NET_MARGIN_RANGE.min,  max: NET_MARGIN_RANGE.max  });
  const [grossMarginRange, setGrossMarginRange] = useState<SliderRange>({ min: GROSS_MARGIN_RANGE.min, max: GROSS_MARGIN_RANGE.max });
  // Growth tab
  const [revGrowthRange, setRevGrowthRange]   = useState<SliderRange>({ min: REVENUE_GROWTH_RANGE.min,    max: REVENUE_GROWTH_RANGE.max    });
  const [npGrowthRange, setNpGrowthRange]     = useState<SliderRange>({ min: NET_PROFIT_GROWTH_RANGE.min, max: NET_PROFIT_GROWTH_RANGE.max });

  const [debouncedFilters, setDebouncedFilters] = useState<ScreenerFilters>({});
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const liveFilters = useMemo<ScreenerFilters>(() => ({
    pe_min:               peRange.min > PE_RANGE.min             ? peRange.min             : undefined,
    pe_max:               peRange.max < PE_RANGE.max             ? peRange.max             : undefined,
    pb_min:               pbRange.min > PB_RANGE.min             ? pbRange.min             : undefined,
    pb_max:               pbRange.max < PB_RANGE.max             ? pbRange.max             : undefined,
    price_min:            priceRange.min > PRICE_RANGE.min       ? priceRange.min          : undefined,
    price_max:            priceRange.max < PRICE_RANGE.max       ? priceRange.max          : undefined,
    market_cap_min:       mcapRange.min > MARKET_CAP_BN_RANGE.min ? mcapRange.min * 1e9    : undefined,
    market_cap_max:       mcapRange.max < MARKET_CAP_BN_RANGE.max ? mcapRange.max * 1e9    : undefined,
    upside_pct_min:       upsideRange.min > UPSIDE_PCT_RANGE.min ? upsideRange.min         : undefined,
    upside_pct_max:       upsideRange.max < UPSIDE_PCT_RANGE.max ? upsideRange.max         : undefined,
    exchange:             exchanges.size < 3 ? [...exchanges].join(',') : undefined,
    sector:               selectedSector || undefined,
    roe_min:              roeRange.min > ROE_RANGE.min           ? roeRange.min            : undefined,
    roe_max:              roeRange.max < ROE_RANGE.max           ? roeRange.max            : undefined,
    net_margin_min:       netMarginRange.min > NET_MARGIN_RANGE.min   ? netMarginRange.min   : undefined,
    net_margin_max:       netMarginRange.max < NET_MARGIN_RANGE.max   ? netMarginRange.max   : undefined,
    gross_margin_min:     grossMarginRange.min > GROSS_MARGIN_RANGE.min ? grossMarginRange.min : undefined,
    gross_margin_max:     grossMarginRange.max < GROSS_MARGIN_RANGE.max ? grossMarginRange.max : undefined,
    revenue_growth_min:   revGrowthRange.min > REVENUE_GROWTH_RANGE.min    ? revGrowthRange.min    : undefined,
    revenue_growth_max:   revGrowthRange.max < REVENUE_GROWTH_RANGE.max    ? revGrowthRange.max    : undefined,
    net_profit_growth_min: npGrowthRange.min > NET_PROFIT_GROWTH_RANGE.min ? npGrowthRange.min     : undefined,
    net_profit_growth_max: npGrowthRange.max < NET_PROFIT_GROWTH_RANGE.max ? npGrowthRange.max     : undefined,
  }), [peRange, pbRange, priceRange, mcapRange, upsideRange, roeRange, netMarginRange, grossMarginRange, revGrowthRange, npGrowthRange, exchanges, selectedSector]);

  // Per-tab active counts for badges
  const tabCounts = useMemo(() => ({
    valuation: [
      peRange, pbRange, priceRange, mcapRange,
      ...(hasValuationData ? [upsideRange] : []),
    ].filter((r, i) => {
      const ranges = [PE_RANGE, PB_RANGE, PRICE_RANGE, MARKET_CAP_BN_RANGE, UPSIDE_PCT_RANGE];
      return isActive(r, ranges[i]);
    }).length,
    quality: [roeRange, netMarginRange, grossMarginRange].filter((r, i) =>
      isActive(r, [ROE_RANGE, NET_MARGIN_RANGE, GROSS_MARGIN_RANGE][i])
    ).length,
    growth: [revGrowthRange, npGrowthRange].filter((r, i) =>
      isActive(r, [REVENUE_GROWTH_RANGE, NET_PROFIT_GROWTH_RANGE][i])
    ).length,
  }), [peRange, pbRange, priceRange, mcapRange, upsideRange, roeRange, netMarginRange, grossMarginRange, revGrowthRange, npGrowthRange, hasValuationData]);

  const totalActiveFilters = tabCounts.valuation + tabCounts.quality + tabCounts.growth + (selectedSector ? 1 : 0);

  // Load ICB sectors from VCI company DB
  useEffect(() => {
    fetchScreenerIcbSectors()
      .then(setIcbSectors)
      .catch(() => {/* ignore */});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setDebouncedFilters(liveFilters); }, 180);
    return () => clearTimeout(t);
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

  const toggleExchange = (ex: string) => {
    setExchanges((prev) => {
      const next = new Set(prev);
      if (next.has(ex) && next.size > 1) next.delete(ex);
      else next.add(ex);
      return next;
    });
    setPage(1);
  };

  const resetAll = () => {
    setExchanges(new Set(['HSX', 'HNX', 'UPCOM']));
    setSelectedSector('');
    setPeRange({ min: PE_RANGE.min, max: PE_RANGE.max });
    setPbRange({ min: PB_RANGE.min, max: PB_RANGE.max });
    setPriceRange({ min: PRICE_RANGE.min, max: PRICE_RANGE.max });
    setMcapRange({ min: MARKET_CAP_BN_RANGE.min, max: MARKET_CAP_BN_RANGE.max });
    setUpsideRange({ min: UPSIDE_PCT_RANGE.min, max: UPSIDE_PCT_RANGE.max });
    setRoeRange({ min: ROE_RANGE.min, max: ROE_RANGE.max });
    setNetMarginRange({ min: NET_MARGIN_RANGE.min, max: NET_MARGIN_RANGE.max });
    setGrossMarginRange({ min: GROSS_MARGIN_RANGE.min, max: GROSS_MARGIN_RANGE.max });
    setRevGrowthRange({ min: REVENUE_GROWTH_RANGE.min, max: REVENUE_GROWTH_RANGE.max });
    setNpGrowthRange({ min: NET_PROFIT_GROWTH_RANGE.min, max: NET_PROFIT_GROWTH_RANGE.max });
    setPage(1);
    setDebouncedFilters({});
  };

  const summary = useMemo(() => {
    if (loading) return 'Loading...';
    if (error) return error;
    return `${total.toLocaleString('en-US')} stocks`;
  }, [loading, error, total]);

  const TABS: Array<{ id: FilterTab; label: string }> = [
    { id: 'valuation', label: 'Valuation' },
    { id: 'quality',   label: 'Quality'   },
    { id: 'growth',    label: 'Growth'    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="mx-auto max-w-[1500px] p-3 md:p-6 space-y-3">

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-4xl font-bold">Stock Screener</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 hidden md:block">
              Filter Vietnamese stocks by valuation, quality, and growth metrics.
            </p>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {/* Exchange pills — always visible */}
            <div className="flex gap-1">
              {([['HSX', 'HOSE'], ['HNX', 'HNX'], ['UPCOM', 'UPCOM']] as const).map(([value, label]) => {
                const on = exchanges.has(value);
                return (
                  <button
                    key={value}
                    onClick={() => toggleExchange(value)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition-colors ${
                      on
                        ? 'bg-blue-600 text-white border-blue-600 dark:bg-blue-500 dark:border-blue-500'
                        : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
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
              {totalActiveFilters > 0 && (
                <span className="rounded-full bg-blue-600 text-white text-xs px-1.5 py-0.5 leading-none">{totalActiveFilters}</span>
              )}
            </button>
          </div>
        </div>

        {/* Filter panel */}
        <div className={`rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden ${filtersOpen ? 'block' : 'hidden md:block'}`}>
          {/* Industry filter (ICB) */}
          {icbSectors.length > 0 && (
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">Ngành</span>
              <select
                value={selectedSector}
                onChange={(e) => { setSelectedSector(e.target.value); setPage(1); }}
                className="input flex-1 max-w-xs"
              >
                <option value="">Tất cả ngành</option>
                {(() => {
                  // Group icbSectors by icb_name1
                  const groups: Record<string, IcbSector[]> = {};
                  for (const s of icbSectors) {
                    const g = s.icb_name1 || 'Khác';
                    if (!groups[g]) groups[g] = [];
                    groups[g].push(s);
                  }
                  return Object.entries(groups).map(([group, items]) => (
                    <optgroup key={group} label={group}>
                      {items.map((s) => (
                        <option key={s.icb_code2} value={s.icb_name2}>{s.icb_name2}</option>
                      ))}
                    </optgroup>
                  ));
                })()}
              </select>
              {selectedSector && (
                <button
                  onClick={() => { setSelectedSector(''); setPage(1); }}
                  className="text-xs text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                  title="Xóa lọc ngành"
                >✕</button>
              )}
            </div>
          )}

          {/* Tab bar */}
          <div className="flex border-b border-slate-200 dark:border-slate-800">
            {TABS.map(({ id, label }) => {
              const count = tabCounts[id];
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    active
                      ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  {label}
                  {count > 0 && (
                    <span className={`rounded-full text-xs px-1.5 py-0.5 leading-none ${active ? 'bg-blue-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
            {totalActiveFilters > 0 && (
              <button
                onClick={resetAll}
                className="ml-auto mr-3 my-2 text-xs text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors self-center"
              >
                Reset all
              </button>
            )}
          </div>

          {/* Tab content */}
          <div className="p-3 md:p-4">
            {activeTab === 'valuation' && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 md:gap-3">
                <RangeSlider label="P/E" range={PE_RANGE} value={peRange} onChange={setPeRange} />
                <RangeSlider label="P/B" range={PB_RANGE} value={pbRange} onChange={setPbRange} valueFormatter={(n) => n.toFixed(1)} />
                <RangeSlider label="Price (VND)" range={PRICE_RANGE} value={priceRange} onChange={setPriceRange} valueFormatter={(n) => n >= 1000 ? `${(n/1000).toFixed(0)}k` : String(n)} />
                <RangeSlider label="MCap (B VND)" range={MARKET_CAP_BN_RANGE} value={mcapRange} onChange={setMcapRange} valueFormatter={(n) => n >= 1000 ? `${(n/1000).toFixed(0)}T` : `${n}B`} />
                {hasValuationData
                  ? <RangeSlider label="Upside (%)" range={UPSIDE_PCT_RANGE} value={upsideRange} onChange={setUpsideRange} valueFormatter={(n) => `${n > 0 ? '+' : ''}${n}%`} />
                  : (
                    <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-3 flex items-center justify-center text-center text-xs text-slate-400">
                      Upside % available<br />after pipeline runs
                    </div>
                  )
                }
              </div>
            )}
            {activeTab === 'quality' && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
                <RangeSlider label="ROE (%)" range={ROE_RANGE} value={roeRange} onChange={setRoeRange} valueFormatter={(n) => `${n}%`} />
                <RangeSlider label="Net Margin (%)" range={NET_MARGIN_RANGE} value={netMarginRange} onChange={setNetMarginRange} valueFormatter={(n) => `${n}%`} />
                <RangeSlider label="Gross Margin (%)" range={GROSS_MARGIN_RANGE} value={grossMarginRange} onChange={setGrossMarginRange} valueFormatter={(n) => `${n}%`} />
              </div>
            )}
            {activeTab === 'growth' && (
              <div className="grid grid-cols-2 md:grid-cols-2 gap-2 md:gap-3 md:max-w-lg">
                <RangeSlider label="Revenue Growth (%)" range={REVENUE_GROWTH_RANGE} value={revGrowthRange} onChange={setRevGrowthRange} valueFormatter={(n) => `${n}%`} />
                <RangeSlider label="NP Growth (%)" range={NET_PROFIT_GROWTH_RANGE} value={npGrowthRange} onChange={setNpGrowthRange} valueFormatter={(n) => `${n}%`} />
              </div>
            )}
          </div>

          {/* Mobile done button */}
          <div className="px-3 pb-3 flex md:hidden">
            <button onClick={() => setFiltersOpen(false)} className="ml-auto rounded-lg bg-blue-600 text-white px-5 py-1.5 text-sm font-medium">
              Done
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 md:p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="text-sm text-slate-500 tabular-nums">{summary}</div>
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
                  {hasValuationData && (
                    <th className="py-2 px-2 font-medium text-right" title="Intrinsic value estimate. Grade (A–F) = data quality: A ≥85%, B ≥70%, C ≥55%, D ≥40%, F &lt;40%">
                      Intrinsic <span className="hidden sm:inline text-slate-400 font-normal">(grade)</span>
                    </th>
                  )}
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
                    upside == null    ? '' :
                    upside >= 20      ? 'text-emerald-600 dark:text-emerald-400 font-semibold' :
                    upside >= 0       ? 'text-emerald-500 dark:text-emerald-500' :
                    upside >= -20     ? 'text-amber-600 dark:text-amber-400' :
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
            <button className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm disabled:opacity-40"
              onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>← Prev</button>
            <div className="text-sm text-slate-500 tabular-nums">{page} / {totalPages}</div>
            <button className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm disabled:opacity-40"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading}>Next →</button>
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
          .input { border-color: rgb(51 65 85); background: rgb(15 23 42); color: rgb(241 245 249); }
          .single-slider::-webkit-slider-runnable-track { background: rgb(51 65 85); }
          .single-slider::-moz-range-track { background: rgb(51 65 85); }
        }
      `}</style>
    </div>
  );
}
