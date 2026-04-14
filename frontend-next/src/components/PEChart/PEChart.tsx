'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
    createChart,
    IChartApi,
    ISeriesApi,
    AreaSeries,
    LineSeries,
    HistogramSeries,
    UTCTime,
    CrosshairMode,
    MouseEventParams,
} from 'lightweight-charts';

import { fetchPEChart, fetchPEChartByRange, PEChartData, PEChartResult, ValuationStats } from '@/lib/api';
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

function formatVolume(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toString();
}

function formatPrice(value: number): string {
    return value.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function toUTCTime(d: Date): UTCTime {
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

function formatDate(time: UTCTime): string {
    return `${String(time.day).padStart(2, '0')}/${String(time.month).padStart(2, '0')}/${time.year}`;
}

function utcDayKey(time: UTCTime): string {
    return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
}

function normalizeDailyRows<T>(
    rows: T[],
    getDate: (row: T) => Date,
): T[] {
    const valid = rows
        .filter((row) => {
            const d = getDate(row);
            return Number.isFinite(d.getTime());
        })
        .sort((a, b) => getDate(a).getTime() - getDate(b).getTime());

    const byDay = new Map<string, T>();
    for (const row of valid) {
        const d = getDate(row);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        byDay.set(key, row);
    }
    return Array.from(byDay.values()).sort((a, b) => getDate(a).getTime() - getDate(b).getTime());
}

// ── Chart theme helper ──────────────────────────────────────────────────────

function getChartTheme() {
    const isDark = document.documentElement.classList.contains('dark');
    return {
        isDark,
        textColor: isDark ? '#9ca3af' : '#6b7280',
        borderColor: isDark ? '#374151' : '#e5e7eb',
        crosshairColor: isDark ? '#4b5563' : '#d1d5db',
        bgColor: isDark ? '#111827' : '#ffffff',
        cardBg: isDark ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        cardBorder: isDark ? 'rgba(55, 65, 81, 1)' : 'rgba(229, 231, 235, 1)',
        mutedText: isDark ? '#6b7280' : '#9ca3af',
    };
}

// ── TradingView Area Chart for VN-Index ─────────────────────────────────────

interface TVVNIndexChartProps {
    data: Array<{ time: UTCTime; close: number; volume: number }>;
    isLoading: boolean;
}

function TVVNIndexChart({ data, isLoading }: TVVNIndexChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const areaSeriesRef = useRef<ISeriesApi<'Area'> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const [containerWidth, setContainerWidth] = useState(400);
    const closeByDayRef = useRef<Map<string, number>>(new Map());
    const [tooltipData, setTooltipData] = useState<{
        time: string; close: string; volume: string; change: string; x: number; y: number;
    } | null>(null);

    // Initialize chart (runs once)
    useEffect(() => {
        if (!containerRef.current) return;
        const theme = getChartTheme();

        const chart = createChart(containerRef.current, {
            width: containerRef.current.clientWidth,
            height: 420,
            layout: {
                background: { type: 'solid', color: 'transparent' },
                textColor: theme.textColor,
                fontSize: 11,
                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            },
            grid: {
                vertLines: { visible: true, color: theme.isDark ? 'rgba(55, 65, 81, 0.25)' : 'rgba(229, 231, 235, 0.7)' },
                horzLines: { visible: true, color: theme.isDark ? 'rgba(55, 65, 81, 0.25)' : 'rgba(229, 231, 235, 0.7)' },
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: { color: theme.crosshairColor, width: 1, style: 2, labelBackgroundColor: '#f97316' },
                horzLine: { color: theme.crosshairColor, width: 1, style: 2, labelBackgroundColor: '#f97316' },
            },
            rightPriceScale: {
                borderColor: theme.borderColor,
                scaleMargins: { top: 0.05, bottom: 0.25 },
                entireTextOnly: true,
            },
            timeScale: {
                borderColor: theme.borderColor,
                timeVisible: false,
                rightOffset: 5,
                barSpacing: 6,
                rightBarStaysOnScroll: true,
            },
            handleScroll: { vertTouchDrag: false },
            handleScale: { axisPressedMouseMove: { time: true, price: true } },
        });

        const areaSeries = chart.addSeries(AreaSeries, {
            topColor: 'rgba(249, 115, 22, 0.35)',
            bottomColor: 'rgba(249, 115, 22, 0.02)',
            lineColor: '#f97316',
            lineWidth: 2,
            lineStyle: 0,
            lineType: 2,
            crosshairMarkerRadius: 4,
            crosshairMarkerBackgroundColor: '#f97316',
            crosshairMarkerBorderColor: '#ffffff',
            crosshairMarkerBorderWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
        });

        const volumeSeries = chart.addSeries(HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: '',
            scaleMargins: { top: 0.85, bottom: 0 },
            priceLineVisible: false,
            lastValueVisible: false,
        });

        chart.subscribeCrosshairMove((param: MouseEventParams) => {
            if (!param || !param.time || !param.seriesData) {
                setTooltipData(null);
                return;
            }
            const area = param.seriesData.get(areaSeries);
            const vol = param.seriesData.get(volumeSeries);
            if (!area) { setTooltipData(null); return; }

            const close = area.value as number;
            const volume = vol?.value as number;
            const timeStr = formatDate(param.time as UTCTime);

            const t = param.time as UTCTime;
            const key = utcDayKey(t);
            let change = '';
            const closeByDay = closeByDayRef.current;
            const keys = Array.from(closeByDay.keys());
            const idx = keys.indexOf(key);
            if (idx > 0) {
                const prev = closeByDay.get(keys[idx - 1]) ?? 0;
                const ch = close - prev;
                const pct = prev > 0 ? (ch / prev) * 100 : 0;
                change = `${ch >= 0 ? '+' : ''}${formatPrice(Math.abs(ch))} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
            }

            setTooltipData({
                time: timeStr,
                close: formatPrice(close),
                volume: formatVolume(volume || 0),
                change,
                x: param.point?.x ?? 0,
                y: param.point?.y ?? 0,
            });
        });

        chartRef.current = chart;
        areaSeriesRef.current = areaSeries;
        volumeSeriesRef.current = volumeSeries;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const width = entry.contentRect.width;
                setContainerWidth(width || 400);
                chart.applyOptions({ width, height: width < 640 ? 340 : 420 });
            }
        });
        resizeObserver.observe(containerRef.current);

        return () => {
            resizeObserver.disconnect();
            chart.remove();
            chartRef.current = null;
            areaSeriesRef.current = null;
            volumeSeriesRef.current = null;
        };
    }, []);

    // Update data
    useEffect(() => {
        if (!areaSeriesRef.current || !volumeSeriesRef.current) return;
        if (data.length === 0) return;

        const areaData = data.map((d) => ({ time: d.time, value: d.close }));
        areaSeriesRef.current.setData(areaData);
        closeByDayRef.current = new Map(data.map((d) => [utcDayKey(d.time), d.close]));

        volumeSeriesRef.current.setData(data.map((d, i) => {
            const isUp = i === 0 || d.close >= data[i - 1].close;
            return {
                time: d.time,
                value: d.volume,
                color: isUp ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)',
            };
        }));

        chartRef.current?.timeScale().fitContent();
    }, [data]);

    if (isLoading) {
        return <div className={styles.loading}><div className={styles.loader} /><span>Loading chart data...</span></div>;
    }
    if (!data.length) return <div className={styles.noData}>No data</div>;

    return (
        <div className="relative w-full">
            {/* Floating OHLCV Tooltip */}
            {tooltipData && (
                <div
                    className="pointer-events-none absolute z-20 rounded-lg border px-3.5 py-2.5 text-xs shadow-xl backdrop-blur-md"
                    style={{
                        left: Math.min(tooltipData.x + 16, containerWidth - 220),
                        top: Math.max(tooltipData.y - 12, 8),
                        border: `1px solid ${getChartTheme().cardBorder}`,
                        backgroundColor: getChartTheme().cardBg,
                        color: getChartTheme().isDark ? '#e5e7eb' : '#111827',
                    }}
                >
                    <div className="font-semibold mb-1.5">{tooltipData.time}</div>
                    <div className="grid grid-cols-2 gap-x-5 gap-y-1">
                        <span style={{ color: getChartTheme().mutedText }}>VN-Index</span>
                        <span className="font-mono text-right font-bold text-orange-500">{tooltipData.close}</span>
                        <span style={{ color: getChartTheme().mutedText }}>Khối lượng</span>
                        <span className="font-mono text-right">{tooltipData.volume}</span>
                        {tooltipData.change && (
                            <>
                                <span style={{ color: getChartTheme().mutedText }}>Thay đổi</span>
                                <span className={`font-mono text-right font-semibold ${tooltipData.change.startsWith('+') ? 'text-emerald-500' : 'text-red-500'}`}>
                                    {tooltipData.change}
                                </span>
                            </>
                        )}
                    </div>
                </div>
            )}
            <div ref={containerRef} className="w-full" style={{ height: '420px' }} />
        </div>
    );
}

// ── TradingView Line Chart for PE/PB with σ bands ───────────────────────────

interface TVRatioChartProps {
    data: Array<{ time: UTCTime; value: number }>;
    stats: ValuationStats | undefined;
    ratioColor: string;
    ratioName: string;
    isLoading: boolean;
}

function TVRatioChart({ data, stats, ratioColor, ratioName, isLoading }: TVRatioChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const [containerWidth, setContainerWidth] = useState(400);
    const createdPriceLinesRef = useRef<ReturnType<ISeriesApi<'Line'>['createPriceLine']>[]>([]);
    const [tooltipData, setTooltipData] = useState<{
        time: string; value: string; zone: string; x: number; y: number;
    } | null>(null);

    const getZone = useCallback((val: number): string => {
        if (!stats) return 'Normal range';
        if (val >= stats.plusTwoSD)       return '+2σ · Overvalued';
        if (val >= stats.plusOneSD)       return '+1σ · Expensive';
        if (val <= stats.minusTwoSD)      return '−2σ · Deeply undervalued';
        if (val <= stats.minusOneSD)      return '−1σ · Cheap';
        return 'Normal range';
    }, [stats]);

    // Initialize chart (runs once)
    useEffect(() => {
        if (!containerRef.current) return;
        const theme = getChartTheme();

        const chart = createChart(containerRef.current, {
            width: containerRef.current.clientWidth,
            height: 420,
            layout: {
                background: { type: 'solid', color: 'transparent' },
                textColor: theme.textColor,
                fontSize: 11,
                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            },
            grid: {
                vertLines: { visible: true, color: theme.isDark ? 'rgba(55, 65, 81, 0.25)' : 'rgba(229, 231, 235, 0.7)' },
                horzLines: { visible: true, color: theme.isDark ? 'rgba(55, 65, 81, 0.25)' : 'rgba(229, 231, 235, 0.7)' },
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: { color: theme.crosshairColor, width: 1, style: 2, labelBackgroundColor: ratioColor },
                horzLine: { color: theme.crosshairColor, width: 1, style: 2, labelBackgroundColor: ratioColor },
            },
            rightPriceScale: {
                borderColor: theme.borderColor,
                scaleMargins: { top: 0.08, bottom: 0.08 },
                entireTextOnly: true,
            },
            timeScale: {
                borderColor: theme.borderColor,
                timeVisible: false,
                rightOffset: 5,
                barSpacing: 6,
                rightBarStaysOnScroll: true,
            },
            handleScroll: { vertTouchDrag: false },
            handleScale: { axisPressedMouseMove: { time: true, price: true } },
        });

        const lineSeries = chart.addSeries(LineSeries, {
            color: ratioColor,
            lineWidth: 2,
            lineStyle: 0,
            lineType: 2,
            crosshairMarkerRadius: 4,
            crosshairMarkerBackgroundColor: ratioColor,
            crosshairMarkerBorderColor: '#ffffff',
            crosshairMarkerBorderWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
        });

        chart.subscribeCrosshairMove((param: MouseEventParams) => {
            if (!param || !param.time || !param.seriesData) {
                setTooltipData(null);
                return;
            }
            const line = param.seriesData.get(lineSeries);
            if (!line) { setTooltipData(null); return; }

            const val = line.value as number;
            const timeStr = formatDate(param.time as UTCTime);
            setTooltipData({
                time: timeStr,
                value: val.toFixed(2),
                zone: getZone(val),
                x: param.point?.x ?? 0,
                y: param.point?.y ?? 0,
            });
        });

        chartRef.current = chart;
        lineSeriesRef.current = lineSeries;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const width = entry.contentRect.width;
                setContainerWidth(width || 400);
                chart.applyOptions({ width, height: width < 640 ? 340 : 420 });
            }
        });
        resizeObserver.observe(containerRef.current);

        return () => {
            resizeObserver.disconnect();
            chart.remove();
            chartRef.current = null;
            lineSeriesRef.current = null;
            createdPriceLinesRef.current = [];
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Update data
    useEffect(() => {
        if (!lineSeriesRef.current) return;
        if (data.length === 0) return;

        lineSeriesRef.current.setData(data.map(d => ({ time: d.time, value: d.value })));
        chartRef.current?.timeScale().fitContent();
    }, [data]);

    // Update σ price lines when stats change
    useEffect(() => {
        if (!lineSeriesRef.current || !chartRef.current) return;
        const series = lineSeriesRef.current;

        for (const line of createdPriceLinesRef.current) {
            series.removePriceLine(line);
        }
        createdPriceLinesRef.current = [];

        if (!stats) return;

        const addLine = (value: number, color: string, label: string) => {
            const line = series.createPriceLine({
                price: value,
                color,
                lineWidth: 1,
                lineStyle: 2,
                axisLabelVisible: true,
                title: label,
            });
            createdPriceLinesRef.current.push(line);
        };

        if (stats.plusTwoSD != null)  addLine(stats.plusTwoSD,  '#ef4444', `+2σ ${stats.plusTwoSD.toFixed(2)}`);
        if (stats.plusOneSD != null)  addLine(stats.plusOneSD,  '#f97316', `+1σ ${stats.plusOneSD.toFixed(2)}`);
        if (stats.average != null)    addLine(stats.average,    '#94a3b8', `avg ${stats.average.toFixed(2)}`);
        if (stats.minusOneSD != null) addLine(stats.minusOneSD, '#22c55e', `−1σ ${stats.minusOneSD.toFixed(2)}`);
        if (stats.minusTwoSD != null) addLine(stats.minusTwoSD, '#3b82f6', `−2σ ${stats.minusTwoSD.toFixed(2)}`);
    }, [stats]);

    if (isLoading) {
        return <div className={styles.loading}><div className={styles.loader} /><span>Loading chart data...</span></div>;
    }
    if (!data.length) return <div className={styles.noData}>No data</div>;

    const stdColors = {
        plusTwo: '#ef4444', plusOne: '#f97316', average: '#94a3b8',
        minusOne: '#22c55e', minusTwo: '#3b82f6',
    };

    return (
        <div className="relative w-full">
            {tooltipData && (
                <div
                    className="pointer-events-none absolute z-20 rounded-lg border px-3.5 py-2.5 text-xs shadow-xl backdrop-blur-md"
                    style={{
                        left: Math.min(tooltipData.x + 16, containerWidth - 240),
                        top: Math.max(tooltipData.y - 12, 8),
                        border: `1px solid ${getChartTheme().cardBorder}`,
                        backgroundColor: getChartTheme().cardBg,
                        color: getChartTheme().isDark ? '#e5e7eb' : '#111827',
                    }}
                >
                    <div className="font-semibold mb-1.5">{tooltipData.time}</div>
                    <div className="grid grid-cols-2 gap-x-5 gap-y-1">
                        <span style={{ color: getChartTheme().mutedText }}>{ratioName}</span>
                        <span className="font-mono text-right font-bold" style={{ color: ratioColor }}>{tooltipData.value}</span>
                        <span style={{ color: getChartTheme().mutedText }}>Định giá</span>
                        <span className="font-mono text-right text-[11px] font-medium">{tooltipData.zone}</span>
                    </div>
                </div>
            )}
            <div ref={containerRef} className="w-full" style={{ height: '420px' }} />
            {stats && (
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]" style={{ color: getChartTheme().mutedText }}>
                    <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-6 rounded" style={{ backgroundColor: stdColors.plusTwo }} />+2σ {stats.plusTwoSD.toFixed(2)}</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-6 rounded" style={{ backgroundColor: stdColors.plusOne }} />+1σ {stats.plusOneSD.toFixed(2)}</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-6 rounded" style={{ backgroundColor: stdColors.average }} />avg {stats.average.toFixed(2)}</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-6 rounded" style={{ backgroundColor: stdColors.minusOne }} />−1σ {stats.minusOneSD.toFixed(2)}</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-6 rounded" style={{ backgroundColor: stdColors.minusTwo }} />−2σ {stats.minusTwoSD.toFixed(2)}</span>
                </div>
            )}
        </div>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────

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
    const cacheRef = useRef<Partial<Record<TimeRange, PEChartResult>>>({});
    const abortRef = useRef<AbortController | null>(null);

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

    // Fetch initial data
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

    // Fetch time range data
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

    const normalizedSeries = useMemo(() => {
        const rows = normalizeDailyRows(result.series, (row) => row.date instanceof Date ? row.date : new Date(row.date as any));
        return rows;
    }, [result.series]);

    const { stats } = result;

    const currentStats = useMemo(() => {
        if (!normalizedSeries.length) return { pe: null, pb: null, vnindex: null };
        const last = normalizedSeries[normalizedSeries.length - 1];
        return { pe: last.pe, pb: last.pb, vnindex: last.vnindex };
    }, [normalizedSeries]);

    // ── VN-Index TradingView data ──────────────────────────────────────────
    const vnTVData = useMemo(() => {
        const cutoff = getCutoffDate(timeRange);
        let filtered = normalizedSeries.filter(d => d.vnindex != null && Number.isFinite(d.vnindex));
        if (cutoff) filtered = filtered.filter(d => d.date >= cutoff);
        return filtered.map(d => ({
            time: toUTCTime(d.date),
            close: d.vnindex!,
            volume: d.volume ?? 0,
        }));
    }, [normalizedSeries, timeRange]);

    // ── PE/PB TradingView data ─────────────────────────────────────────────
    const ratioTVData = useMemo(() => {
        const field = activeChart as 'pe' | 'pb';
        const cutoff = getCutoffDate(timeRange);
        let filtered = normalizedSeries.filter(d => d[field] != null && Number.isFinite(d[field] as number));
        if (cutoff) filtered = filtered.filter(d => d.date >= cutoff);
        return filtered.map(d => ({
            time: toUTCTime(d.date),
            value: d[field]!,
        }));
    }, [normalizedSeries, timeRange, activeChart]);

    const activeStats: ValuationStats | undefined =
        activeChart === 'pe' ? stats.pe : activeChart === 'pb' ? stats.pb : undefined;
    const ratioColor = activeChart === 'pe' ? '#818cf8' : '#34d399';
    const ratioName  = activeChart === 'pe' ? 'P/E TTM' : 'P/B TTM';

    // ── Tab / Range buttons ────────────────────────────────────────────────
    const cx = (...classes: (string | false | undefined | null)[]) => classes.filter(Boolean).join(' ');

    const tabBtn = (key: ActiveChart, label: string) => (
        <button key={key} type="button" onClick={() => setActiveChart(key)}
            className={cx(
                'flex-1 rounded-md px-4 py-2 text-[11px] font-semibold tracking-wide uppercase transition-all duration-200 text-center',
                activeChart === key
                    ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/20'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800/50'
            )}>
            {label}
        </button>
    );

    const rangeBtn = (key: TimeRange, label: string) => (
        <button key={key} type="button" onClick={() => setTimeRange(key)}
            className={cx(
                'px-3 py-1.5 text-[11px] font-semibold transition-all duration-200',
                timeRange === key
                    ? 'bg-indigo-600 text-white rounded-md shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800/50'
            )}>
            {label}
        </button>
    );

    const theme = getChartTheme();

    return (
        <section className="rounded-xl border overflow-hidden" style={{ borderColor: theme.borderColor, backgroundColor: theme.isDark ? '#0f1117' : '#ffffff', boxShadow: theme.isDark ? '0 4px 24px rgba(0,0,0,0.4)' : '0 1px 8px rgba(0,0,0,0.06)' }}>
            {/* ── Header: Tabs + Current Values ── */}
            <div className="p-4 pb-0 space-y-3">
                {/* Chart type tabs */}
                <div className="flex gap-1 rounded-lg p-1" style={{ backgroundColor: theme.isDark ? 'rgba(30,30,40,0.8)' : '#f3f4f6' }}>
                    {CHART_TABS.map(t => tabBtn(t.key, t.label))}
                </div>

                {/* Current values */}
                <div className="flex flex-wrap items-center gap-5">
                    {currentStats.vnindex != null && (
                        <div className="flex items-baseline gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-orange-500">VN-Index</span>
                            <span className="text-lg font-bold tabular-nums" style={{ color: theme.isDark ? '#f3f4f6' : '#111827' }}>
                                {currentStats.vnindex.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                        </div>
                    )}
                    {currentStats.pe != null && (
                        <div className="flex items-baseline gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: ratioColor === '#818cf8' ? '#818cf8' : '#6366f1' }}>P/E</span>
                            <span className="text-lg font-bold tabular-nums" style={{ color: theme.isDark ? '#f3f4f6' : '#111827' }}>{currentStats.pe.toFixed(2)}</span>
                        </div>
                    )}
                    {currentStats.pb != null && (
                        <div className="flex items-baseline gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: ratioColor === '#34d399' ? '#34d399' : '#10b981' }}>P/B</span>
                            <span className="text-lg font-bold tabular-nums" style={{ color: theme.isDark ? '#f3f4f6' : '#111827' }}>{currentStats.pb.toFixed(2)}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Chart area ── */}
            <div className="px-2">
                {activeChart === 'vnindex' ? (
                    <TVVNIndexChart data={vnTVData} isLoading={isLoading} />
                ) : (
                    <TVRatioChart
                        data={ratioTVData}
                        stats={activeStats}
                        ratioColor={ratioColor}
                        ratioName={ratioName}
                        isLoading={isLoading}
                    />
                )}
            </div>

            {/* ── Time Range Selector ── */}
            <div className="px-4 pb-3 flex items-center justify-between">
                <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ backgroundColor: theme.isDark ? 'rgba(30,30,40,0.8)' : '#f3f4f6' }}>
                    {TIME_RANGES.map((item) => rangeBtn(item.key, item.label))}
                </div>
                <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: theme.mutedText }}>
                    Powered by VCI
                </span>
            </div>
        </section>
    );
}
