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

type ActiveChart = 'vnindex' | 'pe' | 'pb';

const CHART_TABS: { key: ActiveChart; label: string }[] = [
    { key: 'vnindex', label: 'VN-Index' },
    { key: 'pe',      label: 'P/E TTM'  },
    { key: 'pb',      label: 'P/B TTM'  },
];

const RATIO_COLOR: Record<ActiveChart, string> = {
    vnindex: '#f97316',
    pe:      '#818cf8',
    pb:      '#34d399',
};


function formatVolume(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000)     return `${(value / 1_000).toFixed(1)}K`;
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

function toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function normalizeDailyRows<T>(rows: T[], getDate: (row: T) => Date): T[] {
    const valid = rows
        .filter((row) => Number.isFinite(getDate(row).getTime()))
        .sort((a, b) => getDate(a).getTime() - getDate(b).getTime());
    const byDay = new Map<string, T>();
    for (const row of valid) {
        const d = getDate(row);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        byDay.set(key, row);
    }
    return Array.from(byDay.values()).sort((a, b) => getDate(a).getTime() - getDate(b).getTime());
}

function buildTheme(isDark: boolean) {
    return {
        isDark,
        text:         isDark ? '#9ca3af' : '#6b7280',
        border:       isDark ? '#2d3748' : '#e5e7eb',
        crosshair:    isDark ? '#4b5563' : '#d1d5db',
        gridLine:     isDark ? 'rgba(55,65,81,0.3)' : 'rgba(229,231,235,0.6)',
        tooltipBg:    isDark ? 'rgba(15,23,42,0.97)' : 'rgba(255,255,255,0.97)',
        tooltipBorder:isDark ? '#334155' : '#e2e8f0',
        tooltipText:  isDark ? '#e2e8f0' : '#0f172a',
        tooltipMuted: isDark ? '#64748b' : '#94a3b8',
        wrapperBg:    isDark ? '#0f172a' : '#ffffff',
        wrapperShadow:isDark ? '0 1px 8px rgba(0,0,0,0.3)' : '0 1px 4px rgba(0,0,0,0.06)',
    };
}

/** Reactive dark-mode hook — watches the <html> class list */
function useDarkMode(): boolean {
    const [isDark, setIsDark] = useState<boolean>(() =>
        typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
    );
    useEffect(() => {
        const obs = new MutationObserver(() => {
            setIsDark(document.documentElement.classList.contains('dark'));
        });
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => obs.disconnect();
    }, []);
    return isDark;
}

function ToolbarButton({
    active,
    label,
    color,
    onClick,
}: {
    active: boolean;
    label: string;
    color?: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                active
                    ? 'text-white shadow-sm'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
            }`}
            style={active ? { backgroundColor: color ?? '#2563eb' } : undefined}
        >
            {label}
        </button>
    );
}

// ── Types ────────────────────────────────────────────────────────────────────

interface VNData { time: UTCTime; close: number; volume: number }
interface RatioData { time: UTCTime; value: number }

type TooltipState = {
    time: string;
    mainValue: string;
    subLabel: string;
    subValue: string;
    change?: string;
    x: number;
    y: number;
} | null;

// ── Props ─────────────────────────────────────────────────────────────────────

interface PEChartProps {
    initialData?: PEChartData[];
    externalData?: PEChartData[];
    useExternalOnly?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PEChart({ initialData = [], externalData = [], useExternalOnly = false }: PEChartProps) {
    // ── Dark mode (reactive) ─────────────────────────────────────────────────
    const isDark = useDarkMode();
    const theme  = useMemo(() => buildTheme(isDark), [isDark]);

    // ── Data state ───────────────────────────────────────────────────────────
    const [result, setResult]           = useState<PEChartResult>({ series: initialData, stats: {} });
    const [activeChart, setActiveChart] = useState<ActiveChart>('vnindex');
    const [isLoading, setIsLoading]     = useState(initialData.length === 0);
    const abortRef = useRef<AbortController | null>(null);

    // ── Chart refs ───────────────────────────────────────────────────────────
    const containerRef      = useRef<HTMLDivElement>(null);
    const chartRef          = useRef<IChartApi | null>(null);
    const areaSeriesRef     = useRef<ISeriesApi<'Area'> | null>(null);
    const volumeSeriesRef   = useRef<ISeriesApi<'Histogram'> | null>(null);
    const lineSeriesRef     = useRef<ISeriesApi<'Line'> | null>(null);
    const priceLinesRef     = useRef<ReturnType<ISeriesApi<'Line'>['createPriceLine']>[]>([]);
    const closeByDayRef     = useRef<Map<string, number>>(new Map());
    const activeChartRef    = useRef<ActiveChart>('vnindex');
    const [tooltip, setTooltip] = useState<TooltipState>(null);
    const [containerWidth, setContainerWidth] = useState(600);

    // keep ref in sync
    useEffect(() => { activeChartRef.current = activeChart; }, [activeChart]);

    // ── Derived / memoized data ───────────────────────────────────────────────

    const normalizedSeries = useMemo(() => normalizeDailyRows(
        result.series,
        (row) => row.date instanceof Date ? row.date : new Date(row.date as string),
    ), [result.series]);

    const currentStats = useMemo(() => {
        if (!normalizedSeries.length) return { pe: null, pb: null, vnindex: null };
        const last = normalizedSeries[normalizedSeries.length - 1];
        return {
            pe:      toFiniteNumber(last.pe),
            pb:      toFiniteNumber(last.pb),
            vnindex: toFiniteNumber(last.vnindex),
        };
    }, [normalizedSeries]);

    // Always show all available data — no cutoff
    const vnTVData = useMemo<VNData[]>(() =>
        normalizedSeries
            .filter(d => toFiniteNumber(d.vnindex) !== null)
            .map(d => ({ time: toUTCTime(d.date), close: toFiniteNumber(d.vnindex) ?? 0, volume: toFiniteNumber(d.volume) ?? 0 })),
    [normalizedSeries]);

    const peTVData = useMemo<RatioData[]>(() =>
        normalizedSeries
            .filter(d => toFiniteNumber(d.pe) !== null)
            .map(d => ({ time: toUTCTime(d.date), value: toFiniteNumber(d.pe) ?? 0 })),
    [normalizedSeries]);

    const pbTVData = useMemo<RatioData[]>(() =>
        normalizedSeries
            .filter(d => toFiniteNumber(d.pb) !== null)
            .map(d => ({ time: toUTCTime(d.date), value: toFiniteNumber(d.pb) ?? 0 })),
    [normalizedSeries]);

    const activeStats: ValuationStats | undefined = useMemo(() =>
        activeChart === 'pe' ? result.stats?.pe :
        activeChart === 'pb' ? result.stats?.pb :
        undefined,
    [activeChart, result.stats]);

    // ── Sync chart colors when dark mode changes ──────────────────────────────
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        chart.applyOptions({
            layout:          { textColor: theme.text },
            grid:            { vertLines: { color: theme.gridLine }, horzLines: { color: theme.gridLine } },
            rightPriceScale: { borderColor: theme.border },
            timeScale:       { borderColor: theme.border },
            crosshair:       {
                vertLine: { color: theme.crosshair },
                horzLine: { color: theme.crosshair },
            },
        });
    }, [theme]);

    // ── Chart init (runs once) ────────────────────────────────────────────────
    useEffect(() => {
        if (!containerRef.current || chartRef.current) return;

        const initTheme = buildTheme(document.documentElement.classList.contains('dark'));
        const chart = createChart(containerRef.current, {
            width:  containerRef.current.clientWidth,
            height: 420,
            layout: {
                background:  { type: 'solid', color: 'transparent' },
                textColor:   theme.text,
                fontSize:    11,
                fontFamily:  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            },
            grid: {
                vertLines: { color: theme.gridLine },
                horzLines: { color: theme.gridLine },
            },
            crosshair: {
                mode:     CrosshairMode.Normal,
                vertLine: { color: theme.crosshair, width: 1, style: 2, labelBackgroundColor: RATIO_COLOR.vnindex },
                horzLine: { color: theme.crosshair, width: 1, style: 2, labelBackgroundColor: RATIO_COLOR.vnindex },
            },
            rightPriceScale: {
                borderColor:   theme.border,
                scaleMargins:  { top: 0.08, bottom: 0.28 },
                entireTextOnly: true,
            },
            timeScale: {
                borderColor:          theme.border,
                timeVisible:          false,
                rightOffset:          5,
                barSpacing:           6,
                rightBarStaysOnScroll: true,
            },
            handleScroll: { vertTouchDrag: false },
            handleScale:  { axisPressedMouseMove: { time: true, price: true } },
        });

        // Area series (VN-Index)
        const areaSeries = chart.addSeries(AreaSeries, {
            topColor:                     'rgba(249,115,22,0.30)',
            bottomColor:                  'rgba(249,115,22,0.01)',
            lineColor:                    '#f97316',
            lineWidth:                    2,
            lineType:                     2,
            crosshairMarkerRadius:        4,
            crosshairMarkerBackgroundColor: '#f97316',
            crosshairMarkerBorderColor:   '#ffffff',
            crosshairMarkerBorderWidth:   2,
            priceLineVisible:             false,
            lastValueVisible:             true,
        });

        // Volume histogram
        const volumeSeries = chart.addSeries(HistogramSeries, {
            priceFormat:      { type: 'volume' },
            priceScaleId:     '',
            scaleMargins:     { top: 0.82, bottom: 0 },
            priceLineVisible: false,
            lastValueVisible: false,
        });

        // Line series (PE / PB) — hidden initially
        const lineSeries = chart.addSeries(LineSeries, {
            visible:                      false,
            color:                        RATIO_COLOR.pe,
            lineWidth:                    2,
            lineType:                     2,
            crosshairMarkerRadius:        4,
            crosshairMarkerBackgroundColor: RATIO_COLOR.pe,
            crosshairMarkerBorderColor:   '#ffffff',
            crosshairMarkerBorderWidth:   2,
            priceLineVisible:             false,
            lastValueVisible:             true,
        });

        // Crosshair tooltip
        chart.subscribeCrosshairMove((param: MouseEventParams) => {
            if (!param?.time || !param?.seriesData) { setTooltip(null); return; }
            const current = activeChartRef.current;

            if (current === 'vnindex') {
                const areaVal = param.seriesData.get(areaSeries);
                const volVal  = param.seriesData.get(volumeSeries);
                if (!areaVal) { setTooltip(null); return; }

                const close  = areaVal.value as number;
                const volume = (volVal?.value as number) ?? 0;
                const t      = param.time as UTCTime;
                const key    = utcDayKey(t);
                const keys   = Array.from(closeByDayRef.current.keys());
                const idx    = keys.indexOf(key);
                let change   = '';
                if (idx > 0) {
                    const prev = closeByDayRef.current.get(keys[idx - 1]) ?? 0;
                    const ch   = close - prev;
                    const pct  = prev > 0 ? (ch / prev) * 100 : 0;
                    change = `${ch >= 0 ? '+' : ''}${formatPrice(Math.abs(ch))} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
                }
                setTooltip({
                    time:       formatDate(t),
                    mainValue:  formatPrice(close),
                    subLabel:   'Volume',
                    subValue:   formatVolume(volume),
                    change:     change || undefined,
                    x: param.point?.x ?? 0,
                    y: param.point?.y ?? 0,
                });
            } else {
                const lineVal = param.seriesData.get(lineSeries);
                if (!lineVal) { setTooltip(null); return; }
                const val = lineVal.value as number;
                setTooltip({
                    time:      formatDate(param.time as UTCTime),
                    mainValue: val.toFixed(2),
                    subLabel:  '',
                    subValue:  '',
                    x: param.point?.x ?? 0,
                    y: param.point?.y ?? 0,
                });
            }
        });

        chartRef.current    = chart;
        areaSeriesRef.current   = areaSeries;
        volumeSeriesRef.current = volumeSeries;
        lineSeriesRef.current   = lineSeries;

        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const w = entry.contentRect.width;
                setContainerWidth(w || 600);
                chart.applyOptions({ width: w, height: w < 640 ? 320 : 420 });
            }
        });
        ro.observe(containerRef.current);

        return () => {
            ro.disconnect();
            chart.remove();
            chartRef.current    = null;
            areaSeriesRef.current   = null;
            volumeSeriesRef.current = null;
            lineSeriesRef.current   = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Push VNIndex data ─────────────────────────────────────────────────────
    useEffect(() => {
        if (!areaSeriesRef.current || !volumeSeriesRef.current) return;
        if (!vnTVData.length) return;

        areaSeriesRef.current.setData(vnTVData.map(d => ({ time: d.time, value: d.close })));
        closeByDayRef.current = new Map(vnTVData.map(d => [utcDayKey(d.time), d.close]));

        volumeSeriesRef.current.setData(vnTVData.map((d, i) => ({
            time:  d.time,
            value: d.volume,
            color: i === 0 || d.close >= vnTVData[i - 1].close
                ? 'rgba(34,197,94,0.45)'
                : 'rgba(239,68,68,0.45)',
        })));

        if (activeChart === 'vnindex') {
            const total = vnTVData.length;
            chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, total - 252), to: total + 3 });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vnTVData]);

    // ── Push PE data ──────────────────────────────────────────────────────────
    useEffect(() => {
        if (!lineSeriesRef.current) return;
        if (!peTVData.length || activeChart !== 'pe') return;
        lineSeriesRef.current.setData(peTVData);
        const total = peTVData.length;
        chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, total - 252), to: total + 3 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [peTVData]);

    // ── Push PB data ──────────────────────────────────────────────────────────
    useEffect(() => {
        if (!lineSeriesRef.current) return;
        if (!pbTVData.length || activeChart !== 'pb') return;
        lineSeriesRef.current.setData(pbTVData);
        const total = pbTVData.length;
        chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, total - 252), to: total + 3 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pbTVData]);

    // ── Tab switch: toggle series visibility ──────────────────────────────────
    useEffect(() => {
        const area   = areaSeriesRef.current;
        const volume = volumeSeriesRef.current;
        const line   = lineSeriesRef.current;
        const chart  = chartRef.current;
        if (!area || !volume || !line || !chart) return;

        const isVN = activeChart === 'vnindex';
        const color = RATIO_COLOR[activeChart];

        area.applyOptions({ visible: isVN });
        volume.applyOptions({ visible: isVN });
        line.applyOptions({ visible: !isVN, color });

        // Update crosshair label colour
        chart.applyOptions({
            crosshair: {
                vertLine: { labelBackgroundColor: color },
                horzLine: { labelBackgroundColor: color },
            },
        });

        // Push correct data when switching tabs
        if (!isVN) {
            const ratioData = activeChart === 'pe' ? peTVData : pbTVData;
            if (ratioData.length) {
                line.setData(ratioData);
            }
        } else if (vnTVData.length) {
            area.setData(vnTVData.map(d => ({ time: d.time, value: d.close })));
            volume.setData(vnTVData.map((d, i) => ({
                time:  d.time,
                value: d.volume,
                color: i === 0 || d.close >= vnTVData[i - 1].close
                    ? 'rgba(34,197,94,0.45)'
                    : 'rgba(239,68,68,0.45)',
            })));
        }

        const total = isVN ? vnTVData.length : (activeChart === 'pe' ? peTVData.length : pbTVData.length);
        if (total > 0) {
            chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, total - 252), to: total + 3 });
        }
        setTooltip(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeChart]);

    // ── σ price lines ─────────────────────────────────────────────────────────
    useEffect(() => {
        const series = lineSeriesRef.current;
        if (!series) return;

        for (const pl of priceLinesRef.current) series.removePriceLine(pl);
        priceLinesRef.current = [];

        if (!activeStats) return;

        const add = (value: number, color: string, title: string) => {
            priceLinesRef.current.push(series.createPriceLine({
                price: value, color, lineWidth: 1, lineStyle: 2,
                axisLabelVisible: true, title,
            }));
        };

        if (activeStats.plusTwoSD  != null) add(activeStats.plusTwoSD,  '#ef4444', `+2σ ${activeStats.plusTwoSD.toFixed(2)}`);
        if (activeStats.plusOneSD  != null) add(activeStats.plusOneSD,  '#f97316', `+1σ ${activeStats.plusOneSD.toFixed(2)}`);
        if (activeStats.average    != null) add(activeStats.average,    '#64748b', `avg ${activeStats.average.toFixed(2)}`);
        if (activeStats.minusOneSD != null) add(activeStats.minusOneSD, '#22c55e', `−1σ ${activeStats.minusOneSD.toFixed(2)}`);
        if (activeStats.minusTwoSD != null) add(activeStats.minusTwoSD, '#3b82f6', `−2σ ${activeStats.minusTwoSD.toFixed(2)}`);
    }, [activeStats]);

    // ── Data fetching ─────────────────────────────────────────────────────────
    useEffect(() => {
        if (externalData.length > 0) {
            setResult(r => ({ ...r, series: externalData }));
            setIsLoading(false);
            return;
        }
        if (initialData.length > 0) return;

        const ctrl = new AbortController();
        abortRef.current = ctrl;
        // Fetch 6M data immediately for fast initial render; external data will
        // replace it if/when the parent's bundled overview-refresh completes.
        fetchPEChartByRange('6M', 'both', { signal: ctrl.signal })
            .then(r => { setResult(r); setIsLoading(false); })
            .catch(() => setIsLoading(false));
        return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── σ legend ──────────────────────────────────────────────────────────────
    const stdColors = { plusTwo: '#ef4444', plusOne: '#f97316', average: '#64748b', minusOne: '#22c55e', minusTwo: '#3b82f6' };

    // ── Legend value ──────────────────────────────────────────────────────────
    const legendValue = useMemo(() => {
        if (activeChart === 'vnindex') {
            return currentStats.vnindex != null
                ? currentStats.vnindex.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : null;
        }
        const val = activeChart === 'pe' ? currentStats.pe : currentStats.pb;
        return val != null ? val.toFixed(2) : null;
    }, [activeChart, currentStats]);

    const legendLabel = activeChart === 'vnindex' ? 'VN-Index' : activeChart === 'pe' ? 'P/E TTM' : 'P/B TTM';
    const legendColor = RATIO_COLOR[activeChart];

    return (
        <div
            className="overflow-hidden rounded-xl border"
            style={{
                borderColor:     theme.border,
                backgroundColor: theme.isDark ? '#0f172a' : '#ffffff',
                boxShadow:       theme.isDark ? '0 1px 8px rgba(0,0,0,0.3)' : '0 1px 4px rgba(0,0,0,0.06)',
            }}
        >
            {/* ── Toolbar — chart type tabs only ── */}
            <div
                className="flex items-center gap-0.5 px-3 py-2 border-b"
                style={{ borderColor: theme.border }}
            >
                {CHART_TABS.map(t => (
                    <ToolbarButton
                        key={t.key}
                        active={activeChart === t.key}
                        label={t.label}
                        color={RATIO_COLOR[t.key]}
                        onClick={() => setActiveChart(t.key)}
                    />
                ))}
            </div>

            {/* ── Chart area ── */}
            <div className="relative">
                {/* Legend overlay (top-left, TradingView style) */}
                <div className="absolute top-2 left-3 z-10 flex items-center gap-2 select-none pointer-events-none">
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: legendColor }}>
                        {legendLabel}
                    </span>
                    {legendValue && (
                        <span
                            className="text-sm font-bold tabular-nums"
                            style={{ color: theme.isDark ? '#f1f5f9' : '#0f172a' }}
                        >
                            {legendValue}
                        </span>
                    )}
                </div>

                {/* Loading overlay — does NOT unmount the chart */}
                {isLoading && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center"
                        style={{ backgroundColor: theme.isDark ? 'rgba(15,23,42,0.5)' : 'rgba(255,255,255,0.6)' }}
                    >
                        <div className="flex items-center gap-2 text-xs" style={{ color: theme.text }}>
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                            </svg>
                            Loading…
                        </div>
                    </div>
                )}

                {/* Crosshair tooltip */}
                {tooltip && (
                    <div
                        className="pointer-events-none absolute z-30 rounded-lg px-3 py-2 text-xs shadow-xl"
                        style={{
                            left:            Math.min(tooltip.x + 14, containerWidth - 200),
                            top:             Math.max(tooltip.y - 10, 36),
                            backgroundColor: theme.tooltipBg,
                            border:          `1px solid ${theme.tooltipBorder}`,
                            color:           theme.tooltipText,
                        }}
                    >
                        <div className="font-semibold mb-1" style={{ color: theme.tooltipMuted }}>{tooltip.time}</div>
                        <div className="grid gap-y-0.5" style={{ gridTemplateColumns: 'auto auto', columnGap: '16px' }}>
                            <span style={{ color: theme.tooltipMuted }}>{legendLabel}</span>
                            <span className="font-bold text-right" style={{ color: legendColor }}>{tooltip.mainValue}</span>
                            {tooltip.subLabel && tooltip.subValue && (
                                <>
                                    <span style={{ color: theme.tooltipMuted }}>{tooltip.subLabel}</span>
                                    <span className="text-right">{tooltip.subValue}</span>
                                </>
                            )}
                            {tooltip.change && (
                                <>
                                    <span style={{ color: theme.tooltipMuted }}>Change</span>
                                    <span className={`text-right font-semibold ${tooltip.change.startsWith('+') ? 'text-emerald-500' : 'text-red-500'}`}>
                                        {tooltip.change}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* Chart container — always mounted so the instance is never destroyed */}
                <div ref={containerRef} className="w-full" style={{ height: '420px' }} />
            </div>

            {/* ── σ legend for PE/PB ── */}
            {activeStats && (
                <div
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 border-t text-[11px]"
                    style={{ borderColor: theme.border, color: theme.text }}
                >
                    {[
                        { color: stdColors.plusTwo,  label: `+2σ  ${activeStats.plusTwoSD?.toFixed(2)}` },
                        { color: stdColors.plusOne,  label: `+1σ  ${activeStats.plusOneSD?.toFixed(2)}` },
                        { color: stdColors.average,  label: `avg  ${activeStats.average?.toFixed(2)}`   },
                        { color: stdColors.minusOne, label: `−1σ  ${activeStats.minusOneSD?.toFixed(2)}` },
                        { color: stdColors.minusTwo, label: `−2σ  ${activeStats.minusTwoSD?.toFixed(2)}` },
                    ].map(({ color, label }) => (
                        <span key={label} className="flex items-center gap-1.5">
                            <span className="inline-block h-[2px] w-5 rounded" style={{ backgroundColor: color }} />
                            {label}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
