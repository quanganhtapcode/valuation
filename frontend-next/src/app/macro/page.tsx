'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AreaChart, Card } from '@tremor/react';
import { API } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RateItem {
    symbol: string;
    name: string;
    price: number;
    change: number;
    changePercent: number;
    unit?: string;
}

interface CpiPoint  { date: string; value: number }
interface GdpPoint  { date: string; quarter: string; value: number }
interface PricePoint { date: string; close: number }

interface MacroData {
    exchange_rates: RateItem[];
    commodities: RateItem[];
    economic: { cpi: CpiPoint[]; gdp: GdpPoint[] };
}

const RANGE_OPTIONS = [
    { label: '1T', days: 30 },
    { label: '3T', days: 90 },
    { label: '6T', days: 180 },
    { label: '1N', days: 365 },
    { label: '3N', days: 1095 },
] as const;

const MACRO_REFRESH_MS = 60 * 60 * 1000;

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtVndPrice(val: number): string {
    if (val >= 1000) return val.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (val >= 10)   return val.toFixed(2);
    return val.toFixed(4);
}
function fmtUsdPrice(val: number): string {
    if (val >= 1000) return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return val.toFixed(2);
}
function fmtVndChange(val: number): string {
    const abs = Math.abs(val);
    return `${val >= 0 ? '+' : '-'}${abs >= 10 ? abs.toFixed(0) : abs.toFixed(2)}`;
}
function fmtUsdChange(val: number): string {
    return `${val >= 0 ? '+' : '-'}${Math.abs(val).toFixed(2)}`;
}
function fmtMonth(date: string): string {
    const [y, m] = date.split('-');
    return `T${parseInt(m)}/${y.slice(2)}`;
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
    return <div className="h-[100px] rounded-lg animate-pulse bg-slate-100 dark:bg-slate-800" />;
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
function ComingSoonCard({ title, desc }: { title: string; desc: string }) {
    return (
        <Card className="p-5 flex flex-col gap-1 border-dashed opacity-60">
            <p className="font-semibold text-sm text-tremor-content-strong dark:text-dark-tremor-content-strong">{title}</p>
            <p className="text-xs text-tremor-content dark:text-dark-tremor-content">{desc}</p>
            <span className="mt-2 inline-block w-fit rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Sắp ra mắt
            </span>
        </Card>
    );
}

// ── History chart (inline expand) ────────────────────────────────────────────

function downloadCsv(filename: string, rows: PricePoint[], name: string) {
    const header = 'Date,Close\n';
    const body   = rows.map((r) => `${r.date},${r.close}`).join('\n');
    const blob   = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement('a');
    a.href       = url;
    a.download   = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function HistoryChart({
    item,
    isVnd,
    onClose,
}: {
    item: RateItem;
    isVnd: boolean;
    onClose: () => void;
}) {
    const [days, setDays] = useState(365);
    const [points, setPoints] = useState<PricePoint[]>([]);
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

    const step = Math.max(1, Math.floor(points.length / 10));
    const chartData = points.map((p, i) => ({
        Ngày: (i % step === 0 || i === points.length - 1) ? p.date.slice(5) : '',
        [item.name]: p.close,
    }));

    const fmtY = isVnd
        ? (v: number) => fmtVndPrice(v)
        : (v: number) => fmtUsdPrice(v);

    const rangeLabel = RANGE_OPTIONS.find((o) => o.days === days)?.label ?? '';
    const csvFilename = `${item.symbol.replace('=', '_')}_${rangeLabel}.csv`;

    return (
        <div className="mt-1 col-span-2 lg:col-span-4">
            <Card className="p-5">
                {/* Header row */}
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
                        {/* Range selector */}
                        <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 text-xs">
                            {RANGE_OPTIONS.map((opt) => (
                                <button
                                    key={opt.days}
                                    onClick={() => setDays(opt.days)}
                                    className={`px-2.5 py-1 font-medium transition-colors ${
                                        days === opt.days
                                            ? 'bg-blue-600 text-white'
                                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                        {/* Download CSV */}
                        {points.length > 0 && (
                            <button
                                onClick={() => downloadCsv(csvFilename, points, item.name)}
                                title="Tải xuống CSV"
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                    <path d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                                CSV
                            </button>
                        )}
                        {/* Close */}
                        <button
                            onClick={onClose}
                            className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            aria-label="Đóng"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                            </svg>
                        </button>
                    </div>
                </div>

                {loading ? (
                    <Spinner h="h-48" />
                ) : chartData.length === 0 ? (
                    <div className="h-48 flex items-center justify-center text-sm text-tremor-content dark:text-dark-tremor-content">
                        Không có dữ liệu
                    </div>
                ) : (
                    <AreaChart
                        data={chartData}
                        index="Ngày"
                        categories={[item.name]}
                        colors={[up ? 'emerald' : 'rose']}
                        valueFormatter={fmtY}
                        yAxisWidth={isVnd ? 72 : 56}
                        showLegend={false}
                        showGradient={true}
                        startEndOnly={false}
                        className="h-48"
                    />
                )}
            </Card>
        </div>
    );
}

// ── Rate Card ─────────────────────────────────────────────────────────────────

function RateCard({
    item,
    isVnd,
    selected,
    onClick,
}: {
    item: RateItem;
    isVnd: boolean;
    selected: boolean;
    onClick: () => void;
}) {
    const up = item.changePercent >= 0;
    const colorCls = up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
    const bgCls    = up ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-rose-50 dark:bg-rose-900/20';

    return (
        <button
            onClick={onClick}
            className={`text-left rounded-tremor-default ring-1 transition-all duration-150 focus:outline-none
                ${selected
                    ? 'ring-blue-500 shadow-md shadow-blue-500/10'
                    : 'ring-tremor-ring dark:ring-dark-tremor-ring hover:ring-blue-400 hover:shadow-sm'
                } bg-tremor-background dark:bg-dark-tremor-background p-4 w-full`}
        >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-tremor-content dark:text-dark-tremor-content mb-1">
                {item.name}
            </p>
            <p className="text-2xl font-bold tabular-nums text-tremor-content-strong dark:text-dark-tremor-content-strong">
                {isVnd ? fmtVndPrice(item.price) : fmtUsdPrice(item.price)}
            </p>
            {item.unit && (
                <p className="text-[11px] text-tremor-content dark:text-dark-tremor-content mt-0.5">{item.unit}</p>
            )}
            <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${bgCls} ${colorCls}`}>
                <span>{up ? '▲' : '▼'}</span>
                <span>{Math.abs(item.changePercent).toFixed(2)}%</span>
                <span className="opacity-70">
                    ({isVnd ? fmtVndChange(item.change) : fmtUsdChange(item.change)})
                </span>
            </div>
            <p className="mt-2 text-[10px] text-blue-500 dark:text-blue-400 font-medium">
                {selected ? '▴ Thu gọn' : '▾ Xem lịch sử'}
            </p>
        </button>
    );
}

// ── Expandable card grid ──────────────────────────────────────────────────────

function CardGrid({ items, isVnd }: { items: RateItem[]; isVnd: boolean }) {
    const [selected, setSelected] = useState<string | null>(null);

    const selectedItem = items.find((i) => i.symbol === selected) ?? null;

    const toggle = (sym: string) => setSelected((prev) => (prev === sym ? null : sym));

    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {items.map((item) => (
                <RateCard
                    key={item.symbol}
                    item={item}
                    isVnd={isVnd}
                    selected={selected === item.symbol}
                    onClick={() => toggle(item.symbol)}
                />
            ))}
            {selectedItem && (
                <HistoryChart
                    key={selectedItem.symbol}
                    item={selectedItem}
                    isVnd={isVnd}
                    onClose={() => setSelected(null)}
                />
            )}
        </div>
    );
}

// ── Economic charts ───────────────────────────────────────────────────────────

function EcoChartCard({
    title, subtitle, latest, latestLabel, delta, children,
}: {
    title: string; subtitle: string; latest: number | null;
    latestLabel: string; delta: number | null; children: React.ReactNode;
}) {
    return (
        <Card className="p-5">
            <div className="flex items-start justify-between mb-1">
                <div>
                    <p className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">{title}</p>
                    <p className="text-xs text-tremor-content dark:text-dark-tremor-content mt-0.5">{subtitle}</p>
                </div>
                {latest !== null && (
                    <div className="text-right shrink-0 ml-4">
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
            {children}
        </Card>
    );
}

function CpiChart({ data, loading }: { data: CpiPoint[]; loading: boolean }) {
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
            latest={latest?.value ?? null} latestLabel={latest ? fmtMonth(latest.date) : ''} delta={delta}>
            {loading ? <Spinner /> : chartData.length === 0
                ? <div className="h-56 flex items-center justify-center text-sm text-tremor-content dark:text-dark-tremor-content mt-4">Không có dữ liệu</div>
                : <AreaChart data={chartData} index="Tháng" categories={['CPI (%)']} colors={['rose']}
                    valueFormatter={(v: number) => `${v.toFixed(2)}%`} yAxisWidth={52}
                    showLegend={false} showGradient className="h-56 mt-4" />}
        </EcoChartCard>
    );
}

function GdpChart({ data, loading }: { data: GdpPoint[]; loading: boolean }) {
    const latest = data.at(-1) ?? null;
    const prev   = data.at(-2) ?? null;
    const delta  = latest && prev ? latest.value - prev.value : null;
    const chartData = data.map((p) => ({ 'Quý': p.quarter, 'GDP (%)': p.value }));
    return (
        <EcoChartCard title="Tăng trưởng GDP — YoY (%)" subtitle="Theo quý — nguồn: investing.com"
            latest={latest?.value ?? null} latestLabel={latest?.quarter ?? ''} delta={delta}>
            {loading ? <Spinner /> : chartData.length === 0
                ? <div className="h-56 flex items-center justify-center text-sm text-tremor-content dark:text-dark-tremor-content mt-4">Không có dữ liệu</div>
                : <AreaChart data={chartData} index="Quý" categories={['GDP (%)']} colors={['emerald']}
                    valueFormatter={(v: number) => `${v.toFixed(2)}%`} yAxisWidth={52}
                    showLegend={false} showGradient className="h-56 mt-4" />}
        </EcoChartCard>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MacroPage() {
    const [data, setData]       = useState<MacroData | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const res = await fetch(API.MACRO);
            if (res.ok) setData(await res.json());
        } catch (e) { console.error('macro fetch:', e); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => {
        load();
        const t = setInterval(load, MACRO_REFRESH_MS);
        return () => clearInterval(t);
    }, [load]);

    const fxRates     = data?.exchange_rates  ?? [];
    const commodities = data?.commodities     ?? [];
    const cpi         = data?.economic.cpi    ?? [];
    const gdp         = data?.economic.gdp    ?? [];

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
            <div className="max-w-[1600px] mx-auto p-4 md:p-6 space-y-10">

                <div>
                    <h1 className="text-3xl md:text-4xl font-bold leading-tight tracking-tight">
                        Kinh Tế <span className="text-blue-600 dark:text-blue-400">Vĩ Mô</span>
                    </h1>
                    <div className="w-28 h-1 bg-blue-500 rounded mt-2" />
                    <p className="text-slate-600 dark:text-slate-300 mt-3 text-sm md:text-base max-w-3xl">
                        Tổng hợp các chỉ số kinh tế vĩ mô Việt Nam: tỷ giá hối đoái, hàng hóa quốc tế, lạm phát và tăng trưởng GDP.
                        Nhấn vào từng thẻ để xem lịch sử giá.
                    </p>
                </div>

                <section>
                    <SectionHeader title="Tỷ Giá Hối Đoái"
                        subtitle="VND so với các đồng tiền chính — nguồn: Yahoo Finance (OTC thực)" />
                    {loading
                        ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
                        : fxRates.length === 0
                        ? <p className="text-sm text-slate-500 py-6">Không lấy được dữ liệu tỷ giá.</p>
                        : <CardGrid items={fxRates} isVnd={true} />}
                </section>

                <section>
                    <SectionHeader title="Hàng Hóa Quốc Tế"
                        subtitle="Giá hàng hóa liên quan đến doanh nghiệp Việt Nam — nguồn: Yahoo Finance (trễ 15 phút)" />
                    {loading
                        ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
                        : commodities.length === 0
                        ? <p className="text-sm text-slate-500 py-6">Không lấy được dữ liệu hàng hóa.</p>
                        : <CardGrid items={commodities} isVnd={false} />}
                    <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                        Brent ảnh hưởng GAS, PVD, PLX · Đồng → REE, điện · Gạo → LTG, NSC · Vàng → SJC, PNJ
                    </p>
                </section>

                <section>
                    <SectionHeader title="Chỉ Số Kinh Tế Việt Nam"
                        subtitle="Dữ liệu từ GSO qua investing.com — CPI hàng tháng, GDP theo quý" />
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <CpiChart data={cpi} loading={loading} />
                        <GdpChart data={gdp} loading={loading} />
                    </div>
                </section>

                <section>
                    <SectionHeader title="Sắp Ra Mắt" subtitle="Các chỉ số đang được tích hợp thêm" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <ComingSoonCard title="Lãi suất điều hành SBV" desc="Lãi suất tái cấp vốn, chiết khấu, qua đêm" />
                        <ComingSoonCard title="Lợi suất trái phiếu chính phủ" desc="Đường cong lợi suất 1Y – 5Y – 10Y (HNX)" />
                        <ComingSoonCard title="Tăng trưởng tín dụng" desc="Tổng dư nợ tín dụng toàn hệ thống (SBV)" />
                    </div>
                </section>

            </div>
        </div>
    );
}
