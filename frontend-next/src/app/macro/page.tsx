'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { API } from '@/lib/api';
import { getFFWS, FFPrice } from '@/lib/ffWS';
import {
    FA_COLORS,
    FF_ALL_INDEX_CHANNELS,
    FF_AMERICAS_CHANNELS,
    FF_ASIA_CHANNELS,
    FF_EUROPE_CHANNELS,
    FF_FOREX_CHANNELS,
    FF_TO_YAHOO,
    KEY_STATS,
    RANGE_OPTIONS,
    RATES_REFRESH_MS,
    TV_CONFIGS,
    VIETNAM_SUBTABS,
    VIETNAM_TAB_FA,
    VIETNAM_TAB_TV,
    calcYAxisWidth,
    fmtMilVND,
    fmtTrVND,
    fmtUsdChange,
    fmtUsdPrice,
    fmtVndChange,
    fmtVndPrice,
    getMarketSessions,
    limitByFreq,
    normalizeColor,
    type DetailSelection,
    type FAData,
    type FAIndicator,
    type FFCardDef,
    type PricePoint,
    type RateItem,
    type RatesData,
    type VietnamSubTabId,
} from './config';

const AreaChart = dynamic(() => import('@tremor/react').then((module) => module.AreaChart), {
    ssr: false,
    loading: () => <div className="h-48 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />,
});
const BarChart = dynamic(() => import('@tremor/react').then((module) => module.BarChart), {
    ssr: false,
    loading: () => <div className="h-48 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />,
});

// ── Lazy section: only mount children when scrolled into view ─────────────────
function LazySection({ children, className }: { children: React.ReactNode; className?: string }) {
    const ref  = useRef<HTMLDivElement>(null);
    const [vis, setVis] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVis(true); obs.disconnect(); } }, { rootMargin: '200px' });
        obs.observe(el);
        return () => obs.disconnect();
    }, []);
    return <div ref={ref} className={className}>{vis ? children : <div className="h-[260px] rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />}</div>;
}

// History is used by both summary cards and the expanded chart. Keeping one
// in-memory request per symbol/range prevents duplicate API calls on first load.
const historyRequestCache = new Map<string, Promise<PricePoint[]>>();

function loadMacroHistory(symbol: string, days: number): Promise<PricePoint[]> {
    const cacheKey = `${symbol}:${days}`;
    const cached = historyRequestCache.get(cacheKey);
    if (cached) return cached;

    const request = fetch(API.MACRO_HISTORY(symbol, days))
        .then((response) => response.ok ? response.json() : [])
        .catch(() => [] as PricePoint[]);
    historyRequestCache.set(cacheKey, request);
    return request;
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
    return <div className="h-[100px] rounded-lg animate-pulse bg-slate-100 dark:bg-slate-800" />;
}
function SkeletonChart() {
    return <div className="h-[260px] rounded-xl animate-pulse bg-slate-100 dark:bg-slate-800" />;
}
function Spinner({ h = 'h-48' }: { h?: string }) {
    return (
        <div className={`${h} flex items-center justify-center`}>
            <div className="w-5 h-5 border-2 border-slate-300 dark:border-slate-700 border-t-slate-600 dark:border-t-slate-300 rounded-full animate-spin" />
        </div>
    );
}
function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return <div className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>{children}</div>;
}
function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
    return (
        <div className="mb-4">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{title}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
        </div>
    );
}

// ── History chart for exchange rates / commodities ────────────────────────────

function downloadCsv(filename: string, rows: PricePoint[]) {
    const body = rows.map((r) => `${r.date},${r.close}`).join('\n');
    const blob  = new Blob([`Date,Close\n${body}`], { type: 'text/csv;charset=utf-8;' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}

function HistoryChart({ item, isVnd, onClose }: { item: RateItem; isVnd: boolean; onClose: () => void }) {
    const [days, setDays]       = useState(365);
    const [points, setPoints]   = useState<PricePoint[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async (d: number) => {
        setLoading(true);
        try {
            setPoints(await loadMacroHistory(item.symbol, d));
        } catch { /* ignore */ }
        finally { setLoading(false); }
    }, [item.symbol]);

    useEffect(() => { load(days); }, [days, load]);

    const first = points[0]?.close ?? null;
    const last  = points[points.length - 1]?.close ?? null;
    const overallChange = first && last ? ((last - first) / first) * 100 : null;
    const up = overallChange === null ? true : overallChange >= 0;

    const useDayFormat = days <= 180;
    const chartData = points.map((p) => {
        const [y, m, d] = p.date.split('-');
        return {
            Ngày: useDayFormat ? `${d}/${m}` : `${m}/${y.slice(2)}`,
            [item.name]: p.close,
        };
    });

    const fmtY = isVnd ? fmtVndPrice : fmtUsdPrice;
    const maxClose = points.length ? Math.max(...points.map((p) => p.close)) : 0;
    const yAxisW   = isVnd ? 80 : maxClose >= 1000 ? 70 : 52;
    const rangeLabel = RANGE_OPTIONS.find((o) => o.days === days)?.label ?? '';

    return (
        <div className="mt-1 col-span-2 lg:col-span-4">
            <Panel className="p-5">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <p className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                            {item.name}
                            {item.unit && <span className="ml-1.5 text-xs font-normal text-tremor-content dark:text-dark-tremor-content">({item.unit})</span>}
                        </p>
                        {overallChange !== null && (
                            <p className={`text-sm mt-0.5 font-medium ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {up ? '▲' : '▼'} {Math.abs(overallChange).toFixed(2)}% trong kỳ
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 text-xs">
                            {RANGE_OPTIONS.map((opt) => (
                                <button key={opt.days} onClick={() => setDays(opt.days)}
                                    className={`px-2.5 py-1 font-medium transition-colors ${days === opt.days ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        {points.length > 0 && (
                            <button onClick={() => downloadCsv(`${item.symbol.replace('=', '_')}_${rangeLabel}.csv`, points)}
                                title="Tải CSV"
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                    <path d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                                CSV
                            </button>
                        )}
                        <button onClick={onClose} className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" aria-label="Đóng">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                            </svg>
                        </button>
                    </div>
                </div>
                {loading ? <Spinner h="h-48" /> : chartData.length === 0
                    ? <div className="h-48 flex items-center justify-center text-sm text-tremor-content dark:text-dark-tremor-content">Không có dữ liệu</div>
                    : <AreaChart data={chartData} index="Ngày" categories={[item.name]}
                        colors={[up ? 'emerald' : 'rose']} valueFormatter={fmtY}
                        yAxisWidth={yAxisW} showLegend={false} showGradient autoMinValue
                        showAnimation={false} tickGap={60} className="h-48" />}
            </Panel>
        </div>
    );
}

function SessionBadge({ open, tz }: { open: boolean; tz: string }) {
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
            open
                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
        }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${open ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
            {open ? 'Đang mở' : 'Đóng cửa'} · {tz}
        </span>
    );
}

function FFLiveCard({ def, snap }: { def: FFCardDef; snap: FFPrice | undefined }) {
    const up        = (snap?.changePercent ?? 0) >= 0;
    const colorCls  = up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
    const bgCls     = up ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-rose-50 dark:bg-rose-900/20';
    return (
        <div className="rounded-tremor-default ring-1 ring-tremor-ring dark:ring-dark-tremor-ring bg-tremor-background dark:bg-dark-tremor-background p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-tremor-content dark:text-dark-tremor-content mb-1">{def.label}</p>
            {snap ? (
                <>
                    <p className="text-2xl font-bold tabular-nums text-tremor-content-strong dark:text-dark-tremor-content-strong">{def.fmt(snap.price)}</p>
                    <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${bgCls} ${colorCls}`}>
                        <span>{up ? '▲' : '▼'}</span>
                        <span>{Math.abs(snap.changePercent).toFixed(2)}%</span>
                    </div>
                    <p className="mt-1.5 text-[10px] text-slate-400 dark:text-slate-500">Live · Forex Factory</p>
                </>
            ) : (
                <div className="space-y-2 mt-1">
                    <div className="h-7 w-28 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
                    <div className="h-4 w-16 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse" />
                </div>
            )}
        </div>
    );
}

// ── Rate Card ─────────────────────────────────────────────────────────────────

function RateCard({ item, isVnd, selected, onClick }: { item: RateItem; isVnd: boolean; selected: boolean; onClick: () => void }) {
    const up        = item.changePercent >= 0;
    const colorCls  = up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
    const bgCls     = up ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-rose-50 dark:bg-rose-900/20';
    return (
        <button onClick={onClick}
            className={`text-left rounded-tremor-default ring-1 transition-all duration-150 focus:outline-none
                ${selected ? 'ring-blue-500 shadow-md shadow-blue-500/10' : 'ring-tremor-ring dark:ring-dark-tremor-ring hover:ring-blue-400 hover:shadow-sm'}
                bg-tremor-background dark:bg-dark-tremor-background p-4 w-full`}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-tremor-content dark:text-dark-tremor-content mb-1">{item.name}</p>
            <p className="text-2xl font-bold tabular-nums text-tremor-content-strong dark:text-dark-tremor-content-strong">
                {isVnd ? fmtVndPrice(item.price) : fmtUsdPrice(item.price)}
            </p>
            {item.unit && <p className="text-[11px] text-tremor-content dark:text-dark-tremor-content mt-0.5">{item.unit}</p>}
            <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${bgCls} ${colorCls}`}>
                <span>{up ? '▲' : '▼'}</span>
                <span>{Math.abs(item.changePercent).toFixed(2)}%</span>
                <span className="opacity-70">({isVnd ? fmtVndChange(item.change) : fmtUsdChange(item.change)})</span>
            </div>
            <p className="mt-2 text-[10px] text-blue-500 dark:text-blue-400 font-medium">
                {selected ? '▴ Thu gọn' : '▾ Xem lịch sử'}
            </p>
        </button>
    );
}

function CardGrid({ items, isVnd }: { items: RateItem[]; isVnd: boolean }) {
    const [selected, setSelected] = useState<string | null>(null);
    const selectedItem = items.find((i) => i.symbol === selected) ?? null;
    const toggle = (sym: string) => setSelected((prev) => (prev === sym ? null : sym));
    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {items.map((item) => (
                <RateCard key={item.symbol} item={item} isVnd={isVnd}
                    selected={selected === item.symbol} onClick={() => toggle(item.symbol)} />
            ))}
            {selectedItem && (
                <HistoryChart key={selectedItem.symbol} item={selectedItem}
                    isVnd={isVnd} onClose={() => setSelected(null)} />
            )}
        </div>
    );
}

function getSourceLabel(source: string) {
    return source.replace('TradingView / ', '').split(' · ')[0];
}

function formatRawNumber(value: number, maximumFractionDigits = 2) {
    return Math.abs(value) >= 1000
        ? value.toLocaleString('en-US', { maximumFractionDigits: 0 })
        : value.toLocaleString('en-US', { maximumFractionDigits });
}

function getFaFormatter(ind: FAIndicator) {
    const unit = ind.unit?.trim().toLowerCase() ?? '';
    if (unit.includes('%')) return (v: number) => `${v.toFixed(2)}%`;
    if (unit.includes('triệu') && unit.includes('đ')) return fmtMilVND;
    if (unit.includes('tỷ') && unit.includes('$')) return (v: number) => `${v.toFixed(2)} tỷ $`;
    if (unit.includes('nghìn tỷ')) return fmtTrVND;
    // FireAnt GDP sectors are stored in Tỷ VNĐ (billions VND) → convert to nghìn tỷ for readability
    if (unit.includes('tỷ vn') || unit.includes('tỷ vnđ')) return (v: number) => `${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })} nghìn tỷ ₫`;
    return (v: number) => formatRawNumber(v);
}

function getFaCompareMeta(ind: FAIndicator) {
    const freq = (ind.frequency ?? '').toLowerCase();
    if (freq.includes('quý')) return { lag: 4, label: 'cùng kỳ' };
    if (freq.includes('tháng')) return { lag: 12, label: 'cùng kỳ' };
    if (freq.includes('năm')) return { lag: 1, label: 'năm trước' };
    return { lag: 1, label: 'kỳ trước' };
}

function getDeltaDirection(delta: number | null) {
    if (delta === null) return 'flat';
    if (delta > 0) return 'up';
    if (delta < 0) return 'down';
    return 'flat';
}

function formatComparisonText(delta: number | null, label: string, unitLabel: string, formatter: (v: number) => string) {
    if (delta === null) return 'Chưa đủ dữ liệu so sánh';
    const abs = Math.abs(delta);
    if (unitLabel.includes('%')) return `${delta >= 0 ? '+' : '-'}${abs.toFixed(2)} điểm so với ${label}`;
    return `${delta >= 0 ? '+' : '-'}${formatter(abs)} so với ${label}`;
}

function buildTvSummary(sym: string, points: PricePoint[]) {
    const cfg = TV_CONFIGS[sym];
    const latest = points.at(-1)?.close ?? null;
    const compareLag = cfg.compareLag ?? (cfg.freq === 'annual' ? 1 : cfg.freq === 'daily' ? 1 : 12);
    const comparePoint = points.length > compareLag ? points.at(-(compareLag + 1))?.close ?? null : null;
    const delta = latest !== null && comparePoint !== null ? latest - comparePoint : null;
    return {
        latest,
        updatedAt: points.at(-1)?.date ?? null,
        delta,
        comparisonText: formatComparisonText(delta, cfg.compareLabel ?? 'kỳ trước', cfg.unitLabel, cfg.fmt),
        comparisonLabel: cfg.compareLabel ?? 'kỳ trước',
        sourceLabel: getSourceLabel(cfg.source),
    };
}

function buildFaSummary(ind: FAIndicator) {
    const fmt = getFaFormatter(ind);
    const latest = ind.data.at(-1)?.value ?? ind.lastValue ?? null;
    const compareMeta = getFaCompareMeta(ind);
    const comparePoint = ind.data.length > compareMeta.lag ? ind.data.at(-(compareMeta.lag + 1))?.value ?? null : null;
    const delta = latest !== null && comparePoint !== null ? latest - comparePoint : null;
    return {
        latest,
        updatedAt: ind.data.at(-1)?.date ?? ind.lastDate ?? null,
        delta,
        comparisonText: formatComparisonText(delta, compareMeta.label, ind.unit ?? '', fmt),
        comparisonLabel: compareMeta.label,
        sourceLabel: ind.source ?? 'FireAnt',
        formatter: fmt,
    };
}

function CompactStatCard({
    title,
    source,
    unit,
    valueText,
    updatedAt,
    comparisonText,
    selected,
    tone,
    onClick,
}: {
    title: string;
    source: string;
    unit: string;
    valueText: string;
    updatedAt: string;
    comparisonText: string;
    selected: boolean;
    tone: 'up' | 'down' | 'flat';
    onClick: () => void;
}) {
    const toneCls = tone === 'up'
        ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
        : tone === 'down'
            ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20'
            : 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800';

    return (
        <button
            onClick={onClick}
            className={`w-full text-left rounded-xl border p-4 transition-all duration-150 ${
                selected
                    ? 'border-blue-500 bg-white dark:bg-slate-900 shadow-sm shadow-blue-500/10'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-300 dark:hover:border-blue-700'
            }`}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</p>
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{source}</p>
                </div>
                <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {unit}
                </span>
            </div>
            <div className="mt-4">
                <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{valueText}</p>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Cập nhật {updatedAt}</p>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${toneCls}`}>
                    {comparisonText}
                </span>
                <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                    {selected ? 'Đang mở' : 'Xem chart'}
                </span>
            </div>
        </button>
    );
}

function DetailChartCard({
    title,
    subtitle,
    latestText,
    updatedAt,
    comparisonText,
    color,
    unit,
    chartData,
    chartKey,
    valueFormatter,
    barChart,
}: {
    title: string;
    subtitle: string;
    latestText: string;
    updatedAt: string;
    comparisonText: string;
    color: string;
    unit: string;
    chartData: Record<string, string | number>[];
    chartKey: string;
    valueFormatter: (v: number) => string;
    barChart?: boolean;
}) {
    const values = chartData.map((row) => Number(row[chartKey]));
    const yAxisWidth = calcYAxisWidth(values, valueFormatter);
    const tremorColor = normalizeColor(color);

    return (
        <Panel className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <p className="text-base font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">{title}</p>
                    <p className="mt-1 text-xs text-tremor-content dark:text-dark-tremor-content">{subtitle}</p>
                </div>
                <div className="sm:text-right">
                    <p className="text-2xl font-bold tabular-nums text-tremor-content-strong dark:text-dark-tremor-content-strong">{latestText}</p>
                    <p className="mt-1 text-[11px] text-tremor-content dark:text-dark-tremor-content">Đơn vị: {unit}</p>
                    <p className="mt-1 text-[11px] text-tremor-content dark:text-dark-tremor-content">Cập nhật: {updatedAt}</p>
                    <p className="mt-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400">{comparisonText}</p>
                </div>
            </div>
            {chartData.length === 0 ? (
                <div className="mt-4 h-56 flex items-center justify-center text-sm text-tremor-content dark:text-dark-tremor-content">Không có dữ liệu</div>
            ) : barChart ? (
                <BarChart
                    data={chartData}
                    index="Kỳ"
                    categories={[chartKey]}
                    colors={[tremorColor]}
                    valueFormatter={valueFormatter}
                    yAxisWidth={yAxisWidth}
                    showLegend={false}
                    showAnimation={false}
                    tickGap={24}
                    className="mt-4 h-56"
                />
            ) : (
                <AreaChart
                    data={chartData}
                    index="Kỳ"
                    categories={[chartKey]}
                    colors={[tremorColor]}
                    valueFormatter={valueFormatter}
                    yAxisWidth={yAxisWidth}
                    showLegend={false}
                    showGradient
                    autoMinValue
                    showAnimation={false}
                    tickGap={24}
                    className="mt-4 h-56"
                />
            )}
        </Panel>
    );
}

function TVStatCard({ sym, selected, onClick }: { sym: string; selected: boolean; onClick: () => void }) {
    const cfg = TV_CONFIGS[sym];
    const [points, setPoints] = useState<PricePoint[] | null>(null);

    useEffect(() => {
        let active = true;
        loadMacroHistory(sym, cfg.defaultDays)
            .then((data: PricePoint[]) => { if (active) setPoints(data); })
            .catch(() => { if (active) setPoints([]); });
        return () => { active = false; };
    }, [cfg.defaultDays, sym]);

    if (!points) return <SkeletonCard />;
    const summary = buildTvSummary(sym, points);

    return (
        <CompactStatCard
            title={cfg.titleVN}
            source={summary.sourceLabel}
            unit={cfg.unitLabel}
            valueText={summary.latest !== null ? cfg.fmt(summary.latest) : 'N/A'}
            updatedAt={summary.updatedAt ?? 'N/A'}
            comparisonText={summary.comparisonText}
            selected={selected}
            tone={getDeltaDirection(summary.delta)}
            onClick={onClick}
        />
    );
}

function TVDetailPanel({ sym }: { sym: string }) {
    const cfg = TV_CONFIGS[sym];
    const [points, setPoints] = useState<PricePoint[] | null>(null);

    useEffect(() => {
        let active = true;
        loadMacroHistory(sym, cfg.defaultDays)
            .then((data: PricePoint[]) => { if (active) setPoints(data); })
            .catch(() => { if (active) setPoints([]); });
        return () => { active = false; };
    }, [cfg.defaultDays, sym]);

    if (!points) return <SkeletonChart />;

    const summary = buildTvSummary(sym, points);
    const chartData = points.map((p) => {
        const [y, m, d] = p.date.split('-');
        let label = p.date;
        if (cfg.freq === 'annual') label = y;
        else if (cfg.freq === 'daily') label = `${d}/${m}`;
        else label = `${m}/${y.slice(2)}`;
        return { 'Kỳ': label, [cfg.titleVN]: p.close };
    });

    return (
        <DetailChartCard
            title={cfg.titleVN}
            subtitle={cfg.source}
            latestText={summary.latest !== null ? cfg.fmt(summary.latest) : 'N/A'}
            updatedAt={summary.updatedAt ?? 'N/A'}
            comparisonText={summary.comparisonText}
            color={cfg.color}
            unit={cfg.unitLabel}
            chartData={chartData}
            chartKey={cfg.titleVN}
            valueFormatter={cfg.fmt}
            barChart={cfg.barChart}
        />
    );
}

function FAStatCard({ ind, selected, onClick }: { ind: FAIndicator; selected: boolean; onClick: () => void }) {
    const summary = buildFaSummary(ind);
    return (
        <CompactStatCard
            title={ind.nameVN}
            source={summary.sourceLabel}
            unit={ind.unit || 'Dữ liệu'}
            valueText={summary.latest !== null ? summary.formatter(summary.latest) : 'N/A'}
            updatedAt={summary.updatedAt ?? 'N/A'}
            comparisonText={summary.comparisonText}
            selected={selected}
            tone={getDeltaDirection(summary.delta)}
            onClick={onClick}
        />
    );
}

function FADetailPanel({ ind, color }: { ind: FAIndicator; color: string }) {
    const summary = buildFaSummary(ind);
    const fmt = summary.formatter;
    const displayData = limitByFreq(ind.data, ind.frequency ?? '');
    const chartData = displayData.map((p) => ({ 'Kỳ': p.date, [ind.nameVN]: p.value }));
    return (
        <DetailChartCard
            title={ind.nameVN}
            subtitle={`${summary.sourceLabel} · ${ind.frequency || 'Chuỗi thời gian'}`}
            latestText={summary.latest !== null ? fmt(summary.latest) : 'N/A'}
            updatedAt={summary.updatedAt ?? 'N/A'}
            comparisonText={summary.comparisonText}
            color={color}
            unit={ind.unit || 'Dữ liệu'}
            chartData={chartData}
            chartKey={ind.nameVN}
            valueFormatter={fmt}
        />
    );
}

// ── GDP Composition Stacked Bar ───────────────────────────────────────────────

const GDP_SECTORS = [
    { sym: 'ECONOMICS:VNGDPS',   label: 'Dịch vụ',     color: 'cyan'   },
    { sym: 'ECONOMICS:VNGDPMAN', label: 'Công nghiệp',  color: 'orange' },
    { sym: 'ECONOMICS:VNGDPA',   label: 'Nông nghiệp',  color: 'lime'   },
] as const;

function dateToQuarter(date: string): string {
    const [y, m] = date.split('-');
    const q = m === '03' ? 'Q1' : m === '06' ? 'Q2' : m === '09' ? 'Q3' : 'Q4';
    return `${q}/${y.slice(2)}`;
}

function GDPCompositionChart() {
    const [chartData, setChartData] = useState<Record<string, string | number>[]>([]);
    const [loading, setLoading]     = useState(true);

    useEffect(() => {
        let active = true;
        Promise.all(
            GDP_SECTORS.map(({ sym }): Promise<PricePoint[]> =>
                loadMacroHistory(sym, 1095)
            )
        ).then(([services, industry, agriculture]) => {
            if (!active) return;
            const byQ = new Map<string, Record<string, number>>();
            const add = (points: PricePoint[], label: string) =>
                points.forEach(p => {
                    const q = dateToQuarter(p.date);
                    if (!byQ.has(q)) byQ.set(q, {});
                    byQ.get(q)![label] = Math.round(p.close / 1e12);
                });
            add(services,    'Dịch vụ');
            add(industry,    'Công nghiệp');
            add(agriculture, 'Nông nghiệp');
            const rows = Array.from(byQ.entries())
                .filter(([, v]) => v['Dịch vụ'] && v['Công nghiệp'] && v['Nông nghiệp'])
                .sort(([a], [b]) => a.localeCompare(b))
                .slice(-20)
                .map(([q, v]) => ({ Kỳ: q, ...v }));
            setChartData(rows);
            setLoading(false);
        });
        return () => { active = false; };
    }, []);

    if (loading) return <SkeletonChart />;
    if (!chartData.length) return null;

    return (
        <Panel className="p-5">
            <div className="mb-4">
                <p className="text-base font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                    Cơ Cấu GDP theo Ngành
                </p>
                <p className="mt-1 text-xs text-tremor-content dark:text-dark-tremor-content">
                    TradingView / GSO · nghìn tỷ ₫ · 5 năm gần nhất
                </p>
            </div>
            <BarChart
                data={chartData}
                index="Kỳ"
                categories={['Dịch vụ', 'Công nghiệp', 'Nông nghiệp']}
                colors={['cyan', 'orange', 'lime']}
                valueFormatter={(v) => `${v.toLocaleString('en-US', { maximumFractionDigits: 0 })} nghìn tỷ`}
                stack={true}
                yAxisWidth={72}
                showLegend={true}
                showAnimation={false}
                tickGap={24}
                className="mt-4 h-72"
            />
        </Panel>
    );
}

function VietnamMacroTab() {
    const [activeSubTab, setActiveSubTab] = useState<VietnamSubTabId>('growth');
    const [selected, setSelected] = useState<DetailSelection | null>(null);
    const [faData, setFaData] = useState<FAData>({});
    const [loadingTypes, setLoadingTypes] = useState<Set<string>>(new Set());
    const loadedTypesRef = useRef(new Set<string>());
    const activeFaTypes = VIETNAM_TAB_FA[activeSubTab];
    const activeFaKey = activeFaTypes.join(',');

    useEffect(() => {
        const missingTypes = activeFaTypes.filter((type) => !loadedTypesRef.current.has(type));
        if (!missingTypes.length) return;

        let cancelled = false;
        setLoadingTypes((current) => new Set([...current, ...missingTypes]));
        fetch(API.MACRO_FIREANT(missingTypes.join(',')))
            .then((response) => response.ok ? response.json() : {})
            .then((data: FAData) => {
                if (cancelled) return;
                setFaData((current) => ({ ...current, ...data }));
                missingTypes.forEach((type) => loadedTypesRef.current.add(type));
            })
            .catch(() => undefined)
            .finally(() => {
                if (cancelled) return;
                setLoadingTypes((current) => {
                    const next = new Set(current);
                    missingTypes.forEach((type) => next.delete(type));
                    return next;
                });
            });

        return () => { cancelled = true; };
    }, [activeFaKey, activeFaTypes]);

    const faLoading = activeFaTypes.some((type) => loadingTypes.has(type));

    const selectTv = (sym: string, tab?: VietnamSubTabId) => {
        if (tab) setActiveSubTab(tab);
        setSelected((prev) => prev?.kind === 'tv' && prev.key === sym ? null : { kind: 'tv', key: sym });
    };

    const selectFa = (ind: FAIndicator, type: string) => {
        setSelected((prev) => prev?.kind === 'fa' && prev.key === ind.id ? null : { kind: 'fa', key: ind.id, type });
    };

    const activeFaIndicators = activeFaTypes.flatMap((type) => (faData[type] ?? []).map((ind) => ({ ind, type })));
    const selectedFa = selected?.kind === 'fa'
        ? (faData[selected.type] ?? []).find((ind) => ind.id === selected.key) ?? null
        : null;
    const isKeyStatSelected = selected?.kind === 'tv' && KEY_STATS.some(({ sym }) => sym === selected.key);

    return (
        <div className="space-y-8">
            <section>
                <SectionHeader
                    title="Key Stats Việt Nam"
                    subtitle="Tóm tắt nhanh các chỉ số chính. Chọn một card để xem lịch sử và chi tiết."
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    {KEY_STATS.map(({ sym, tab }) => (
                        <TVStatCard
                            key={sym}
                            sym={sym}
                            selected={selected?.kind === 'tv' && selected.key === sym}
                            onClick={() => selectTv(sym, tab)}
                        />
                    ))}
                </div>
                {isKeyStatSelected && selected?.kind === 'tv' && (
                    <div className="mt-4">
                        <TVDetailPanel key={selected.key} sym={selected.key} />
                    </div>
                )}
            </section>

            <section className="space-y-4">
                <SectionHeader
                    title="Bộ Chỉ Số Việt Nam"
                    subtitle={VIETNAM_SUBTABS.find((tab) => tab.id === activeSubTab)?.subtitle ?? ''}
                />
                <div className="flex flex-wrap gap-2">
                    {VIETNAM_SUBTABS.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveSubTab(tab.id)}
                            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                                activeSubTab === tab.id
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-blue-300 dark:hover:border-blue-700'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {activeSubTab === 'growth' && (
                    <LazySection className="mb-4">
                        <GDPCompositionChart />
                    </LazySection>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {VIETNAM_TAB_TV[activeSubTab].map((sym) => (
                        <TVStatCard
                            key={sym}
                            sym={sym}
                            selected={selected?.kind === 'tv' && selected.key === sym}
                            onClick={() => selectTv(sym)}
                        />
                    ))}

                    {!faLoading && activeFaIndicators.map(({ ind, type }) => (
                        <FAStatCard
                            key={ind.id}
                            ind={ind}
                            selected={selected?.kind === 'fa' && selected.key === ind.id}
                            onClick={() => selectFa(ind, type)}
                        />
                    ))}

                    {faLoading && VIETNAM_TAB_TV[activeSubTab].length === 0 && (
                        Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={`fa-skeleton-${i}`} />)
                    )}
                </div>

                {selected?.kind === 'tv' && !isKeyStatSelected && (
                    <div className="mt-4">
                        <TVDetailPanel key={selected.key} sym={selected.key} />
                    </div>
                )}

                {selectedFa && selected?.kind === 'fa' && (
                    <div className="mt-4">
                        <FADetailPanel ind={selectedFa} color={FA_COLORS[selected.type] ?? 'blue'} />
                    </div>
                )}
            </section>
        </div>
    );
}

// ── World Tab — isolated component so WS subs don't affect Vietnam tab ────────

function WorldTab() {
    const [rates, setRates]         = useState<RatesData | null>(null);
    const [ratesLoading, setRL]     = useState(true);
    const [ffForex, setFfForex]     = useState<Map<string, FFPrice>>(new Map());
    const [ffIndices, setFfIndices] = useState<Map<string, FFPrice>>(new Map());

    const loadRates = useCallback(async () => {
        try { const r = await fetch(API.MACRO_RATES); if (r.ok) setRates(await r.json()); }
        catch { /* ignore */ } finally { setRL(false); }
    }, []);

    useEffect(() => {
        loadRates();
        const t = setInterval(loadRates, RATES_REFRESH_MS);

        const ws = getFFWS();
        const commodityUnsubs = Object.keys(FF_TO_YAHOO).map(ch =>
            ws.subscribe(ch, (snap: FFPrice) => {
                const yahooSym = FF_TO_YAHOO[ch];
                setRates(prev => {
                    if (!prev) return prev;
                    const updated = prev.commodities.map(item => {
                        if (item.symbol !== yahooSym) return item;
                        const change = snap.dayOpen > 0 ? snap.price - snap.dayOpen : item.change;
                        return { ...item, price: snap.price, change, changePercent: snap.changePercent };
                    });
                    return { ...prev, commodities: updated };
                });
            })
        );
        const forexUnsubs   = FF_FOREX_CHANNELS.map(def =>
            ws.subscribe(def.channel, (snap: FFPrice) => setFfForex(prev => new Map(prev).set(def.channel, snap)))
        );
        const indicesUnsubs = FF_ALL_INDEX_CHANNELS.map(def =>
            ws.subscribe(def.channel, (snap: FFPrice) => setFfIndices(prev => new Map(prev).set(def.channel, snap)))
        );

        return () => {
            clearInterval(t);
            [...commodityUnsubs, ...forexUnsubs, ...indicesUnsubs].forEach(fn => fn());
        };
    }, [loadRates]);

    const fxRates     = rates?.exchange_rates ?? [];
    const commodities = rates?.commodities    ?? [];
    const sess        = getMarketSessions();

    return (
        <div className="space-y-10">

            {/* VND Exchange Rates */}
            <section>
                <SectionHeader title="Tỷ Giá Hối Đoái VND" subtitle="VND so với các đồng tiền chính" />
                {ratesLoading
                    ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
                    : fxRates.length === 0
                    ? <p className="text-sm text-slate-500 py-6">Không lấy được dữ liệu tỷ giá.</p>
                    : <CardGrid items={fxRates} isVnd={true} />}
            </section>

            {/* Forex */}
            <section>
                <SectionHeader title="Ngoại Hối Quốc Tế" subtitle="Các cặp tiền tệ chính" />
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
                    {FF_FOREX_CHANNELS.map(def => (
                        <FFLiveCard key={def.channel} def={def} snap={ffForex.get(def.channel)} />
                    ))}
                </div>
            </section>

            {/* Asia-Pacific */}
            <section>
                <div className="flex items-center gap-3 mb-4">
                    <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Châu Á - Thái Bình Dương</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Tokyo 7:00–13:30 · Sydney 7:00–13:00 (giờ VN)</p>
                    </div>
                    <SessionBadge open={sess.asia} tz="07:00–13:30" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {FF_ASIA_CHANNELS.map(def => (
                        <FFLiveCard key={def.channel} def={def} snap={ffIndices.get(def.channel)} />
                    ))}
                </div>
            </section>

            {/* Europe */}
            <section>
                <div className="flex items-center gap-3 mb-4">
                    <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Châu Âu</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Frankfurt/London 14:00–22:30 (giờ VN)</p>
                    </div>
                    <SessionBadge open={sess.europe} tz="14:00–22:30" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {FF_EUROPE_CHANNELS.map(def => (
                        <FFLiveCard key={def.channel} def={def} snap={ffIndices.get(def.channel)} />
                    ))}
                </div>
            </section>

            {/* Americas */}
            <section>
                <div className="flex items-center gap-3 mb-4">
                    <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Châu Mỹ</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">NYSE/NASDAQ 20:30–03:00 (giờ VN)</p>
                    </div>
                    <SessionBadge open={sess.americas} tz="20:30–03:00" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                    {FF_AMERICAS_CHANNELS.map(def => (
                        <FFLiveCard key={def.channel} def={def} snap={ffIndices.get(def.channel)} />
                    ))}
                </div>
            </section>

            {/* Commodities */}
            <section>
                <SectionHeader title="Hàng Hóa Quốc Tế" subtitle="Live: Forex Factory · lịch sử: Yahoo Finance" />
                {ratesLoading
                    ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
                    : commodities.length === 0
                    ? <p className="text-sm text-slate-500 py-6">Không lấy được dữ liệu hàng hóa.</p>
                    : <CardGrid items={commodities} isVnd={false} />}
            </section>
        </div>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type TabId = 'vietnam' | 'world';

const TAB_LABELS: { id: TabId; label: string }[] = [
    { id: 'vietnam',  label: 'Việt Nam' },
    { id: 'world',    label: 'Thế Giới' },
];

export default function MacroPage() {
    const [activeTab, setActiveTab] = useState<TabId>('vietnam');

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
            <div className="max-w-[1600px] mx-auto p-4 md:p-6 space-y-6 md:space-y-8">

                {/* Header */}
                <header className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-5 py-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:px-7 sm:py-7">
                    <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-blue-500/10 blur-3xl dark:bg-blue-500/15" />
                    <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                        <div className="max-w-3xl">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">Market intelligence</p>
                            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
                                Kinh tế <span className="text-blue-600 dark:text-blue-400">vĩ mô</span>
                            </h1>
                            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                                Theo dõi các chỉ số Việt Nam và toàn cầu, với dữ liệu nguồn rõ ràng và biểu đồ chi tiết khi cần.
                            </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
                            FireAnt · TradingView · Yahoo Finance · Forex Factory
                        </div>
                    </div>

                    <div className="relative mt-6 flex w-full gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/70 sm:w-fit">
                        {TAB_LABELS.map(tab => (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                                className={`flex-1 rounded-lg px-5 py-2 text-sm font-semibold transition-all duration-150 sm:flex-none
                                    ${activeTab === tab.id
                                        ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-900 dark:text-blue-400'
                                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'}`}>
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </header>

                {/* ── Vietnam Tab ── */}
                {activeTab === 'vietnam' && <VietnamMacroTab />}

                {/* ── World Tab ── */}
                {activeTab === 'world' && <WorldTab />}

            </div>
        </div>
    );
}
