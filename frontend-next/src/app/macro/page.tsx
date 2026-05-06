'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AreaChart, BarChart, Card } from '@tremor/react';
import { API } from '@/lib/api';
import { getFFWS, FFPrice } from '@/lib/ffWS';

// ── Downsample: keep last N points for display ────────────────────────────────
// Recharts tooltip is O(n) on every mousemove — keep points low to avoid lag.
const MAX_MONTHLY  = 36;   // 3 years of monthly data
const MAX_QUARTERLY = 20;  // 5 years of quarterly
const MAX_ANNUAL   = 20;   // 20 years annual
const MAX_DAILY    = 60;   // ~3 months of daily

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
interface PricePoint { date: string; close: number }

interface RatesData {
    exchange_rates: RateItem[];
    commodities:    RateItem[];
}

// FireAnt types
interface FAIndicator {
    id: number;
    nameVN: string;
    name: string;
    unit: string;
    frequency: string;
    source?: string;
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

function HistoryChart({ item, isVnd, onClose }: { item: RateItem; isVnd: boolean; onClose: () => void }) {
    const [days, setDays]       = useState(365);
    const [points, setPoints]   = useState<PricePoint[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async (d: number) => {
        setLoading(true);
        try {
            const res = await fetch(API.MACRO_HISTORY(item.symbol, d));
            if (res.ok) setPoints(await res.json());
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
                        showAnimation={false} tickGap={60} className="h-48" />}
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

const FF_ASIA_CHANNELS = [
    { channel: 'Nikkei225/USD', label: 'Nikkei 225', fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
    { channel: 'ASX/USD',       label: 'ASX 200',    fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
] as const;

const FF_EUROPE_CHANNELS = [
    { channel: 'DAX/USD',     label: 'DAX',          fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
    { channel: 'FTSE100/USD', label: 'FTSE 100',     fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
    { channel: 'CAC/USD',     label: 'CAC 40',       fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
    { channel: 'STOXX50/USD', label: 'Euro Stoxx 50',fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
] as const;

const FF_AMERICAS_CHANNELS = [
    { channel: 'SPX/USD',    label: 'S&P 500',      fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
    { channel: 'NDX/USD',    label: 'Nasdaq 100',   fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
    { channel: 'Dow/USD',    label: 'Dow Jones',    fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
    { channel: 'US2000/USD', label: 'Russell 2000', fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
    { channel: 'VIX/USD',    label: 'VIX',          fmt: (p: number) => p.toFixed(2) },
    { channel: 'DXY/USD',    label: 'USD Index',    fmt: (p: number) => p.toFixed(2) },
] as const;

const FF_ALL_INDEX_CHANNELS = [...FF_ASIA_CHANNELS, ...FF_EUROPE_CHANNELS, ...FF_AMERICAS_CHANNELS];

// FF commodity → Yahoo symbol mapping
const FF_TO_YAHOO: Record<string, string> = {
    'Gold/USD': 'GC=F', 'WTI/USD': 'CL=F', 'Silver/USD': 'SI=F', 'Brent/USD': 'BZ=F',
};

// ── Market session detector ────────────────────────────────────────────────────
function getMarketSessions(): { asia: boolean; europe: boolean; americas: boolean } {
    const d = new Date();
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) return { asia: false, europe: false, americas: false };
    const t = d.getUTCHours() * 60 + d.getUTCMinutes();
    return {
        asia:     t < 390 || (t >= 1380 && dow !== 6),
        europe:   t >= 420 && t < 930,
        americas: t >= 810 && t < 1200,
    };
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

// ── TradingView chart card (generic — all 28 ECONOMICS symbols) ───────────────

const fmtPct     = (v: number) => `${v.toFixed(2)}%`;
const fmtBillUSD = (v: number) => `${(v / 1e9).toFixed(1)} tỷ $`;
const fmtTrVND   = (v: number) => `${(v / 1e12).toFixed(0)} nghìn tỷ ₫`;
const fmtMilVND  = (v: number) => `${(v / 1e6).toFixed(1)} triệu ₫`;
const fmtMilPpl  = (v: number) => `${(v / 1e6).toFixed(1)}M người`;
const fmtUSD     = (v: number) => `$${v.toFixed(0)}`;
const fmtUSDL    = (v: number) => `$${v.toFixed(2)}/L`;
const fmtIdx     = (v: number) => v.toFixed(2);

interface TVConfig {
    titleVN: string;
    source: string;
    fmt: (v: number) => string;
    unitLabel: string;
    defaultDays: number;
    color: string;
    barChart?: boolean;
    freq: 'daily' | 'monthly' | 'annual';
    compareLag?: number;
    compareLabel?: string;
}

const TV_CONFIGS: Record<string, TVConfig> = {
    // Rates
    'ECONOMICS:VNINBR': { titleVN: 'Lãi Suất Liên Ngân Hàng Qua Đêm', source: 'TradingView / NHNN · %/năm',
        fmt: fmtPct, unitLabel: '%/năm', defaultDays: 365, color: 'indigo', freq: 'daily', compareLag: 1, compareLabel: 'kỳ trước' },
    'ECONOMICS:VNINTR': { titleVN: 'Lãi Suất Chính Sách', source: 'TradingView / NHNN · %/năm',
        fmt: fmtPct, unitLabel: '%/năm', defaultDays: 1825, color: 'blue', barChart: true, freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNDIR': { titleVN: 'Lãi Suất Tiền Gửi', source: 'TradingView / WB · %/năm',
        fmt: fmtPct, unitLabel: '%/năm', defaultDays: 3650, color: 'violet', freq: 'annual', compareLag: 1, compareLabel: 'năm trước' },
    // GDP
    'ECONOMICS:VNGDPYY': { titleVN: 'Tăng Trưởng GDP (YoY)', source: 'TradingView / GSO · %/năm',
        fmt: fmtPct, unitLabel: '%/năm', defaultDays: 1825, color: 'emerald', barChart: true, freq: 'monthly', compareLag: 4, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNGDPCP': { titleVN: 'GDP Thực Tế (hàng quý)', source: 'TradingView / GSO · nghìn tỷ ₫',
        fmt: fmtTrVND, unitLabel: 'nghìn tỷ ₫', defaultDays: 1825, color: 'blue', freq: 'monthly', compareLag: 4, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNGDPS': { titleVN: 'GDP - Dịch Vụ', source: 'TradingView / GSO · nghìn tỷ ₫',
        fmt: fmtTrVND, unitLabel: 'nghìn tỷ ₫', defaultDays: 1825, color: 'cyan', freq: 'monthly', compareLag: 4, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNGDPMAN': { titleVN: 'GDP - Công Nghiệp', source: 'TradingView / GSO · nghìn tỷ ₫',
        fmt: fmtTrVND, unitLabel: 'nghìn tỷ ₫', defaultDays: 1825, color: 'orange', freq: 'monthly', compareLag: 4, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNGDPA': { titleVN: 'GDP - Nông Nghiệp', source: 'TradingView / GSO · nghìn tỷ ₫',
        fmt: fmtTrVND, unitLabel: 'nghìn tỷ ₫', defaultDays: 1825, color: 'lime', freq: 'monthly', compareLag: 4, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNGDPPC': { titleVN: 'GDP Bình Quân Đầu Người', source: 'TradingView / WB · USD',
        fmt: fmtUSD, unitLabel: 'USD', defaultDays: 3650, color: 'violet', freq: 'annual', compareLag: 1, compareLabel: 'năm trước' },
    'ECONOMICS:VNGNP': { titleVN: 'GNP', source: 'TradingView / WB · nghìn tỷ ₫',
        fmt: fmtTrVND, unitLabel: 'nghìn tỷ ₫', defaultDays: 3650, color: 'teal', freq: 'annual', compareLag: 1, compareLabel: 'năm trước' },
    'ECONOMICS:VNGFCF': { titleVN: 'Đầu Tư Tài Sản Cố Định', source: 'TradingView / WB · nghìn tỷ ₫',
        fmt: fmtTrVND, unitLabel: 'nghìn tỷ ₫', defaultDays: 3650, color: 'amber', freq: 'annual', compareLag: 1, compareLabel: 'năm trước' },
    // Prices
    'ECONOMICS:VNIRYY': { titleVN: 'Lạm Phát (YoY)', source: 'TradingView / GSO · %/năm',
        fmt: fmtPct, unitLabel: '%/năm', defaultDays: 1825, color: 'rose', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNCPI': { titleVN: 'Chỉ Số Giá Tiêu Dùng (CPI)', source: 'TradingView / GSO · chỉ số',
        fmt: fmtIdx, unitLabel: 'chỉ số', defaultDays: 1825, color: 'orange', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNFI': { titleVN: 'Lạm Phát Thực Phẩm', source: 'TradingView / GSO · %/năm',
        fmt: fmtPct, unitLabel: '%/năm', defaultDays: 1825, color: 'amber', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNCIR': { titleVN: 'Lạm Phát Lõi', source: 'TradingView / GSO · %/năm',
        fmt: fmtPct, unitLabel: '%/năm', defaultDays: 1825, color: 'red', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNGASP': { titleVN: 'Giá Xăng Dầu', source: 'TradingView / VN · USD/lít',
        fmt: fmtUSDL, unitLabel: 'USD/lít', defaultDays: 1095, color: 'yellow', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    // Money
    'ECONOMICS:VNFER': { titleVN: 'Dự Trữ Ngoại Hối', source: 'TradingView / NHNN · tỷ $',
        fmt: fmtBillUSD, unitLabel: 'tỷ $', defaultDays: 1825, color: 'emerald', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNM2': { titleVN: 'Cung Tiền M2', source: 'TradingView / WB · nghìn tỷ ₫',
        fmt: fmtTrVND, unitLabel: 'nghìn tỷ ₫', defaultDays: 3650, color: 'violet', freq: 'annual', compareLag: 1, compareLabel: 'năm trước' },
    // Trade
    'ECONOMICS:VNEXP': { titleVN: 'Xuất Khẩu', source: 'TradingView / Hải quan VN · tỷ $',
        fmt: fmtBillUSD, unitLabel: 'tỷ $', defaultDays: 1095, color: 'emerald', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNIMP': { titleVN: 'Nhập Khẩu', source: 'TradingView / Hải quan VN · tỷ $',
        fmt: fmtBillUSD, unitLabel: 'tỷ $', defaultDays: 1095, color: 'rose', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNBOT': { titleVN: 'Cán Cân Thương Mại', source: 'TradingView / Hải quan VN · tỷ $',
        fmt: fmtBillUSD, unitLabel: 'tỷ $', defaultDays: 1095, color: 'blue', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNFDI': { titleVN: 'Đầu Tư Trực Tiếp Nước Ngoài (FDI)', source: 'TradingView / MPI · tỷ $',
        fmt: fmtBillUSD, unitLabel: 'tỷ $', defaultDays: 1095, color: 'indigo', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    // Labour
    'ECONOMICS:VNUR': { titleVN: 'Tỷ Lệ Thất Nghiệp', source: 'TradingView / GSO · %',
        fmt: fmtPct, unitLabel: '%', defaultDays: 1825, color: 'orange', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNWAG': { titleVN: 'Lương Bình Quân', source: 'TradingView / GSO · triệu ₫/tháng',
        fmt: fmtMilVND, unitLabel: 'triệu ₫/tháng', defaultDays: 1825, color: 'cyan', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNMW': { titleVN: 'Lương Tối Thiểu', source: 'TradingView / MoLISA · triệu ₫/tháng',
        fmt: fmtMilVND, unitLabel: 'triệu ₫/tháng', defaultDays: 3650, color: 'teal', freq: 'annual', compareLag: 1, compareLabel: 'năm trước' },
    'ECONOMICS:VNPOP': { titleVN: 'Dân Số', source: 'TradingView / WB · triệu người',
        fmt: fmtMilPpl, unitLabel: 'triệu người', defaultDays: 3650, color: 'slate', freq: 'annual', compareLag: 1, compareLabel: 'năm trước' },
    // Business & Consumer
    'ECONOMICS:VNIPYY': { titleVN: 'Sản Lượng Công Nghiệp (YoY)', source: 'TradingView / GSO · %/năm',
        fmt: fmtPct, unitLabel: '%/năm', defaultDays: 1095, color: 'orange', barChart: true, freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNRSYY': { titleVN: 'Doanh Thu Bán Lẻ (YoY)', source: 'TradingView / GSO · %/năm',
        fmt: fmtPct, unitLabel: '%/năm', defaultDays: 1095, color: 'cyan', barChart: true, freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
};
const FA_COLORS: Record<string, string> = {
    GDP: 'emerald', Prices: 'rose', Trade: 'blue', Labour: 'violet',
    Money: 'amber', Consumer: 'cyan', Business: 'orange', InterestRate: 'indigo', Taxes: 'gray',
};

type VietnamSubTabId = 'growth' | 'prices' | 'trade' | 'money' | 'labour' | 'taxes';
type DetailSelection = { kind: 'tv'; key: string } | { kind: 'fa'; key: number; type: string };
type TremorColor = 'blue' | 'cyan' | 'emerald' | 'gray' | 'green' | 'indigo' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'rose' | 'sky' | 'slate' | 'teal' | 'violet' | 'yellow';

const VIETNAM_SUBTABS: { id: VietnamSubTabId; label: string; subtitle: string }[] = [
    { id: 'growth', label: 'Tăng trưởng', subtitle: 'GDP, cơ cấu ngành, đầu tư tài sản' },
    { id: 'prices', label: 'Giá cả', subtitle: 'CPI, lạm phát, giá năng lượng' },
    { id: 'trade', label: 'Thương mại', subtitle: 'Xuất nhập khẩu, cán cân, FDI' },
    { id: 'money', label: 'Tiền tệ', subtitle: 'Lãi suất, M2, dự trữ ngoại hối' },
    { id: 'labour', label: 'Lao động', subtitle: 'Việc làm, thu nhập, dân số' },
    { id: 'taxes', label: 'Thuế', subtitle: 'Ngân sách và thuế' },
];

const VIETNAM_TAB_TV: Record<VietnamSubTabId, string[]> = {
    growth: ['ECONOMICS:VNGDPYY', 'ECONOMICS:VNGDPPC', 'ECONOMICS:VNGNP', 'ECONOMICS:VNGFCF'],
    prices: ['ECONOMICS:VNIRYY', 'ECONOMICS:VNCPI', 'ECONOMICS:VNCIR', 'ECONOMICS:VNFI', 'ECONOMICS:VNGASP'],
    trade: ['ECONOMICS:VNBOT', 'ECONOMICS:VNEXP', 'ECONOMICS:VNIMP', 'ECONOMICS:VNFDI'],
    money: ['ECONOMICS:VNINBR', 'ECONOMICS:VNINTR', 'ECONOMICS:VNFER', 'ECONOMICS:VNM2', 'ECONOMICS:VNDIR'],
    labour: ['ECONOMICS:VNUR', 'ECONOMICS:VNWAG', 'ECONOMICS:VNMW', 'ECONOMICS:VNPOP', 'ECONOMICS:VNIPYY', 'ECONOMICS:VNRSYY'],
    taxes: [],
};

const VIETNAM_TAB_FA: Record<VietnamSubTabId, string[]> = {
    growth: ['GDP', 'Business'],
    prices: ['Prices', 'Consumer'],
    trade: [],
    money: ['Money', 'InterestRate'],
    labour: ['Labour'],
    taxes: ['Taxes'],
};

const KEY_STATS: { sym: string; tab: VietnamSubTabId }[] = [
    { sym: 'ECONOMICS:VNGDPYY', tab: 'growth' },
    { sym: 'ECONOMICS:VNIRYY', tab: 'prices' },
    { sym: 'ECONOMICS:VNBOT', tab: 'trade' },
    { sym: 'ECONOMICS:VNINBR', tab: 'money' },
];

function normalizeColor(color: string): TremorColor {
    return (color === 'amber' ? 'yellow' : color) as TremorColor;
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
        <Card className="p-5">
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
        </Card>
    );
}

function TVStatCard({ sym, selected, onClick }: { sym: string; selected: boolean; onClick: () => void }) {
    const cfg = TV_CONFIGS[sym];
    const [points, setPoints] = useState<PricePoint[] | null>(null);

    useEffect(() => {
        let active = true;
        fetch(API.MACRO_HISTORY(sym, cfg.defaultDays))
            .then((r) => r.ok ? r.json() : [])
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
        fetch(API.MACRO_HISTORY(sym, cfg.defaultDays))
            .then((r) => r.ok ? r.json() : [])
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
                fetch(API.MACRO_HISTORY(sym, 1095))
                    .then(r => r.ok ? r.json() : [])
                    .catch(() => [])
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
        <Card className="p-5">
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
        </Card>
    );
}

function VietnamMacroTab({ faData, faLoading }: { faData: FAData; faLoading: boolean }) {
    const [activeSubTab, setActiveSubTab] = useState<VietnamSubTabId>('growth');
    const [selected, setSelected] = useState<DetailSelection | null>({ kind: 'tv', key: 'ECONOMICS:VNGDPYY' });

    const selectTv = (sym: string, tab?: VietnamSubTabId) => {
        if (tab) setActiveSubTab(tab);
        setSelected((prev) => prev?.kind === 'tv' && prev.key === sym ? null : { kind: 'tv', key: sym });
    };

    const selectFa = (ind: FAIndicator, type: string) => {
        setSelected((prev) => prev?.kind === 'fa' && prev.key === ind.id ? null : { kind: 'fa', key: ind.id, type });
    };

    const activeFaIndicators = VIETNAM_TAB_FA[activeSubTab].flatMap((type) => (faData[type] ?? []).map((ind) => ({ ind, type })));
    const selectedFa = selected?.kind === 'fa'
        ? (faData[selected.type] ?? []).find((ind) => ind.id === selected.key) ?? null
        : null;

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
            </section>

            {selected?.kind === 'tv' && (
                <LazySection>
                    <TVDetailPanel key={selected.key} sym={selected.key} />
                </LazySection>
            )}

            {selectedFa && selected?.kind === 'fa' && (
                <LazySection>
                    <FADetailPanel ind={selectedFa} color={FA_COLORS[selected.type] ?? 'blue'} />
                </LazySection>
            )}

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
    const [faData, setFaData]       = useState<FAData>({});
    const [faLoading, setFaL]       = useState(true);

    const loadFaData = useCallback(async () => {
        try { const r = await fetch(API.MACRO_FIREANT()); if (r.ok) setFaData(await r.json()); }
        catch { /* ignore */ } finally { setFaL(false); }
    }, []);

    useEffect(() => { loadFaData(); }, [loadFaData]);

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
                {activeTab === 'vietnam' && <VietnamMacroTab faData={faData} faLoading={faLoading} />}

                {/* ── World Tab ── */}
                {activeTab === 'world' && <WorldTab />}

            </div>
        </div>
    );
}
