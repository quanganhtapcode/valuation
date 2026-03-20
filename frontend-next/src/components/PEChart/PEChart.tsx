'use client';

import { useState, useEffect, useMemo } from 'react';
import {
    ComposedChart,
    Line,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine,
    ReferenceArea,
} from 'recharts';
import { fetchPEChart, PEChartData, PEChartResult, ValuationStats } from '@/lib/api';
import { cx } from '@/lib/utils';
import styles from './PEChart.module.css';

type TimeRange = '6m' | 'ytd' | '1y' | '2y' | '5y' | 'all';
type ActiveChart = 'vnindex' | 'pe' | 'pb';

const TIME_RANGES: { key: TimeRange; label: string }[] = [
    { key: '6m',  label: '6M'  },
    { key: 'ytd', label: 'YTD' },
    { key: '1y',  label: '1Y'  },
    { key: '2y',  label: '2Y'  },
    { key: '5y',  label: '5Y'  },
    { key: 'all', label: 'All' },
];

const CHART_TABS: { key: ActiveChart; label: string }[] = [
    { key: 'vnindex', label: 'VN-Index' },
    { key: 'pe',      label: 'P/E TTM'  },
    { key: 'pb',      label: 'P/B TTM'  },
];

function getCutoffDate(range: TimeRange): Date | null {
    const now = new Date();
    switch (range) {
        case '6m':  { const d = new Date(now); d.setMonth(d.getMonth() - 6);       return d; }
        case 'ytd': return new Date(now.getFullYear(), 0, 1);
        case '1y':  { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return d; }
        case '2y':  { const d = new Date(now); d.setFullYear(d.getFullYear() - 2); return d; }
        case '5y':  { const d = new Date(now); d.setFullYear(d.getFullYear() - 5); return d; }
        case 'all': return null;
    }
}

function formatDateLabel(date: Date, range: TimeRange): string {
    if (range === '6m' || range === 'ytd')
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (range === '1y' || range === '2y')
        return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    return String(date.getFullYear());
}

function sampleData<T>(arr: T[], max: number): T[] {
    if (arr.length <= max) return arr;
    const step = arr.length / max;
    const out: T[] = [];
    for (let i = 0; i < max - 1; i++) out.push(arr[Math.round(i * step)]);
    out.push(arr[arr.length - 1]);
    return out;
}

function fmtVol(v: number): string {
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    return v.toLocaleString('en-US');
}

// ── Tooltips ──────────────────────────────────────────────────────────────────

const VNTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
        <div className="z-50 rounded-tremor-default border border-tremor-border bg-tremor-background p-3 shadow-tremor-dropdown dark:border-dark-tremor-border dark:bg-dark-tremor-background text-xs">
            <p className="mb-1.5 font-medium uppercase tracking-tight text-tremor-content dark:text-dark-tremor-content">{d?.fullDate}</p>
            <div className="flex justify-between gap-6">
                <span className="text-orange-500 font-medium">VN-Index</span>
                <span className="font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong">{Number(d?.close).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
            </div>
            {d?.volume != null && (
                <div className="flex justify-between gap-6 mt-1">
                    <span className="text-tremor-content dark:text-dark-tremor-content">Volume</span>
                    <span className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">{fmtVol(d.volume)}</span>
                </div>
            )}
        </div>
    );
};

const RatioTooltip = ({ active, payload, stats, label: _label }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    const val: number = d?.value;
    let zone = 'Normal range';
    if (stats) {
        if (val >= stats.plusTwoSD)       zone = '+2σ · Overvalued';
        else if (val >= stats.plusOneSD)  zone = '+1σ · Expensive';
        else if (val <= stats.minusTwoSD) zone = '−2σ · Deeply undervalued';
        else if (val <= stats.minusOneSD) zone = '−1σ · Cheap';
    }
    return (
        <div className="z-50 rounded-tremor-default border border-tremor-border bg-tremor-background p-3 shadow-tremor-dropdown dark:border-dark-tremor-border dark:bg-dark-tremor-background text-xs">
            <p className="mb-1.5 font-medium uppercase tracking-tight text-tremor-content dark:text-dark-tremor-content">{d?.fullDate}</p>
            <div className="flex justify-between gap-6">
                <span className="text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis font-medium">{payload[0]?.name}</span>
                <span className="font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong">{val?.toFixed(2)}</span>
            </div>
            <p className="mt-1 text-tremor-content dark:text-dark-tremor-content">{zone}</p>
        </div>
    );
};

// ── Component ─────────────────────────────────────────────────────────────────

interface PEChartProps {
    initialData?: PEChartData[];
    externalData?: PEChartData[];
    useExternalOnly?: boolean;
}

export default function PEChart({ initialData = [], externalData = [], useExternalOnly = false }: PEChartProps) {
    const [result, setResult] = useState<PEChartResult>({ series: initialData, stats: {} });
    const [timeRange, setTimeRange] = useState<TimeRange>('1y');
    const [activeChart, setActiveChart] = useState<ActiveChart>('vnindex');
    const [isLoading, setIsLoading] = useState(initialData.length === 0);

    useEffect(() => {
        if (externalData.length > 0) {
            setResult(r => ({ ...r, series: externalData }));
            setIsLoading(false);
            return;
        }
        if (initialData.length > 0 || useExternalOnly) return;

        fetchPEChart('both')
            .then(r => { setResult(r); setIsLoading(false); })
            .catch(() => setIsLoading(false));
    }, [initialData, externalData, useExternalOnly]);

    const { series, stats } = result;

    const currentStats = useMemo(() => {
        if (!series.length) return { pe: null, pb: null, vnindex: null };
        const last = [...series].sort((a, b) => a.date.getTime() - b.date.getTime()).at(-1)!;
        return { pe: last.pe, pb: last.pb, vnindex: last.vnindex };
    }, [series]);

    const maxPoints = (timeRange === 'all' || timeRange === '5y') ? 400 : 600;

    // VN-Index chart data
    const vnData = useMemo(() => {
        const cutoff = getCutoffDate(timeRange);
        let filtered = series.filter(d => d.vnindex != null);
        if (cutoff) filtered = filtered.filter(d => d.date >= cutoff);
        return sampleData(filtered, maxPoints).map(d => ({
            date: formatDateLabel(d.date, timeRange),
            fullDate: d.date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
            close: d.vnindex!,
            volume: d.volume,
        }));
    }, [series, timeRange, maxPoints]);

    // PE/PB chart data
    const ratioData = useMemo(() => {
        const field = activeChart as 'pe' | 'pb';
        const cutoff = getCutoffDate(timeRange);
        let filtered = series.filter(d => d[field] != null);
        if (cutoff) filtered = filtered.filter(d => d.date >= cutoff);
        return sampleData(filtered, maxPoints).map(d => ({
            date: formatDateLabel(d.date, timeRange),
            fullDate: d.date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
            value: d[field]!,
        }));
    }, [series, timeRange, activeChart, maxPoints]);

    const activeStats: ValuationStats | undefined =
        activeChart === 'pe' ? stats.pe : activeChart === 'pb' ? stats.pb : undefined;
    const ratioColor = activeChart === 'pe' ? '#6366f1' : '#10b981';
    const ratioName  = activeChart === 'pe' ? 'P/E TTM'  : 'P/B TTM';

    const ratioDomain = useMemo((): [number, number] | ['auto', 'auto'] => {
        if (!activeStats || ratioData.length === 0) return ['auto', 'auto'];
        const vals = ratioData.map(d => d.value);
        const allVals = [...vals, activeStats.minusTwoSD, activeStats.plusTwoSD];
        const lo = Math.min(...allVals);
        const hi = Math.max(...allVals);
        const pad = (hi - lo) * 0.06;
        return [+(lo - pad).toFixed(2), +(hi + pad).toFixed(2)];
    }, [ratioData, activeStats]);

    // Shared x-axis tick interval
    const tickInterval = (data: any[]) => Math.max(1, Math.ceil(data.length / 6));

    const tabBtn = (key: ActiveChart, label: string) => (
        <button key={key} type="button" onClick={() => setActiveChart(key)}
            className={cx(
                'rounded px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap',
                activeChart === key
                    ? 'bg-tremor-brand text-white dark:bg-dark-tremor-brand'
                    : 'text-tremor-content-strong hover:bg-tremor-background-muted dark:text-dark-tremor-content-strong hover:dark:bg-gray-800'
            )}>
            {label}
        </button>
    );

    const rangeBtn = (key: TimeRange, label: string, idx: number, total: number) => (
        <button key={key} type="button" onClick={() => setTimeRange(key)}
            className={cx(
                'border border-transparent px-2.5 py-1.5 text-xs font-medium transition-colors focus:z-10 whitespace-nowrap',
                idx === 0 ? 'rounded-l-tremor-small' : '-ml-px',
                idx === total - 1 ? 'rounded-r-tremor-small' : '',
                timeRange === key
                    ? 'bg-tremor-brand-muted text-tremor-brand font-semibold dark:bg-dark-tremor-brand-muted dark:text-dark-tremor-brand'
                    : 'text-tremor-content-strong hover:bg-tremor-background-muted dark:text-dark-tremor-content-strong hover:dark:bg-gray-800'
            )}>
            {label}
        </button>
    );

    return (
        <section className={styles.section}>
            {/* ── Single control row ── */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                {/* Left: chart type tabs */}
                <div className="flex gap-1 rounded-lg border border-tremor-border bg-tremor-background p-1 dark:border-dark-tremor-border dark:bg-gray-950">
                    {CHART_TABS.map(t => tabBtn(t.key, t.label))}
                </div>

                {/* Right: current values + time range */}
                <div className="flex flex-wrap items-center gap-3">
                    {/* Current values */}
                    {currentStats.vnindex != null && (
                        <div className="flex items-center gap-1">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-orange-500">VN-Index</span>
                            <span className="text-sm font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong">{currentStats.vnindex.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                        </div>
                    )}
                    {currentStats.pe != null && (
                        <div className="flex items-center gap-1">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">P/E</span>
                            <span className="text-sm font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong">{currentStats.pe.toFixed(2)}</span>
                        </div>
                    )}
                    {currentStats.pb != null && (
                        <div className="flex items-center gap-1">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">P/B</span>
                            <span className="text-sm font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong">{currentStats.pb.toFixed(2)}</span>
                        </div>
                    )}

                    {/* Time range buttons */}
                    <div className="flex rounded-tremor-small border border-tremor-border bg-tremor-background shadow-tremor-input dark:border-dark-tremor-border dark:bg-gray-950">
                        {TIME_RANGES.map((item, idx) => rangeBtn(item.key, item.label, idx, TIME_RANGES.length))}
                    </div>
                </div>
            </div>

            {/* ── Chart area ── */}
            {isLoading ? (
                <div className={styles.loading}><div className={styles.loader} /><span>Loading chart data...</span></div>
            ) : activeChart === 'vnindex' ? (
                /* VN-Index: price line + volume bars */
                vnData.length === 0 ? <div className={styles.noData}>No data</div> : (
                    <ResponsiveContainer width="100%" height={300}>
                        <ComposedChart data={vnData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} strokeOpacity={0.5} />
                            <XAxis
                                dataKey="date"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: '#9ca3af', fontSize: 11 }}
                                interval={tickInterval(vnData) - 1}
                                height={24}
                            />
                            <YAxis
                                yAxisId="price"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: '#9ca3af', fontSize: 11 }}
                                width={55}
                                domain={['auto', 'auto']}
                                tickFormatter={v => v.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                            />
                            <YAxis
                                yAxisId="vol"
                                orientation="right"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: '#cbd5e1', fontSize: 10 }}
                                width={42}
                                tickFormatter={fmtVol}
                            />
                            <Tooltip content={<VNTooltip />} cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }} />
                            <Bar yAxisId="vol" dataKey="volume" fill="#f97316" fillOpacity={0.25} isAnimationActive={false} name="Volume" />
                            <Line yAxisId="price" type="monotone" dataKey="close" stroke="#f97316" strokeWidth={1.5} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} name="VN-Index" isAnimationActive={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                )
            ) : (
                /* PE / PB: line + std dev bands */
                ratioData.length === 0 ? <div className={styles.noData}>No data</div> : (
                    <>
                        <ResponsiveContainer width="100%" height={300}>
                            <ComposedChart data={ratioData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} strokeOpacity={0.5} />
                                <XAxis
                                    dataKey="date"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#9ca3af', fontSize: 11 }}
                                    interval={tickInterval(ratioData) - 1}
                                    height={24}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#9ca3af', fontSize: 11 }}
                                    width={45}
                                    domain={ratioDomain}
                                    tickFormatter={v => v.toFixed(1)}
                                />
                                <Tooltip content={<RatioTooltip stats={activeStats} />} cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }} />

                                {/* ±2σ outer band — must be direct children (no fragment) */}
                                {activeStats && <ReferenceArea y1={activeStats.minusTwoSD} y2={activeStats.plusTwoSD} fill={ratioColor} fillOpacity={0.08} strokeOpacity={0} />}
                                {/* ±1σ inner band */}
                                {activeStats && <ReferenceArea y1={activeStats.minusOneSD} y2={activeStats.plusOneSD} fill={ratioColor} fillOpacity={0.14} strokeOpacity={0} />}

                                {/* Reference lines — each must be a direct child, no wrapping fragment */}
                                {activeStats && <ReferenceLine y={activeStats.plusTwoSD}  stroke="#ef4444" strokeDasharray="5 3" strokeWidth={1.5} label={{ value: `+2σ ${activeStats.plusTwoSD.toFixed(2)}`,  position: 'insideTopRight', fill: '#ef4444', fontSize: 10 }} />}
                                {activeStats && <ReferenceLine y={activeStats.plusOneSD}  stroke="#f97316" strokeDasharray="5 3" strokeWidth={1.5} label={{ value: `+1σ ${activeStats.plusOneSD.toFixed(2)}`,  position: 'insideTopRight', fill: '#f97316', fontSize: 10 }} />}
                                {activeStats && <ReferenceLine y={activeStats.average}    stroke="#9ca3af" strokeDasharray="5 3" strokeWidth={1.5} label={{ value: `avg ${activeStats.average.toFixed(2)}`,       position: 'insideTopRight', fill: '#9ca3af', fontSize: 10 }} />}
                                {activeStats && <ReferenceLine y={activeStats.minusOneSD} stroke="#10b981" strokeDasharray="5 3" strokeWidth={1.5} label={{ value: `−1σ ${activeStats.minusOneSD.toFixed(2)}`, position: 'insideTopRight', fill: '#10b981', fontSize: 10 }} />}
                                {activeStats && <ReferenceLine y={activeStats.minusTwoSD} stroke="#3b82f6" strokeDasharray="5 3" strokeWidth={1.5} label={{ value: `−2σ ${activeStats.minusTwoSD.toFixed(2)}`, position: 'insideTopRight', fill: '#3b82f6', fontSize: 10 }} />}

                                <Line type="monotone" dataKey="value" stroke={ratioColor} strokeWidth={2} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} name={ratioName} isAnimationActive={false} />
                            </ComposedChart>
                        </ResponsiveContainer>

                        {/* Legend row */}
                        {activeStats && (
                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-tremor-content dark:text-dark-tremor-content">
                                <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 bg-red-500" style={{ opacity: 0.9 }} />+2σ {activeStats.plusTwoSD.toFixed(2)}</span>
                                <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 bg-orange-500" style={{ opacity: 0.9 }} />+1σ {activeStats.plusOneSD.toFixed(2)}</span>
                                <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 bg-gray-400" style={{ opacity: 0.9 }} />avg {activeStats.average.toFixed(2)}</span>
                                <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 bg-emerald-500" style={{ opacity: 0.9 }} />−1σ {activeStats.minusOneSD.toFixed(2)}</span>
                                <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 bg-blue-500" style={{ opacity: 0.9 }} />−2σ {activeStats.minusTwoSD.toFixed(2)}</span>
                            </div>
                        )}
                    </>
                )
            )}
        </section>
    );
}
