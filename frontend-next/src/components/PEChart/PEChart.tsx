'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
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
import { fetchEma50Breadth, fetchPEChart, fetchPEChartByRange, PEChartData, PEChartResult, ValuationStats } from '@/lib/api';
import { cx } from '@/lib/utils';
import styles from './PEChart.module.css';

type TimeRange = '6m' | 'ytd' | '1y' | '2y' | '5y' | 'all';
type ActiveChart = 'vnindex' | 'candle' | 'ema50breadth' | 'pe' | 'pb';

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
    { key: 'candle',  label: 'Candlestick' },
    { key: 'ema50breadth',   label: 'EMA50 Breadth'    },
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
            {d?.ema50 != null && (
                <div className="flex justify-between gap-6 mt-1">
                    <span className="text-blue-500 font-medium">EMA50</span>
                    <span className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                        {Number(d.ema50).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </span>
                </div>
            )}
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
            {d?.vnindex != null && payload[0]?.name === 'EMA50' && (
                <div className="flex justify-between gap-6 mt-1">
                    <span className="text-orange-500 font-medium">VN-Index</span>
                    <span className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                        {Number(d.vnindex).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </span>
                </div>
            )}
            <p className="mt-1 text-tremor-content dark:text-dark-tremor-content">{zone}</p>
        </div>
    );
};

// ── Candlestick shapes ────────────────────────────────────────────────────────

const CandleBody = (props: any) => {
    const { x, y, width, height, payload } = props;
    if (!height || height <= 0) return null;
    const fill = payload?.isGreen ? '#22c55e' : '#ef4444';
    const bw = Math.max(3, width - 2);
    return <rect x={x + (width - bw) / 2} y={y} width={bw} height={height} fill={fill} />;
};

const CandleWick = (props: any) => {
    const { x, y, width, height } = props;
    if (!height || height <= 0) return null;
    return <rect x={x + width / 2 - 0.75} y={y} width={1.5} height={height} fill="#94a3b8" />;
};

const CandleTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    const isGreen = d?.isGreen;
    const color = isGreen ? '#22c55e' : '#ef4444';
    const fmt = (v: number) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
    return (
        <div className="z-50 rounded-tremor-default border border-tremor-border bg-tremor-background p-3 shadow-tremor-dropdown dark:border-dark-tremor-border dark:bg-dark-tremor-background text-xs">
            <p className="mb-1.5 font-medium uppercase tracking-tight text-tremor-content dark:text-dark-tremor-content">{d?.fullDate}</p>
            <div className="flex justify-between gap-6"><span style={{ color }} className="font-medium">Open</span><span className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">{fmt(d?.openVal)}</span></div>
            <div className="flex justify-between gap-6 mt-0.5"><span className="text-red-400 font-medium">High</span><span className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">{fmt(d?.highVal)}</span></div>
            <div className="flex justify-between gap-6 mt-0.5"><span className="text-blue-400 font-medium">Low</span><span className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">{fmt(d?.lowVal)}</span></div>
            <div className="flex justify-between gap-6 mt-0.5"><span style={{ color }} className="font-medium">Close</span><span className="font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong">{fmt(d?.closeVal)}</span></div>
            {d?.ema50Val != null && <div className="flex justify-between gap-6 mt-1"><span className="text-blue-500 font-medium">EMA50</span><span className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">{fmt(d.ema50Val)}</span></div>}
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
    const [timeRange, setTimeRange] = useState<TimeRange>('6m');
    const [activeChart, setActiveChart] = useState<ActiveChart>('vnindex');
    const [isLoading, setIsLoading] = useState(initialData.length === 0);
    const [breadthData, setBreadthData] = useState<Array<{ date: Date; above: number; below: number; percent: number }>>([]);
    const [breadthLoading, setBreadthLoading] = useState(false);
    const cacheRef = useRef<Partial<Record<TimeRange, PEChartResult>>>({});
    const breadthCacheRef = useRef<Partial<Record<TimeRange, Array<{ date: Date; above: number; below: number; percent: number }>>>>({});
    const abortRef = useRef<AbortController | null>(null);

    const rangeToBreadthDays = (range: TimeRange): number => {
        switch (range) {
            case '6m': return 190;
            case 'ytd': return 380;
            case '1y': return 380;
            case '2y': return 760;
            case '5y': return 1900;
            case 'all': return 4000;
        }
    };

    const rangeToApiTimeFrame = (range: TimeRange): '6M' | 'YTD' | '1Y' | '2Y' | '5Y' | 'ALL' => {
        switch (range) {
            case '6m': return '6M';
            case 'ytd': return 'YTD';
            case '1y': return '1Y';
            case '2y': return '2Y';
            case '5y': return '5Y';
            case 'all': return 'ALL';
        }
    };

    useEffect(() => {
        if (externalData.length > 0) {
            setResult(r => ({ ...r, series: externalData }));
            setIsLoading(false);
            cacheRef.current['6m'] = { series: externalData, stats: result.stats || {} };
            return;
        }
        if (initialData.length > 0 || useExternalOnly) return;

        const controller = new AbortController();
        abortRef.current = controller;
        fetchPEChart('both', { signal: controller.signal })
            .then(r => {
                cacheRef.current['6m'] = r;
                setResult(r);
                setIsLoading(false);
            })
            .catch(() => setIsLoading(false));
        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialData, externalData, useExternalOnly]);

    useEffect(() => {
        if (externalData.length > 0 && timeRange === '6m') return;
        const cached = cacheRef.current[timeRange];
        if (cached) {
            setResult(cached);
            setIsLoading(false);
            return;
        }

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setIsLoading(true);

        fetchPEChartByRange(rangeToApiTimeFrame(timeRange), 'both', { signal: controller.signal })
            .then((r) => {
                cacheRef.current[timeRange] = r;
                setResult(r);
                setIsLoading(false);
            })
            .catch((e: any) => {
                if (e?.name === 'AbortError') return;
                setIsLoading(false);
            });

        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeRange]);

    useEffect(() => {
        if (activeChart !== 'ema50breadth') return;

        const cached = breadthCacheRef.current[timeRange];
        if (cached) {
            setBreadthData(cached);
            setBreadthLoading(false);
            return;
        }

        setBreadthLoading(true);
        fetchEma50Breadth(rangeToBreadthDays(timeRange))
            .then((rows) => {
                const mapped = rows.map((r) => ({
                    date: r.date,
                    above: r.aboveEma50,
                    below: r.belowEma50,
                    percent: r.abovePercent,
                }));
                breadthCacheRef.current[timeRange] = mapped;
                setBreadthData(mapped);
                setBreadthLoading(false);
            })
            .catch(() => setBreadthLoading(false));
    }, [activeChart, timeRange]);

    const { series, stats } = result;

    const currentStats = useMemo(() => {
        if (!series.length) return { pe: null, pb: null, vnindex: null, ema50: null };
        const last = [...series].sort((a, b) => a.date.getTime() - b.date.getTime()).at(-1)!;
        return { pe: last.pe, pb: last.pb, vnindex: last.vnindex, ema50: last.ema50 ?? null };
    }, [series]);

    const maxPoints = (timeRange === 'all' || timeRange === '5y') ? 400 : 600;

    const dateKey = (d: Date): string => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    // VN-Index chart data
    const vnData = useMemo(() => {
        const cutoff = getCutoffDate(timeRange);
        let filtered = series.filter(d => d.vnindex != null);
        if (cutoff) filtered = filtered.filter(d => d.date >= cutoff);
        return sampleData(filtered, maxPoints).map(d => ({
            date: formatDateLabel(d.date, timeRange),
            fullDate: d.date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
            close: d.vnindex!,
            ema50: d.ema50 ?? null,
            volume: d.volume,
        }));
    }, [series, timeRange, maxPoints]);

    // PE/PB chart data
    const ratioData = useMemo(() => {
        const field = activeChart as 'pe' | 'pb';
        const cutoff = getCutoffDate(timeRange);
        let filtered = series.filter(d => d[field] != null && d.vnindex != null);
        if (cutoff) filtered = filtered.filter(d => d.date >= cutoff);
        return sampleData(filtered, maxPoints).map(d => ({
            date: formatDateLabel(d.date, timeRange),
            fullDate: d.date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
            value: d[field]!,
            vnindex: d.vnindex!,
        }));
    }, [series, timeRange, activeChart, maxPoints]);

    // Candlestick chart data — stacked segments: lowerWick / body / upperWick on top of invisible base
    const candleData = useMemo(() => {
        const cutoff = getCutoffDate(timeRange);
        const maxCandles = (timeRange === 'all' || timeRange === '5y') ? 300 : 200;
        let filtered = series.filter(d => d.open != null && d.high != null && d.low != null && d.vnindex != null);
        if (cutoff) filtered = filtered.filter(d => d.date >= cutoff);
        return sampleData(filtered, maxCandles).map(d => {
            const o = d.open!;
            const h = d.high!;
            const l = d.low!;
            const c = d.vnindex!;
            const isGreen = c >= o;
            const bodyBot = Math.min(o, c);
            const bodyTop = Math.max(o, c);
            return {
                date: formatDateLabel(d.date, timeRange),
                fullDate: d.date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
                invisible: l,
                lowerWick: bodyBot - l,
                body: Math.max(bodyTop - bodyBot, 0.5),
                upperWick: h - bodyTop,
                ema50Val: d.ema50 ?? null,
                openVal: o, highVal: h, lowVal: l, closeVal: c,
                isGreen,
            };
        });
    }, [series, timeRange]);


    const breadthChartData = useMemo(() => {
        const cutoff = getCutoffDate(timeRange);
        const vnByDate = new Map<string, number>();
        for (const d of series) {
            if (d.vnindex == null) continue;
            vnByDate.set(dateKey(d.date), d.vnindex);
        }

        let filtered = breadthData;
        if (cutoff) filtered = filtered.filter(d => d.date >= cutoff);

        return sampleData(filtered, maxPoints)
            .map((d) => {
                const key = dateKey(d.date);
                const vnindex = vnByDate.get(key) ?? null;
                return {
                    date: formatDateLabel(d.date, timeRange),
                    fullDate: d.date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
                    percent: d.percent,
                    vnindex,
                };
            });
    }, [breadthData, series, timeRange, maxPoints]);

    const activeStats: ValuationStats | undefined =
        activeChart === 'pe' ? stats.pe : activeChart === 'pb' ? stats.pb : undefined;
    const ratioColor = activeChart === 'pe' ? '#6366f1' : activeChart === 'pb' ? '#10b981' : '#3b82f6';
    const ratioName  = activeChart === 'pe' ? 'P/E TTM' : activeChart === 'pb' ? 'P/B TTM' : 'EMA50';
    const stdColors = {
        plusTwo: '#ef4444',
        plusOne: '#f97316',
        average: '#94a3b8',
        minusOne: '#22c55e',
        minusTwo: '#3b82f6',
    };

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
                'flex-1 rounded px-3 py-1.5 text-xs font-semibold transition-colors text-center whitespace-nowrap',
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
            {/* ── Controls ── */}
            <div className="mb-4 space-y-2">
                {/* Top row: chart type tabs */}
                <div className="flex w-full gap-1 rounded-lg border border-tremor-border bg-tremor-background p-1 dark:border-dark-tremor-border dark:bg-gray-950">
                    {CHART_TABS.map(t => tabBtn(t.key, t.label))}
                </div>

                {/* Bottom row: current values */}
                <div className="flex flex-nowrap items-center gap-4 sm:gap-5 overflow-x-auto">
                    <div className="flex flex-nowrap items-center gap-4 sm:gap-5 min-w-max">
                        {currentStats.vnindex != null && (
                            <div className="flex items-baseline gap-1.5 whitespace-nowrap leading-none">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-orange-500">VN-Index</span>
                                <span className="text-sm font-bold tabular-nums text-tremor-content-strong dark:text-dark-tremor-content-strong">{currentStats.vnindex.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                            </div>
                        )}
                        {currentStats.pe != null && (
                            <div className="flex items-baseline gap-1.5 whitespace-nowrap leading-none">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">P/E</span>
                                <span className="text-sm font-bold tabular-nums text-tremor-content-strong dark:text-dark-tremor-content-strong">{currentStats.pe.toFixed(2)}</span>
                            </div>
                        )}
                        {currentStats.pb != null && (
                            <div className="flex items-baseline gap-1.5 whitespace-nowrap leading-none">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">P/B</span>
                                <span className="text-sm font-bold tabular-nums text-tremor-content-strong dark:text-dark-tremor-content-strong">{currentStats.pb.toFixed(2)}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Chart area ── */}
            {isLoading ? (
                <div className={styles.loading}><div className={styles.loader} /><span>Loading chart data...</span></div>
            ) : activeChart === 'vnindex' ? (
                /* VN-Index: price line + volume bars */
                vnData.length === 0 ? <div className={styles.noData}>No data</div> : (
                    <ResponsiveContainer width="100%" height={400}>
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
                            <Line yAxisId="price" type="monotone" dataKey="ema50" stroke="#3b82f6" strokeWidth={1.5} dot={false} activeDot={false} name="EMA50" isAnimationActive={false} connectNulls />
                        </ComposedChart>
                    </ResponsiveContainer>
                )
            ) : activeChart === 'candle' ? (
                /* Candlestick chart */
                candleData.length === 0 ? <div className={styles.noData}>No data</div> : (
                    <ResponsiveContainer width="100%" height={400}>
                        <ComposedChart data={candleData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} strokeOpacity={0.5} />
                            <XAxis
                                dataKey="date"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: '#9ca3af', fontSize: 11 }}
                                interval={tickInterval(candleData) - 1}
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
                            <Tooltip content={<CandleTooltip />} cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }} />
                            {/* Stacked: invisible base → lower wick → body → upper wick */}
                            <Bar yAxisId="price" stackId="c" dataKey="invisible" fill="transparent" legendType="none" isAnimationActive={false} />
                            <Bar yAxisId="price" stackId="c" dataKey="lowerWick" shape={<CandleWick />} legendType="none" isAnimationActive={false} />
                            <Bar yAxisId="price" stackId="c" dataKey="body" shape={<CandleBody />} legendType="none" isAnimationActive={false} />
                            <Bar yAxisId="price" stackId="c" dataKey="upperWick" shape={<CandleWick />} legendType="none" isAnimationActive={false} />
                            <Line yAxisId="price" type="monotone" dataKey="ema50Val" stroke="#3b82f6" strokeWidth={1.5} dot={false} activeDot={false} name="EMA50" isAnimationActive={false} connectNulls />
                        </ComposedChart>
                    </ResponsiveContainer>
                )
            ) : activeChart === 'ema50breadth' ? (
                breadthLoading ? (
                    <div className={styles.loading}><div className={styles.loader} /><span>Loading EMA50 breadth...</span></div>
                ) : breadthChartData.length === 0 ? (
                    <div className={styles.noData}>No data</div>
                ) : (
                    <ResponsiveContainer width="100%" height={400}>
                        <ComposedChart data={breadthChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} strokeOpacity={0.5} />
                            <XAxis
                                dataKey="date"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: '#9ca3af', fontSize: 11 }}
                                interval={tickInterval(breadthChartData) - 1}
                                height={24}
                            />
                            <YAxis
                                yAxisId="vn"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: '#9ca3af', fontSize: 11 }}
                                width={55}
                                tickFormatter={(v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                            />
                            <YAxis
                                yAxisId="pct"
                                orientation="right"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fill: '#93c5fd', fontSize: 10 }}
                                width={45}
                                tickFormatter={(v) => `${Math.round(v * 100)}%`}
                                domain={[0, 1]}
                            />
                            <Tooltip
                                cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                                content={({ active, payload }) => {
                                    if (!active || !payload?.length) return null;
                                    const d = payload[0]?.payload;
                                    return (
                                        <div className="z-50 rounded-tremor-default border border-tremor-border bg-tremor-background p-3 shadow-tremor-dropdown dark:border-dark-tremor-border dark:bg-dark-tremor-background text-xs">
                                            <p className="mb-1.5 font-medium uppercase tracking-tight text-tremor-content dark:text-dark-tremor-content">{d?.fullDate}</p>
                                            <div className="flex justify-between gap-6">
                                                <span className="text-blue-500 font-medium">% Trên EMA50</span>
                                                <span className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">{(Number(d?.percent || 0) * 100).toFixed(1)}%</span>
                                            </div>
                                            <div className="flex justify-between gap-6 mt-1">
                                                <span className="text-emerald-500 font-medium">VN-Index</span>
                                                <span className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">{Number(d?.vnindex).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                                            </div>
                                        </div>
                                    );
                                }}
                            />

                            <ReferenceLine yAxisId="pct" y={0.25} stroke="#94a3b8" strokeDasharray="4 4" strokeOpacity={0.6} />
                            <ReferenceLine yAxisId="pct" y={0.5} stroke="#94a3b8" strokeDasharray="4 4" strokeOpacity={0.7} />
                            <ReferenceLine yAxisId="pct" y={0.75} stroke="#94a3b8" strokeDasharray="4 4" strokeOpacity={0.6} />

                            <Line yAxisId="vn" type="monotone" dataKey="vnindex" stroke="#22c55e" strokeWidth={1.8} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} name="VN-Index" isAnimationActive={false} connectNulls />
                            <Line yAxisId="pct" type="monotone" dataKey="percent" stroke="#3b82f6" strokeWidth={1.8} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} name="% Trên EMA50" isAnimationActive={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                )
            ) : (
                /* PE / PB */
                ratioData.length === 0 ? <div className={styles.noData}>No data</div> : (
                    <>
                        <ResponsiveContainer width="100%" height={400}>
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
                                {activeStats && <ReferenceLine y={activeStats.plusTwoSD}  stroke={stdColors.plusTwo} strokeDasharray="5 3" strokeWidth={1.5} label={{ value: `+2σ ${activeStats.plusTwoSD.toFixed(2)}`,  position: 'insideTopRight', fill: stdColors.plusTwo, fontSize: 10 }} />}
                                {activeStats && <ReferenceLine y={activeStats.plusOneSD}  stroke={stdColors.plusOne} strokeDasharray="5 3" strokeWidth={1.5} label={{ value: `+1σ ${activeStats.plusOneSD.toFixed(2)}`,  position: 'insideTopRight', fill: stdColors.plusOne, fontSize: 10 }} />}
                                {activeStats && <ReferenceLine y={activeStats.average}    stroke={stdColors.average} strokeDasharray="5 3" strokeWidth={1.5} label={{ value: `avg ${activeStats.average.toFixed(2)}`,       position: 'insideTopRight', fill: stdColors.average, fontSize: 10 }} />}
                                {activeStats && <ReferenceLine y={activeStats.minusOneSD} stroke={stdColors.minusOne} strokeDasharray="5 3" strokeWidth={1.5} label={{ value: `−1σ ${activeStats.minusOneSD.toFixed(2)}`, position: 'insideTopRight', fill: stdColors.minusOne, fontSize: 10 }} />}
                                {activeStats && <ReferenceLine y={activeStats.minusTwoSD} stroke={stdColors.minusTwo} strokeDasharray="5 3" strokeWidth={1.5} label={{ value: `−2σ ${activeStats.minusTwoSD.toFixed(2)}`, position: 'insideTopRight', fill: stdColors.minusTwo, fontSize: 10 }} />}

                                <Line type="monotone" dataKey="value" stroke={ratioColor} strokeWidth={2} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} name={ratioName} isAnimationActive={false} />
                            </ComposedChart>
                        </ResponsiveContainer>

                        {/* Legend row */}
                        {activeStats && (
                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-tremor-content dark:text-dark-tremor-content">
                                <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5" style={{ backgroundColor: stdColors.plusTwo, opacity: 0.9 }} />+2σ {activeStats.plusTwoSD.toFixed(2)}</span>
                                <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5" style={{ backgroundColor: stdColors.plusOne, opacity: 0.9 }} />+1σ {activeStats.plusOneSD.toFixed(2)}</span>
                                <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5" style={{ backgroundColor: stdColors.average, opacity: 0.9 }} />avg {activeStats.average.toFixed(2)}</span>
                                <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5" style={{ backgroundColor: stdColors.minusOne, opacity: 0.9 }} />−1σ {activeStats.minusOneSD.toFixed(2)}</span>
                                <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5" style={{ backgroundColor: stdColors.minusTwo, opacity: 0.9 }} />−2σ {activeStats.minusTwoSD.toFixed(2)}</span>
                            </div>
                        )}
                    </>
                )
            )}

            <div className="mt-3">
                <div className="inline-flex rounded-tremor-small border border-tremor-border bg-tremor-background shadow-tremor-input dark:border-dark-tremor-border dark:bg-gray-950">
                    {TIME_RANGES.map((item, idx) => rangeBtn(item.key, item.label, idx, TIME_RANGES.length))}
                </div>
            </div>
        </section>
    );
}
