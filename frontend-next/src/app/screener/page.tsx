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

type RangePreset = { label: string; min: number; max: number };

function QuickRangeFilter({
  label, range, value, onChange, presets, valueFormatter,
}: {
  label: string;
  range: { min: number; max: number; step: number };
  value: SliderRange;
  onChange: (v: SliderRange) => void;
  presets: RangePreset[];
  valueFormatter?: (n: number) => string;
}) {
  const [advanced, setAdvanced] = useState(false);
  const format = valueFormatter ?? String;
  const selectedPreset = presets.find((preset) => preset.min === value.min && preset.max === value.max)?.label;
  const isCustom = !selectedPreset;

  return (
    <section className={`rounded-xl border p-3 ${isActive(value, range) ? 'border-blue-300 bg-blue-50/40 dark:border-blue-800 dark:bg-blue-950/20' : 'border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/50'}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</h3>
        {isActive(value, range) && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">{selectedPreset || 'Tùy chỉnh'}</span>}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {presets.map((preset) => {
          const active = preset.min === value.min && preset.max === value.max;
          return <button key={preset.label} type="button" onClick={() => onChange({ min: preset.min, max: preset.max })} className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${active ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:border-blue-300 hover:text-blue-700 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700'}`}>{preset.label}</button>;
        })}
        <button type="button" onClick={() => setAdvanced((open) => !open)} className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${advanced || isCustom ? 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'}`}>Tùy chỉnh</button>
      </div>
      {advanced && (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
          {(['min', 'max'] as const).map((side) => <label key={side} className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{side === 'min' ? 'Từ' : 'Đến'}
            <input type="number" min={range.min} max={range.max} step={range.step} value={value[side]} onChange={(event) => {
              const next = Number(event.target.value);
              onChange(side === 'min' ? { min: Math.min(next, value.max), max: value.max } : { min: value.min, max: Math.max(next, value.min) });
            }} className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium tabular-nums text-slate-700 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" />
          </label>)}
          <p className="col-span-2 text-[10px] text-slate-400">Đang lọc: {format(value.min)} – {format(value.max)}</p>
        </div>
      )}
    </section>
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
  const [sectorOpen, setSectorOpen]           = useState(false);
  const [sectorQuery, setSectorQuery]         = useState('');

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

  const sectorGroups = useMemo(() => {
    const query = sectorQuery.trim().toLocaleLowerCase('vi-VN');
    const groups: Record<string, IcbSector[]> = {};
    for (const sector of icbSectors) {
      const matches = !query || `${sector.icb_name1} ${sector.icb_name2}`.toLocaleLowerCase('vi-VN').includes(query);
      if (!matches) continue;
      const group = sector.icb_name1 || 'Khác';
      if (!groups[group]) groups[group] = [];
      groups[group].push(sector);
    }
    return Object.entries(groups);
  }, [icbSectors, sectorQuery]);

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
    { id: 'valuation', label: 'Định giá' },
    { id: 'quality',   label: 'Chất lượng' },
    { id: 'growth',    label: 'Tăng trưởng' },
  ];

  return (
    <div className="min-h-screen text-slate-900 dark:text-slate-100">
      <div className="mx-auto max-w-[1600px] p-4 md:p-6 space-y-4">

        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <h1 className="text-3xl font-bold leading-tight tracking-tight md:text-4xl">Stock <span className="text-blue-600 dark:text-blue-400">Screener</span></h1>
            <div className="mt-2 h-1 w-24 rounded bg-blue-500" />
            <p className="mt-3 hidden text-sm text-slate-600 dark:text-slate-300 md:block">
              Screen the active HOSE, HNX, and UPCOM universe by valuation, quality, and growth.
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
        <div className={`overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${filtersOpen ? 'block' : 'hidden md:block'}`}>
          {/* Industry filter — the dataset exposes ICB levels 1 and 2; filtering uses level 2. */}
          {icbSectors.length > 0 && (
          <div className="relative z-10 flex flex-col gap-3 border-b border-slate-200 px-4 py-4 dark:border-slate-800 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Ngành</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">ICB cấp 2</span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Lọc theo ngành chi tiết; ICB cấp 1 chỉ dùng để phân nhóm.</p>
              </div>
              <div className="relative w-full md:w-[330px]">
                <button
                  type="button"
                  onClick={() => setSectorOpen((open) => !open)}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  aria-expanded={sectorOpen}
                >
                  <span className="truncate">{selectedSector || 'Tất cả ngành'}</span>
                  <span className="ml-3 text-slate-400">⌄</span>
                </button>
                {sectorOpen && (
                  <div className="absolute right-0 top-[calc(100%+8px)] w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                    <div className="border-b border-slate-100 p-2 dark:border-slate-800">
                      <input
                        autoFocus
                        value={sectorQuery}
                        onChange={(event) => setSectorQuery(event.target.value)}
                        placeholder="Tìm ngành ICB cấp 2…"
                        className="w-full rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                    <div className="max-h-72 overflow-y-auto p-1.5">
                      <button type="button" onClick={() => { setSelectedSector(''); setSectorOpen(false); setSectorQuery(''); setPage(1); }} className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-700 dark:text-slate-200 dark:hover:bg-blue-950/40 dark:hover:text-blue-300">Tất cả ngành</button>
                      {sectorGroups.map(([group, sectors]) => (
                        <div key={group} className="py-1">
                          <p className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">{group}</p>
                          {sectors.map((sector) => (
                            <button key={sector.icb_code2} type="button" onClick={() => { setSelectedSector(sector.icb_name2); setSectorOpen(false); setSectorQuery(''); setPage(1); }} className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${selectedSector === sector.icb_name2 ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'}`}>
                              <span>{sector.icb_name2}</span><span className="text-[10px] text-slate-400">ICB 2</span>
                            </button>
                          ))}
                        </div>
                      ))}
                      {sectorGroups.length === 0 && <p className="px-3 py-5 text-center text-sm text-slate-400">Không tìm thấy ngành phù hợp.</p>}
                    </div>
                  </div>
                )}
              </div>
              {selectedSector && <button onClick={() => { setSelectedSector(''); setPage(1); }} className="absolute bottom-2 right-5 text-xs font-medium text-slate-400 hover:text-rose-500 dark:hover:text-rose-400">Xóa ngành đã chọn</button>}
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
                Xóa bộ lọc
              </button>
            )}
          </div>

          {/* Tab content */}
          <div className="p-3 md:p-4">
            {activeTab === 'valuation' && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 md:gap-3">
                <QuickRangeFilter label="P/E" range={PE_RANGE} value={peRange} onChange={setPeRange} presets={[{ label: 'Tất cả', ...PE_RANGE }, { label: '< 10', min: 0, max: 10 }, { label: '10–20', min: 10, max: 20 }, { label: '> 20', min: 20, max: 60 }]} />
                <QuickRangeFilter label="P/B" range={PB_RANGE} value={pbRange} onChange={setPbRange} valueFormatter={(n) => n.toFixed(1)} presets={[{ label: 'Tất cả', ...PB_RANGE }, { label: '< 1', min: 0, max: 1 }, { label: '1–3', min: 1, max: 3 }, { label: '> 3', min: 3, max: 10 }]} />
                <QuickRangeFilter label="Giá (VND)" range={PRICE_RANGE} value={priceRange} onChange={setPriceRange} valueFormatter={(n) => n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n)} presets={[{ label: 'Tất cả', ...PRICE_RANGE }, { label: '< 20k', min: 0, max: 20000 }, { label: '20–50k', min: 20000, max: 50000 }, { label: '> 50k', min: 50000, max: 200000 }]} />
                <QuickRangeFilter label="Vốn hóa (tỷ VNĐ)" range={MARKET_CAP_BN_RANGE} value={mcapRange} onChange={setMcapRange} valueFormatter={(n) => n >= 1000 ? `${(n / 1000).toFixed(0)} nghìn tỷ` : `${n} tỷ`} presets={[{ label: 'Tất cả', ...MARKET_CAP_BN_RANGE }, { label: '< 10 nghìn tỷ', min: 0, max: 10000 }, { label: '10–100 nghìn tỷ', min: 10000, max: 100000 }, { label: '> 100 nghìn tỷ', min: 100000, max: 1200000 }]} />
                {hasValuationData
                  ? <QuickRangeFilter label="Tiềm năng tăng giá" range={UPSIDE_PCT_RANGE} value={upsideRange} onChange={setUpsideRange} valueFormatter={(n) => `${n > 0 ? '+' : ''}${n}%`} presets={[{ label: 'Tất cả', ...UPSIDE_PCT_RANGE }, { label: 'Âm', min: -100, max: 0 }, { label: '0–20%', min: 0, max: 20 }, { label: '> 20%', min: 20, max: 300 }]} />
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
                <QuickRangeFilter label="ROE" range={ROE_RANGE} value={roeRange} onChange={setRoeRange} valueFormatter={(n) => `${n}%`} presets={[{ label: 'Tất cả', ...ROE_RANGE }, { label: '< 10%', min: -20, max: 10 }, { label: '10–20%', min: 10, max: 20 }, { label: '> 20%', min: 20, max: 40 }]} />
                <QuickRangeFilter label="Biên lợi nhuận ròng" range={NET_MARGIN_RANGE} value={netMarginRange} onChange={setNetMarginRange} valueFormatter={(n) => `${n}%`} presets={[{ label: 'Tất cả', ...NET_MARGIN_RANGE }, { label: 'Âm', min: -30, max: 0 }, { label: '0–15%', min: 0, max: 15 }, { label: '> 15%', min: 15, max: 50 }]} />
                <QuickRangeFilter label="Biên lợi nhuận gộp" range={GROSS_MARGIN_RANGE} value={grossMarginRange} onChange={setGrossMarginRange} valueFormatter={(n) => `${n}%`} presets={[{ label: 'Tất cả', ...GROSS_MARGIN_RANGE }, { label: '< 20%', min: -10, max: 20 }, { label: '20–40%', min: 20, max: 40 }, { label: '> 40%', min: 40, max: 80 }]} />
              </div>
            )}
            {activeTab === 'growth' && (
              <div className="grid grid-cols-2 md:grid-cols-2 gap-2 md:gap-3 md:max-w-lg">
                <QuickRangeFilter label="Tăng trưởng doanh thu" range={REVENUE_GROWTH_RANGE} value={revGrowthRange} onChange={setRevGrowthRange} valueFormatter={(n) => `${n}%`} presets={[{ label: 'Tất cả', ...REVENUE_GROWTH_RANGE }, { label: 'Âm', min: -100, max: 0 }, { label: '0–20%', min: 0, max: 20 }, { label: '> 20%', min: 20, max: 300 }]} />
                <QuickRangeFilter label="Tăng trưởng lợi nhuận" range={NET_PROFIT_GROWTH_RANGE} value={npGrowthRange} onChange={setNpGrowthRange} valueFormatter={(n) => `${n}%`} presets={[{ label: 'Tất cả', ...NET_PROFIT_GROWTH_RANGE }, { label: 'Âm', min: -100, max: 0 }, { label: '0–20%', min: 0, max: 20 }, { label: '> 20%', min: 20, max: 300 }]} />
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
        <div className="rounded-3xl border border-slate-200/80 bg-white/95 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Results</p>
              <div className="mt-0.5 text-sm font-semibold text-slate-600 tabular-nums dark:text-slate-300">{summary}</div>
            </div>
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
