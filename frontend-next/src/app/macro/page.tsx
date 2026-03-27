'use client';

import { useCallback, useEffect, useState } from 'react';
import { AreaChart, Card } from '@tremor/react';
import { API } from '@/lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface RateItem {
    symbol: string;
    name: string;
    price: number;
    change: number;
    changePercent: number;
    unit?: string;
}

interface CpiPoint {
    date: string;    // "YYYY-MM"
    value: number;
}

interface GdpPoint {
    date: string;    // "YYYY-MM"
    quarter: string; // "Q1/2024"
    value: number;
}

interface MacroData {
    exchange_rates: RateItem[];
    commodities: RateItem[];
    economic: {
        cpi: CpiPoint[];
        gdp: GdpPoint[];
    };
}

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

// ── Formatters ───────────────────────────────────────────────────────────────

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
    const sign = val >= 0 ? '+' : '-';
    if (abs >= 10) return `${sign}${abs.toFixed(0)}`;
    return `${sign}${abs.toFixed(2)}`;
}

function fmtUsdChange(val: number): string {
    const sign = val >= 0 ? '+' : '-';
    return `${sign}${Math.abs(val).toFixed(2)}`;
}

// "2025-03" → "T3/25"
function fmtMonth(date: string): string {
    const [y, m] = date.split('-');
    return `T${parseInt(m)}/${y.slice(2)}`;
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
    return <div className="h-28 rounded-lg animate-pulse bg-slate-100 dark:bg-slate-800" />;
}

function Spinner() {
    return (
        <div className="h-56 flex items-center justify-center mt-4">
            <div className="w-5 h-5 border-2 border-slate-300 dark:border-slate-700 border-t-slate-700 dark:border-t-slate-200 rounded-full animate-spin" />
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

// ── Rate Card ─────────────────────────────────────────────────────────────────

function RateCard({ item, isVnd }: { item: RateItem; isVnd: boolean }) {
    const up = item.changePercent >= 0;
    const colorCls = up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
    const bgCls    = up ? 'bg-emerald-50 dark:bg-emerald-900/20'   : 'bg-rose-50 dark:bg-rose-900/20';

    return (
        <Card className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-tremor-content dark:text-dark-tremor-content mb-1">
                {item.name}
            </p>
            <p className="text-2xl font-bold tabular-nums text-tremor-content-strong dark:text-dark-tremor-content-strong">
                {isVnd ? fmtVndPrice(item.price) : fmtUsdPrice(item.price)}
            </p>
            {item.unit && (
                <p className="text-[11px] text-tremor-content dark:text-dark-tremor-content mt-0.5">{item.unit}</p>
            )}
            <div className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${bgCls} ${colorCls}`}>
                <span>{up ? '▲' : '▼'}</span>
                <span>{Math.abs(item.changePercent).toFixed(2)}%</span>
                <span className="opacity-70">
                    ({isVnd ? fmtVndChange(item.change) : fmtUsdChange(item.change)})
                </span>
            </div>
        </Card>
    );
}

// ── Economic Charts ───────────────────────────────────────────────────────────

function EcoChartCard({
    title,
    subtitle,
    latest,
    latestLabel,
    delta,
    children,
}: {
    title: string;
    subtitle: string;
    latest: number | null;
    latestLabel: string;
    delta: number | null;
    children: React.ReactNode;
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

    // Use every-6th label to avoid x-axis crowding; Tremor shows all ticks
    // so we thin out the index values to only label key months.
    const chartData = data.map((p, i) => ({
        Tháng: (i % 6 === 0 || i === data.length - 1) ? fmtMonth(p.date) : '',
        'CPI (%)': p.value,
    }));

    return (
        <EcoChartCard
            title="Lạm phát CPI — YoY (%)"
            subtitle="So với cùng kỳ năm trước, hàng tháng — nguồn: investing.com"
            latest={latest?.value ?? null}
            latestLabel={latest ? fmtMonth(latest.date) : ''}
            delta={delta}
        >
            {loading ? <Spinner /> : chartData.length === 0 ? (
                <div className="h-56 flex items-center justify-center text-sm text-tremor-content dark:text-dark-tremor-content mt-4">
                    Không có dữ liệu
                </div>
            ) : (
                <AreaChart
                    data={chartData}
                    index="Tháng"
                    categories={['CPI (%)']}
                    colors={['rose']}
                    valueFormatter={(v: number) => `${v.toFixed(2)}%`}
                    yAxisWidth={52}
                    showLegend={false}
                    showGradient={true}
                    startEndOnly={false}
                    className="h-56 mt-4"
                />
            )}
        </EcoChartCard>
    );
}

function GdpChart({ data, loading }: { data: GdpPoint[]; loading: boolean }) {
    const latest = data.at(-1) ?? null;
    const prev   = data.at(-2) ?? null;
    const delta  = latest && prev ? latest.value - prev.value : null;

    const chartData = data.map((p) => ({
        'Quý': p.quarter,
        'GDP (%)': p.value,
    }));

    return (
        <EcoChartCard
            title="Tăng trưởng GDP — YoY (%)"
            subtitle="So với cùng kỳ năm trước, theo quý — nguồn: investing.com"
            latest={latest?.value ?? null}
            latestLabel={latest?.quarter ?? ''}
            delta={delta}
        >
            {loading ? <Spinner /> : chartData.length === 0 ? (
                <div className="h-56 flex items-center justify-center text-sm text-tremor-content dark:text-dark-tremor-content mt-4">
                    Không có dữ liệu
                </div>
            ) : (
                <AreaChart
                    data={chartData}
                    index="Quý"
                    categories={['GDP (%)']}
                    colors={['emerald']}
                    valueFormatter={(v: number) => `${v.toFixed(2)}%`}
                    yAxisWidth={52}
                    showLegend={false}
                    showGradient={true}
                    startEndOnly={false}
                    className="h-56 mt-4"
                />
            )}
        </EcoChartCard>
    );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function MacroPage() {
    const [data, setData] = useState<MacroData | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const res = await fetch(API.MACRO);
            if (res.ok) setData(await res.json());
        } catch (e) {
            console.error('macro fetch:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        const t = setInterval(load, REFRESH_MS);
        return () => clearInterval(t);
    }, [load]);

    const fxRates     = data?.exchange_rates  ?? [];
    const commodities = data?.commodities     ?? [];
    const cpi         = data?.economic.cpi    ?? [];
    const gdp         = data?.economic.gdp    ?? [];

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
            <div className="max-w-[1600px] mx-auto p-4 md:p-6 space-y-10">

                {/* Header */}
                <div>
                    <h1 className="text-3xl md:text-4xl font-bold leading-tight tracking-tight">
                        Kinh Tế <span className="text-blue-600 dark:text-blue-400">Vĩ Mô</span>
                    </h1>
                    <div className="w-28 h-1 bg-blue-500 rounded mt-2" />
                    <p className="text-slate-600 dark:text-slate-300 mt-3 text-sm md:text-base max-w-3xl">
                        Tổng hợp các chỉ số kinh tế vĩ mô Việt Nam: tỷ giá hối đoái, hàng hóa quốc tế, lạm phát và tăng trưởng GDP.
                    </p>
                </div>

                {/* Exchange Rates */}
                <section>
                    <SectionHeader
                        title="Tỷ Giá Hối Đoái"
                        subtitle="VND so với các đồng tiền chính — nguồn: Yahoo Finance (OTC thực), cache 1 giờ"
                    />
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {loading
                            ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
                            : fxRates.length === 0
                            ? <p className="col-span-4 text-sm text-slate-500 dark:text-slate-400 py-6">Không lấy được dữ liệu tỷ giá.</p>
                            : fxRates.map((item) => <RateCard key={item.symbol} item={item} isVnd={true} />)}
                    </div>
                </section>

                {/* Commodities */}
                <section>
                    <SectionHeader
                        title="Hàng Hóa Quốc Tế"
                        subtitle="Giá hàng hóa liên quan đến doanh nghiệp Việt Nam — nguồn: Yahoo Finance (trễ 15 phút), cache 1 giờ"
                    />
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {loading
                            ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
                            : commodities.length === 0
                            ? <p className="col-span-4 text-sm text-slate-500 dark:text-slate-400 py-6">Không lấy được dữ liệu hàng hóa.</p>
                            : commodities.map((item) => <RateCard key={item.symbol} item={item} isVnd={false} />)}
                    </div>
                    <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                        Brent ảnh hưởng đến GAS, PVD, PLX · Đồng → REE, điện · Gạo → LTG, NSC · Vàng → SJC, PNJ
                    </p>
                </section>

                {/* Economic Indicators */}
                <section>
                    <SectionHeader
                        title="Chỉ Số Kinh Tế Việt Nam"
                        subtitle="Dữ liệu từ GSO qua investing.com — CPI hàng tháng, GDP theo quý"
                    />
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <CpiChart data={cpi} loading={loading} />
                        <GdpChart data={gdp} loading={loading} />
                    </div>
                </section>

                {/* Coming Soon */}
                <section>
                    <SectionHeader
                        title="Sắp Ra Mắt"
                        subtitle="Các chỉ số đang được tích hợp thêm"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <ComingSoonCard
                            title="Lãi suất điều hành SBV"
                            desc="Lãi suất tái cấp vốn, chiết khấu, qua đêm"
                        />
                        <ComingSoonCard
                            title="Lợi suất trái phiếu chính phủ"
                            desc="Đường cong lợi suất 1Y – 5Y – 10Y (HNX)"
                        />
                        <ComingSoonCard
                            title="Tăng trưởng tín dụng"
                            desc="Tổng dư nợ tín dụng toàn hệ thống (SBV)"
                        />
                    </div>
                </section>

            </div>
        </div>
    );
}
