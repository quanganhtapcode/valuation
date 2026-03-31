'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AreaChart, BarChart, Card } from '@tremor/react';
import { API } from '@/lib/api';
import { getFFWS, FFPrice } from '@/lib/ffWS';

// ── Downsample: keep last N points for display ────────────────────────────────
// Recharts tooltip is O(n) on every mousemove — capping at 60 pts kills lag.
const MAX_MONTHLY  = 60;   // 5 years of monthly data
const MAX_QUARTERLY = 40;  // 10 years of quarterly
const MAX_ANNUAL   = 40;   // all annual (rarely > 40)
const MAX_DAILY    = 66;   // ~3 months of daily

function downsample<T>(arr: T[], max: number): T[] {
    return arr.length > max ? arr.slice(arr.length - max) : arr;
}

function limitByFreq<T>(arr: T[], freq: string): T[] {
    if (freq.includes('ngày') || freq.includes('ngay')) return downsample(arr, MAX_DAILY);
    if (freq.includes('tháng') || freq.includes('thang')) return downsample(arr, MAX_MONTHLY);
    if (freq.includes('quý') || freq.includes('Quý')) return downsample(arr, MAX_QUARTERLY);
    return downsample(arr, MAX_ANNUAL);
}

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

// ── Types ─────────────────────────────────────────────────────────────────────

interface RateItem {
    symbol: string;
    name: string;
    price: number;
    change: number;
    changePercent: number;
    unit?: string;
}
interface CpiPoint   { date: string; value: number }
interface GdpPoint   { date: string; quarter: string; value: number }
interface Vn10yPoint { date: string; value: number }
interface PricePoint { date: string; close: number }

interface RatesData {
    exchange_rates: RateItem[];
    commodities:    RateItem[];
}
interface EconomicData {
    cpi:   CpiPoint[];
    gdp:   GdpPoint[];
    vn10y: Vn10yPoint[];
}

// FireAnt types
interface FAIndicator {
    id: number;
    nameVN: string;
    name: string;
    unit: string;
    frequency: string;
    lastValue: number | null;
    lastDate: string;
    data: { date: string; value: number }[];
}
type FAData = Record<string, FAIndicator[]>;   // type → indicators[]

const RANGE_OPTIONS = [
    { label: '1T', days: 30 },
    { label: '3T', days: 90 },
    { label: '6T', days: 180 },
    { label: '1N', days: 365 },
    { label: '3N', days: 1095 },
] as const;

const RATES_REFRESH_MS = 5 * 60 * 1000;

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtVndPrice(val: number) {
    if (val >= 1000) return val.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (val >= 10)   return val.toFixed(2);
    return val.toFixed(4);
}
function fmtUsdPrice(val: number) {
    if (val >= 1000) return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return val.toFixed(2);
}
function fmtVndChange(val: number) {
    const abs = Math.abs(val);
    return `${val >= 0 ? '+' : '-'}${abs >= 10 ? abs.toFixed(0) : abs.toFixed(2)}`;
}
function fmtUsdChange(val: number) {
    return `${val >= 0 ? '+' : '-'}${Math.abs(val).toFixed(2)}`;
}
function fmtMonth(date: string) {
    const [y, m] = date.split('-');
    return `T${parseInt(m)}/${y.slice(2)}`;
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

function downloadFACsv(filename: string, headers: string[], rows: (string | number)[][]) {
    const body = rows.map(r => r.join(',')).join('\n');
    const blob  = new Blob([`${headers.join(',')}\n${body}`], { type: 'text/csv;charset=utf-8;' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}

function CsvButton({ onClick }: { onClick: () => void }) {
    return (
        <button onClick={onClick} title="Tải CSV"
            className="flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors shrink-0">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            CSV
        </button>
    );
}

function HistoryChart({ item, isVnd, onClose }: { item: RateItem; isVnd: boolean; onClose: () => void }) {
    const [days, setDays]       = useState(365);
    const [points, setPoints]   = useState<PricePoint[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async (d: number) => {
        setLoading(true);
        try {
            const res = await fetch(API.MACRO_HISTORY(item.symbol, d));
            if (res.ok) setPoints(await res.json());
        } catch (_) {}
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
            <Card className="p-5">
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
                        tickGap={60} className="h-48" />}
            </Card>
        </div>
    );
}

// ── FF live channel definitions ───────────────────────────────────────────────

const FF_FOREX_CHANNELS = [
    { channel: 'EUR/USD',  label: 'EUR/USD',  fmt: (p: number) => p.toFixed(4) },
    { channel: 'GBP/USD',  label: 'GBP/USD',  fmt: (p: number) => p.toFixed(4) },
    { channel: 'USD/JPY',  label: 'USD/JPY',  fmt: (p: number) => p.toFixed(2) },
    { channel: 'AUD/USD',  label: 'AUD/USD',  fmt: (p: number) => p.toFixed(4) },
    { channel: 'USD/CHF',  label: 'USD/CHF',  fmt: (p: number) => p.toFixed(4) },
    { channel: 'USD/CAD',  label: 'USD/CAD',  fmt: (p: number) => p.toFixed(4) },
    { channel: 'NZD/USD',  label: 'NZD/USD',  fmt: (p: number) => p.toFixed(4) },
] as const;

const FF_INDICES_CHANNELS = [
    { channel: 'SPX/USD',    label: 'S&P 500',    fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
    { channel: 'NDX/USD',    label: 'Nasdaq 100', fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
    { channel: 'Dow/USD',    label: 'Dow Jones',  fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
    { channel: 'VIX/USD',    label: 'VIX',        fmt: (p: number) => p.toFixed(2) },
    { channel: 'DXY/USD',    label: 'USD Index',  fmt: (p: number) => p.toFixed(2) },
    { channel: 'Nikkei/JPY', label: 'Nikkei 225', fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) },
] as const;

interface FFCardDef { channel: string; label: string; fmt: (p: number) => string }

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

// ── Y-axis width: auto-size based on longest label ───────────────────────────
function calcYAxisWidth(values: number[], fmt: (v: number) => string): number {
    if (!values.length) return 56;
    const maxLen = Math.max(...values.map(v => fmt(v).length));
    return Math.max(44, Math.min(96, maxLen * 7 + 10));
}

// ── investing.com charts (CPI + VN10Y) ───────────────────────────────────────

function EcoChartCard({ title, subtitle, latest, latestLabel, delta, onDownload, children }: {
    title: string; subtitle: string; latest: number | null;
    latestLabel: string; delta: number | null; onDownload?: () => void; children: React.ReactNode;
}) {
    return (
        <Card className="p-5">
            <div className="flex items-start justify-between mb-1">
                <div className="min-w-0">
                    <p className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">{title}</p>
                    <p className="text-xs text-tremor-content dark:text-dark-tremor-content mt-0.5">{subtitle}</p>
                </div>
                <div className="flex items-start gap-2 shrink-0 ml-3">
                    {onDownload && <CsvButton onClick={onDownload} />}
                    {latest !== null && (
                        <div className="text-right">
                            <p className="text-2xl font-bold tabular-nums text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                {latest.toFixed(2)}%
                            </p>
                            <p className="text-[11px] text-tremor-content dark:text-dark-tremor-content">
                                {latestLabel}
                                {delta !== null && (
                                    <span className={`ml-1.5 font-semibold ${delta >= 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                                        {delta >= 0 ? '+' : ''}{delta.toFixed(2)}
                                    </span>
                                )}
                            </p>
                        </div>
                    )}
                </div>
            </div>
            {children}
        </Card>
    );
}

function CpiChart({ data }: { data: CpiPoint[] }) {
    const latest = data.at(-1) ?? null;
    const prev   = data.at(-2) ?? null;
    const delta  = latest && prev ? latest.value - prev.value : null;
    const step   = Math.max(1, Math.floor(data.length / 10));
    const chartData = data.map((p, i) => ({
        Tháng: (i % step === 0 || i === data.length - 1) ? fmtMonth(p.date) : '',
        'CPI (%)': p.value,
    }));
    return (
        <EcoChartCard title="Lạm phát CPI — YoY (%)" subtitle="Hàng tháng — nguồn: investing.com"
            latest={latest?.value ?? null} latestLabel={latest ? fmtMonth(latest.date) : ''} delta={delta}
            onDownload={data.length ? () => downloadFACsv('cpi.csv', ['Date','CPI_%'], data.map(p => [p.date, p.value])) : undefined}>
            {chartData.length === 0
                ? <div className="h-56 flex items-center justify-center text-sm text-tremor-content dark:text-dark-tremor-content mt-4">Không có dữ liệu</div>
                : <AreaChart data={chartData} index="Tháng" categories={['CPI (%)']} colors={['rose']}
                    valueFormatter={(v) => `${v.toFixed(2)}%`}
                    yAxisWidth={calcYAxisWidth(data.map(p => p.value), (v) => `${v.toFixed(2)}%`)}
                    showLegend={false} showGradient autoMinValue className="h-56 mt-4" />}
        </EcoChartCard>
    );
}

function Vn10yChart({ data }: { data: Vn10yPoint[] }) {
    const latest = data.at(-1) ?? null;
    const prev   = data.at(-2) ?? null;
    const delta  = latest && prev ? latest.value - prev.value : null;
    const step   = Math.max(1, Math.floor(data.length / 10));
    const chartData = data.map((p, i) => ({
        Tháng: (i % step === 0 || i === data.length - 1) ? fmtMonth(p.date) : '',
        'Lợi suất (%)': p.value,
    }));
    return (
        <EcoChartCard title="Lợi suất TPCP 10 năm (%)" subtitle="Trái phiếu chính phủ VN — nguồn: investing.com"
            latest={latest?.value ?? null} latestLabel={latest ? fmtMonth(latest.date) : ''} delta={delta}
            onDownload={data.length ? () => downloadFACsv('vn10y.csv', ['Date','Yield_%'], data.map(p => [p.date, p.value])) : undefined}>
            {chartData.length === 0
                ? <div className="h-56 flex items-center justify-center text-sm text-tremor-content dark:text-dark-tremor-content mt-4">Không có dữ liệu</div>
                : <AreaChart data={chartData} index="Tháng" categories={['Lợi suất (%)']} colors={['blue']}
                    valueFormatter={(v) => `${v.toFixed(2)}%`}
                    yAxisWidth={calcYAxisWidth(data.map(p => p.value), (v) => `${v.toFixed(2)}%`)}
                    showLegend={false} showGradient autoMinValue className="h-56 mt-4" />}
        </EcoChartCard>
    );
}

// ── FireAnt indicator charts ──────────────────────────────────────────────────

function FAChart({ ind, color, barChart }: { ind: FAIndicator; color: string; barChart?: boolean }) {
    const latest = ind.data.at(-1) ?? null;
    const prev   = ind.data.at(-2) ?? null;
    const delta  = latest && prev ? latest.value - prev.value : null;
    const up     = delta === null ? true : delta >= 0;
    const isGrowth = ind.unit === '%';
    const fmt = (v: number) => isGrowth
        ? `${v.toFixed(2)}%`
        : Math.abs(v) >= 1000
            ? v.toLocaleString('en-US', { maximumFractionDigits: 0 })
            : v.toLocaleString('en-US', { maximumFractionDigits: 2 });

    const displayData = limitByFreq(ind.data, ind.frequency ?? '');
    const chartData = displayData.map(p => ({ 'Kỳ': p.date, [ind.nameVN]: p.value }));
    const yAxisWidth = calcYAxisWidth(displayData.map(p => p.value), fmt);
    const tickGap = ind.frequency?.includes('tháng') ? 24
        : ind.frequency?.includes('quý') || ind.frequency?.includes('Quý') ? 12
        : 4;

    const slug = ind.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const handleDownload = () => downloadFACsv(
        `${slug}.csv`,
        ['Date', `${ind.name} (${ind.unit})`],
        ind.data.map(p => [p.date, p.value]),
    );

    return (
        <Card className="p-5">
            <div className="flex items-start justify-between mb-1">
                <div className="min-w-0 flex-1">
                    <p className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong text-sm truncate">{ind.nameVN}</p>
                    <p className="text-xs text-tremor-content dark:text-dark-tremor-content mt-0.5">FireAnt · {ind.unit}</p>
                </div>
                <div className="flex items-start gap-2 shrink-0 ml-3">
                    {ind.data.length > 0 && <CsvButton onClick={handleDownload} />}
                    {latest && (
                        <div className="text-right">
                            <p className="text-xl font-bold tabular-nums text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                {fmt(latest.value)}
                            </p>
                            <p className="text-[11px] text-tremor-content dark:text-dark-tremor-content">
                                {latest.date}
                                {delta !== null && (
                                    <span className={`ml-1.5 font-semibold ${up ? 'text-emerald-500' : 'text-rose-500'}`}>
                                        {up ? '+' : ''}{delta.toFixed(2)}
                                    </span>
                                )}
                            </p>
                        </div>
                    )}
                </div>
            </div>
            {ind.data.length === 0
                ? <div className="h-48 flex items-center justify-center text-sm text-tremor-content dark:text-dark-tremor-content mt-4">Không có dữ liệu</div>
                : barChart
                    ? <BarChart data={chartData} index="Kỳ" categories={[ind.nameVN]} colors={[color]}
                        valueFormatter={fmt} yAxisWidth={yAxisWidth} showLegend={false}
                        showAnimation={false} tickGap={tickGap} className="h-48 mt-4" />
                    : <AreaChart data={chartData} index="Kỳ" categories={[ind.nameVN]} colors={[color]}
                        valueFormatter={fmt} yAxisWidth={yAxisWidth}
                        showLegend={false} showGradient autoMinValue
                        showAnimation={false} tickGap={tickGap} className="h-48 mt-4" />
            }
        </Card>
    );
}

function TradeChart({ exp, imp, bal }: { exp: FAIndicator; imp: FAIndicator; bal: FAIndicator }) {
    const last = bal.data.at(-1);
    const prev = bal.data.at(-2);
    const delta = last && prev ? last.value - prev.value : null;
    const impMap = new Map(imp.data.map(p => [p.date, p.value]));
    const combined = downsample(
        exp.data
            .filter(p => impMap.has(p.date))
            .map(p => ({ 'Tháng': p.date, 'Xuất khẩu': p.value, 'Nhập khẩu': impMap.get(p.date)! })),
        MAX_MONTHLY,
    );
    const tradeFmt = (v: number) => `${v.toFixed(1)} tỷ`;
    const tradeYAxisWidth = calcYAxisWidth(
        combined.flatMap(p => [p['Xuất khẩu'], p['Nhập khẩu']]),
        tradeFmt,
    );

    const handleDownload = () => downloadFACsv(
        'trade_exports_imports.csv',
        ['Date', 'Exports_BillionUSD', 'Imports_BillionUSD', 'Balance_BillionUSD'],
        exp.data.map(p => [p.date, p.value, impMap.get(p.date) ?? '', (p.value - (impMap.get(p.date) ?? 0)).toFixed(2)]),
    );

    return (
        <Card className="p-5">
            <div className="flex items-start justify-between mb-1">
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong text-sm">Xuất & Nhập khẩu</p>
                    <p className="text-xs text-tremor-content dark:text-dark-tremor-content mt-0.5">FireAnt · Tỷ USD · hàng tháng</p>
                </div>
                <div className="flex items-start gap-2 shrink-0 ml-3">
                    {combined.length > 0 && <CsvButton onClick={handleDownload} />}
                    {last && (
                        <div className="text-right">
                            <p className={`text-xl font-bold tabular-nums ${last.value >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {last.value >= 0 ? '+' : ''}{last.value.toFixed(2)} tỷ
                            </p>
                            <p className="text-[11px] text-tremor-content dark:text-dark-tremor-content">
                                Cán cân {last.date}
                                {delta !== null && (
                                    <span className={`ml-1.5 font-semibold ${delta >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                        {delta >= 0 ? '+' : ''}{delta.toFixed(2)}
                                    </span>
                                )}
                            </p>
                        </div>
                    )}
                </div>
            </div>
            {combined.length === 0
                ? <div className="h-48 flex items-center justify-center text-sm text-tremor-content dark:text-dark-tremor-content mt-4">Không có dữ liệu</div>
                : <AreaChart data={combined} index="Tháng"
                    categories={['Xuất khẩu', 'Nhập khẩu']} colors={['emerald', 'rose']}
                    valueFormatter={tradeFmt} yAxisWidth={tradeYAxisWidth}
                    showLegend={true} showGradient={false} autoMinValue
                    showAnimation={false} tickGap={24} className="h-48 mt-4" />}
        </Card>
    );
}

// Grid of FireAnt charts for a given type
const FA_COLORS: Record<string, string> = {
    GDP: 'emerald', Prices: 'rose', Trade: 'blue', Labour: 'violet',
    Money: 'amber', Consumer: 'cyan', Business: 'orange', InterestRate: 'indigo', Taxes: 'gray',
};

function FASection({ title, subtitle, indicators, type }: {
    title: string; subtitle: string; indicators: FAIndicator[]; type: string;
}) {
    if (!indicators.length) return null;
    const color = FA_COLORS[type] ?? 'blue';
    const expInd = indicators.find(i => i.id === 59);
    const impInd = indicators.find(i => i.id === 62);
    const balInd = indicators.find(i => i.id === 54);
    const otherInds = type === 'Trade'
        ? indicators.filter(i => ![54, 59, 62].includes(i.id))
        : indicators;

    return (
        <section>
            <SectionHeader title={title} subtitle={subtitle} />
            <div className="space-y-4">
                {type === 'Trade' && expInd && impInd && balInd && (
                    <LazySection>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <TradeChart exp={expInd} imp={impInd} bal={balInd} />
                            {otherInds.length > 0 && <FAChart ind={otherInds[0]} color={color} />}
                        </div>
                    </LazySection>
                )}
                {type === 'Trade' && otherInds.slice(type === 'Trade' ? 1 : 0).length > 0 && (
                    <LazySection>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {otherInds.slice(1).map(ind => <FAChart key={ind.id} ind={ind} color={color} />)}
                        </div>
                    </LazySection>
                )}
                {type !== 'Trade' && (
                    <LazySection>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {otherInds.map(ind => <FAChart key={ind.id} ind={ind} color={color} />)}
                        </div>
                    </LazySection>
                )}
            </div>
        </section>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type TabId = 'vietnam' | 'world';

const TAB_LABELS: { id: TabId; label: string }[] = [
    { id: 'vietnam', label: 'Việt Nam' },
    { id: 'world',   label: 'Thế Giới' },
];

export default function MacroPage() {
    const [activeTab, setActiveTab] = useState<TabId>('vietnam');

    // World data
    const [rates, setRates]         = useState<RatesData | null>(null);
    const [economic, setEconomic]   = useState<EconomicData | null>(null);
    const [ratesLoading, setRL]     = useState(true);
    const [economicLoading, setEL]  = useState(true);
    const [ffForex, setFfForex]     = useState<Map<string, FFPrice>>(new Map());
    const [ffIndices, setFfIndices] = useState<Map<string, FFPrice>>(new Map());

    // Vietnam data (FireAnt)
    const [faData, setFaData]       = useState<FAData>({});
    const [faLoading, setFaL]       = useState(true);

    const FF_TO_YAHOO: Record<string, string> = {
        'Gold/USD': 'GC=F', 'WTI/USD': 'CL=F', 'Copper/USD': 'HG=F',
    };

    // FF WebSocket (world tab)
    useEffect(() => {
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
        const indicesUnsubs = FF_INDICES_CHANNELS.map(def =>
            ws.subscribe(def.channel, (snap: FFPrice) => setFfIndices(prev => new Map(prev).set(def.channel, snap)))
        );
        return () => { [...commodityUnsubs, ...forexUnsubs, ...indicesUnsubs].forEach(fn => fn()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadRates    = useCallback(async () => {
        try { const r = await fetch(API.MACRO_RATES);    if (r.ok) setRates(await r.json()); }
        catch (_) {} finally { setRL(false); }
    }, []);
    const loadEconomic = useCallback(async () => {
        try { const r = await fetch(API.MACRO_ECONOMIC); if (r.ok) setEconomic(await r.json()); }
        catch (_) {} finally { setEL(false); }
    }, []);
    const loadFaData   = useCallback(async () => {
        try { const r = await fetch(API.MACRO_FIREANT()); if (r.ok) setFaData(await r.json()); }
        catch (_) {} finally { setFaL(false); }
    }, []);

    useEffect(() => {
        loadRates(); loadEconomic(); loadFaData();
        const t = setInterval(loadRates, RATES_REFRESH_MS);
        return () => clearInterval(t);
    }, [loadRates, loadEconomic, loadFaData]);

    const fxRates     = rates?.exchange_rates ?? [];
    const commodities = rates?.commodities    ?? [];
    const cpi         = economic?.cpi         ?? [];
    const vn10y       = economic?.vn10y       ?? [];

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
            <div className="max-w-[1600px] mx-auto p-4 md:p-6 space-y-8">

                {/* Header */}
                <div>
                    <h1 className="text-3xl md:text-4xl font-bold leading-tight tracking-tight">
                        Kinh Tế <span className="text-blue-600 dark:text-blue-400">Vĩ Mô</span>
                    </h1>
                    <div className="w-28 h-1 bg-blue-500 rounded mt-2" />
                    <p className="text-slate-600 dark:text-slate-300 mt-3 text-sm md:text-base max-w-3xl">
                        Tổng hợp các chỉ số kinh tế vĩ mô Việt Nam và thế giới — dữ liệu từ FireAnt, Yahoo Finance và Forex Factory.
                    </p>
                </div>

                {/* Tab switcher */}
                <div className="flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/60 w-fit">
                    {TAB_LABELS.map(tab => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                            className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all duration-150
                                ${activeTab === tab.id
                                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'}`}>
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* ── Vietnam Tab ── */}
                {activeTab === 'vietnam' && (
                    <div className="space-y-10">
                        {faLoading ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                {Array.from({ length: 6 }).map((_, i) => <SkeletonChart key={i} />)}
                            </div>
                        ) : (
                            <>
                                <FASection title="GDP Việt Nam" subtitle="Nguồn: FireAnt / Ngân hàng Thế giới & GSO"
                                    indicators={faData['GDP'] ?? []} type="GDP" />
                                <FASection title="Giá Cả & Lạm Phát" subtitle="Nguồn: FireAnt / GSO"
                                    indicators={faData['Prices'] ?? []} type="Prices" />
                                <FASection title="Thương Mại & Đầu Tư" subtitle="Nguồn: FireAnt / Hải quan Việt Nam"
                                    indicators={faData['Trade'] ?? []} type="Trade" />
                                <FASection title="Thị Trường Tiền Tệ" subtitle="Nguồn: FireAnt / NHNN"
                                    indicators={faData['Money'] ?? []} type="Money" />
                                <FASection title="Lãi Suất Liên Ngân Hàng" subtitle="Nguồn: FireAnt / NHNN"
                                    indicators={faData['InterestRate'] ?? []} type="InterestRate" />
                                <FASection title="Lao Động & Việc Làm" subtitle="Nguồn: FireAnt / GSO"
                                    indicators={faData['Labour'] ?? []} type="Labour" />
                                <FASection title="Sản Xuất & Kinh Doanh" subtitle="Nguồn: FireAnt / S&P Global PMI"
                                    indicators={faData['Business'] ?? []} type="Business" />
                                <FASection title="Tiêu Dùng" subtitle="Nguồn: FireAnt / GSO"
                                    indicators={faData['Consumer'] ?? []} type="Consumer" />

                                {/* CPI + VN10Y from investing.com as supplement */}
                                <section>
                                    <SectionHeader title="Chỉ Số Bổ Sung"
                                        subtitle="CPI YoY và lợi suất TPCP 10 năm — nguồn: investing.com" />
                                    {economicLoading
                                        ? <div className="grid grid-cols-1 lg:grid-cols-2 gap-4"><SkeletonChart /><SkeletonChart /></div>
                                        : <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                            <CpiChart data={cpi} />
                                            <Vn10yChart data={vn10y} />
                                          </div>}
                                </section>
                            </>
                        )}
                    </div>
                )}

                {/* ── World Tab ── */}
                {activeTab === 'world' && (
                    <div className="space-y-10">
                        <section>
                            <SectionHeader title="Tỷ Giá Hối Đoái" subtitle="VND so với các đồng tiền chính — nguồn: Yahoo Finance" />
                            {ratesLoading
                                ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
                                : fxRates.length === 0
                                ? <p className="text-sm text-slate-500 py-6">Không lấy được dữ liệu tỷ giá.</p>
                                : <CardGrid items={fxRates} isVnd={true} />}
                        </section>

                        <section>
                            <SectionHeader title="Ngoại Hối Quốc Tế" subtitle="Các cặp tiền tệ chính — live: Forex Factory" />
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
                                {FF_FOREX_CHANNELS.map(def => (
                                    <FFLiveCard key={def.channel} def={def} snap={ffForex.get(def.channel)} />
                                ))}
                            </div>
                        </section>

                        <section>
                            <SectionHeader title="Chỉ Số Chứng Khoán Thế Giới" subtitle="Chỉ số các thị trường lớn — live: Forex Factory" />
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                                {FF_INDICES_CHANNELS.map(def => (
                                    <FFLiveCard key={def.channel} def={def} snap={ffIndices.get(def.channel)} />
                                ))}
                            </div>
                        </section>

                        <section>
                            <SectionHeader title="Hàng Hóa Quốc Tế"
                                subtitle="Giá hàng hóa liên quan đến doanh nghiệp VN — live: Forex Factory · khởi tạo: Yahoo Finance" />
                            {ratesLoading
                                ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
                                : commodities.length === 0
                                ? <p className="text-sm text-slate-500 py-6">Không lấy được dữ liệu hàng hóa.</p>
                                : <CardGrid items={commodities} isVnd={false} />}
                            {!ratesLoading && (
                                <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                                    Brent ảnh hưởng GAS, PVD, PLX · Đồng → REE, điện · Gạo → LTG, NSC · Vàng → SJC, PNJ
                                </p>
                            )}
                        </section>
                    </div>
                )}

            </div>
        </div>
    );
}
