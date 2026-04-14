'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
    createChart,
    IChartApi,
    ISeriesApi,
    CandlestickSeries,
    HistogramSeries,
    Time,
    UTCTime,
    CrosshairMode,
    MouseEventParams,
} from 'lightweight-charts';

interface HistoricalData {
    time: string | number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

type Interval = 'D' | 'W' | 'M';

const INTERVAL_LABELS: Record<Interval, string> = { D: '1D', W: '1W', M: '1M' };
const INTERVAL_CYCLE: Record<Interval, Interval> = { D: 'W', W: 'M', M: 'D' };

// Default bars to show per interval (~5 months of data)
const INTERVAL_BARS: Record<Interval, number> = { D: 105, W: 22, M: 6 };

interface TradingViewChartProps {
    data: HistoricalData[];
    isLoading: boolean;
}

// ── Displayed bar (latest OR hovered candle) ──────────────────────────────────
interface BarDisplay {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    change: number;
    changePct: number;
}

function buildTheme(isDark: boolean) {
    return {
        isDark,
        text:      isDark ? '#9ca3af' : '#6b7280',
        border:    isDark ? '#374151' : '#e5e7eb',
        gridLine:  isDark ? 'rgba(55,65,81,0.25)' : 'rgba(229,231,235,0.7)',
        crosshair: isDark ? '#4b5563' : '#cbd5e1',
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

function toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function toUTCTime(time: string | number): UTCTime {
    const d = new Date(time);
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

function dayKey(time: string | number): string {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatVolume(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000)     return `${(value / 1_000).toFixed(1)}K`;
    return value.toString();
}

function formatPrice(value: number): string {
    return value.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(time: Time): string {
    if (typeof time === 'object') {
        const t = time as UTCTime;
        return `${String(t.day).padStart(2, '0')}/${String(t.month).padStart(2, '0')}/${t.year}`;
    }
    return String(time);
}

function normalizeData(data: HistoricalData[]): HistoricalData[] {
    if (!Array.isArray(data)) return [];
    const cleaned = data
        .map((d) => {
            const ts    = new Date(d.time).getTime();
            const open  = toFiniteNumber(d.open);
            const high  = toFiniteNumber(d.high);
            const low   = toFiniteNumber(d.low);
            const close = toFiniteNumber(d.close);
            const volume = toFiniteNumber(d.volume) ?? 0;
            if (!Number.isFinite(ts) || open === null || high === null || low === null || close === null) return null;
            return { time: d.time, open, high, low, close, volume } satisfies HistoricalData;
        })
        .filter((d): d is HistoricalData => d !== null)
        .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    const byDate = new Map<string, HistoricalData>();
    for (const item of cleaned) byDate.set(dayKey(item.time), item);
    return Array.from(byDate.values()).sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

function aggregateData(data: HistoricalData[], interval: Interval): HistoricalData[] {
    if (interval === 'D') return data;
    const groups = new Map<string, HistoricalData[]>();
    data.forEach((d) => {
        const date = new Date(d.time);
        let key: string;
        if (interval === 'W') {
            const ws = new Date(date);
            ws.setDate(date.getDate() - date.getDay());
            key = `${ws.getFullYear()}-W${String(Math.ceil((ws.getTime() - new Date(ws.getFullYear(), 0, 1).getTime()) / (7 * 86400000)) + 1).padStart(2, '0')}`;
        } else {
            key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        }
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(d);
    });
    const result: HistoricalData[] = [];
    groups.forEach((items) => {
        if (!items.length) return;
        result.push({
            time:   items[0].time,
            open:   items[0].open,
            high:   Math.max(...items.map(i => i.high)),
            low:    Math.min(...items.map(i => i.low)),
            close:  items[items.length - 1].close,
            volume: items.reduce((s, i) => s + i.volume, 0),
        });
    });
    return result;
}

// ── Interval selector ─────────────────────────────────────────────────────────
function IntervalSelector({ interval, setInterval }: { interval: Interval; setInterval: (i: Interval) => void }) {
    return (
        <div className="flex items-center gap-1">
            {/* Desktop buttons */}
            {(['D', 'W', 'M'] as Interval[]).map((iv) => (
                <button
                    key={iv}
                    onClick={() => setInterval(iv)}
                    className={`hidden sm:inline-flex rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                        interval === iv
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
                    }`}
                >
                    {INTERVAL_LABELS[iv]}
                </button>
            ))}

            {/* Mobile cycling button */}
            <button
                onClick={() => setInterval(INTERVAL_CYCLE[interval])}
                className="sm:hidden flex items-center gap-1 rounded px-2.5 py-1 text-xs font-semibold bg-blue-600 text-white shadow-sm"
            >
                {INTERVAL_LABELS[interval]}
                <svg className="w-3 h-3 opacity-80" viewBox="0 0 12 12" fill="none">
                    <path d="M2 4.5L6 8.5L10 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            </button>
        </div>
    );
}

// ── OHLCV Stats bar ───────────────────────────────────────────────────────────
function OHLCVBar({ bar }: { bar: BarDisplay | null }) {
    if (!bar) return null;
    const isUp = bar.change >= 0;
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 py-2 text-[11px]">
            <span className="text-slate-400 dark:text-slate-500 font-medium">{bar.time}</span>
            <span className="flex items-center gap-1">
                <span className="text-slate-400 dark:text-slate-500">O</span>
                <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{formatPrice(bar.open)}</span>
            </span>
            <span className="flex items-center gap-1">
                <span className="text-slate-400 dark:text-slate-500">H</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">{formatPrice(bar.high)}</span>
            </span>
            <span className="flex items-center gap-1">
                <span className="text-slate-400 dark:text-slate-500">L</span>
                <span className="font-semibold text-red-500 dark:text-red-400 tabular-nums">{formatPrice(bar.low)}</span>
            </span>
            <span className="flex items-center gap-1">
                <span className="text-slate-400 dark:text-slate-500">C</span>
                <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{formatPrice(bar.close)}</span>
            </span>
            <span className="flex items-center gap-1">
                <span className="text-slate-400 dark:text-slate-500">Vol</span>
                <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">{formatVolume(bar.volume)}</span>
            </span>
            <span className={`font-semibold tabular-nums ${isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                {isUp ? '+' : ''}{formatPrice(Math.abs(bar.change))} ({isUp ? '+' : ''}{bar.changePct.toFixed(2)}%)
            </span>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TradingViewChart({ data, isLoading }: TradingViewChartProps) {
    const chartContainerRef    = useRef<HTMLDivElement>(null);
    const chartRef             = useRef<IChartApi | null>(null);
    const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volumeSeriesRef      = useRef<ISeriesApi<'Histogram'> | null>(null);
    const [interval, setIntervalState] = useState<Interval>('D');
    const intervalRef = useRef<Interval>('D');

    // Bar displayed in the OHLCV footer (null = show latestBar)
    const [hoveredBar, setHoveredBar] = useState<BarDisplay | null>(null);

    // Dark mode
    const isDark = useDarkMode();
    const theme  = useMemo(() => buildTheme(isDark), [isDark]);

    const normalizedData = useMemo(() => normalizeData(data), [data]);
    const aggregatedData = useMemo(() => aggregateData(normalizedData, interval), [normalizedData, interval]);

    const latestBar = useMemo<BarDisplay | null>(() => {
        if (!aggregatedData.length) return null;
        const latest = aggregatedData[aggregatedData.length - 1];
        const prev   = aggregatedData.length > 1 ? aggregatedData[aggregatedData.length - 2] : latest;
        const change    = latest.close - prev.close;
        const changePct = prev.close > 0 ? (change / prev.close) * 100 : 0;
        return {
            time: formatDate(toUTCTime(latest.time)),
            open: latest.open, high: latest.high, low: latest.low, close: latest.close,
            volume: latest.volume, change, changePct,
        };
    }, [aggregatedData]);

    const displayBar = hoveredBar ?? latestBar;

    // keep intervalRef in sync for use inside effects
    useEffect(() => { intervalRef.current = interval; }, [interval]);

    // ── Chart init (once) ────────────────────────────────────────────────────
    useEffect(() => {
        if (!chartContainerRef.current || chartRef.current) return;

        const initTheme = buildTheme(document.documentElement.classList.contains('dark'));

        const chart = createChart(chartContainerRef.current, {
            width:  chartContainerRef.current.clientWidth,
            height: 400,
            layout: {
                background: { type: 'solid', color: 'transparent' },
                textColor:  initTheme.text,
                fontSize:   11,
                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            },
            grid: {
                vertLines: { color: initTheme.gridLine },
                horzLines: { color: initTheme.gridLine },
            },
            crosshair: {
                mode:     CrosshairMode.Normal,
                vertLine: { color: initTheme.crosshair, width: 1, style: 0, labelBackgroundColor: '#2563eb' },
                horzLine: { color: initTheme.crosshair, width: 1, style: 0, labelBackgroundColor: '#2563eb' },
            },
            rightPriceScale: {
                borderColor:  initTheme.border,
                scaleMargins: { top: 0.06, bottom: 0.22 },
            },
            timeScale: {
                borderColor:           initTheme.border,
                timeVisible:           false,
                rightOffset:           2,
                barSpacing:            6,
                rightBarStaysOnScroll: true,
            },
            handleScroll: { vertTouchDrag: false },
        });

        const candlestickSeries = chart.addSeries(CandlestickSeries, {
            upColor:        '#16a34a',
            downColor:      '#dc2626',
            borderUpColor:  '#16a34a',
            borderDownColor:'#dc2626',
            wickUpColor:    '#16a34a',
            wickDownColor:  '#dc2626',
        });

        const volumeSeries = chart.addSeries(HistogramSeries, {
            priceFormat:  { type: 'volume' },
            priceScaleId: '',
            scaleMargins: { top: 0.84, bottom: 0.02 },
        });

        // Crosshair: update footer bar instead of floating tooltip
        chart.subscribeCrosshairMove((param: MouseEventParams) => {
            if (!param?.time || !param?.seriesData) {
                setHoveredBar(null);
                return;
            }
            const candle = param.seriesData.get(candlestickSeries);
            const vol    = param.seriesData.get(volumeSeries);
            if (!candle) { setHoveredBar(null); return; }

            const open   = (candle as { open: number }).open;
            const high   = (candle as { high: number }).high;
            const low    = (candle as { low: number }).low;
            const close  = (candle as { close: number }).close;
            const volume = (vol as { value?: number })?.value ?? 0;
            const change    = close - open;
            const changePct = open > 0 ? (change / open) * 100 : 0;

            setHoveredBar({
                time: formatDate(param.time),
                open, high, low, close, volume, change, changePct,
            });
        });

        chartRef.current           = chart;
        candlestickSeriesRef.current = candlestickSeries;
        volumeSeriesRef.current    = volumeSeries;

        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const w = entry.contentRect.width;
                chart.applyOptions({ width: w, height: w < 640 ? 320 : 400 });
            }
        });
        ro.observe(chartContainerRef.current);

        return () => {
            ro.disconnect();
            chart.remove();
            chartRef.current = null;
            candlestickSeriesRef.current = null;
            volumeSeriesRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Sync dark mode ───────────────────────────────────────────────────────
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        chart.applyOptions({
            layout:          { textColor: theme.text },
            grid:            { vertLines: { color: theme.gridLine }, horzLines: { color: theme.gridLine } },
            rightPriceScale: { borderColor: theme.border },
            timeScale:       { borderColor: theme.border },
            crosshair: {
                vertLine: { color: theme.crosshair },
                horzLine: { color: theme.crosshair },
            },
        });
    }, [theme]);

    // ── Push data ─────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!chartRef.current || !candlestickSeriesRef.current || !volumeSeriesRef.current) return;
        if (!aggregatedData.length) return;

        candlestickSeriesRef.current.setData(aggregatedData.map(d => ({
            time:  toUTCTime(d.time),
            open:  d.open,
            high:  d.high,
            low:   d.low,
            close: d.close,
        })));

        volumeSeriesRef.current.setData(aggregatedData.map(d => ({
            time:  toUTCTime(d.time),
            value: d.volume,
            color: d.close >= d.open ? 'rgba(22,163,74,0.28)' : 'rgba(220,38,38,0.28)',
        })));

        // Set default viewport: ~5 months of data based on interval
        const total = aggregatedData.length;
        const barsToShow = INTERVAL_BARS[intervalRef.current];
        chartRef.current.timeScale().setVisibleLogicalRange({
            from: Math.max(0, total - barsToShow),
            to:   total + 2,
        });
    }, [aggregatedData]);

    const setInterval = useCallback((iv: Interval) => {
        setIntervalState(iv);
        setHoveredBar(null);
    }, []);

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="w-full">
            {/* Toolbar: interval only (range removed — always show all data) */}
            <div className="mb-2 flex items-center justify-end px-1">
                <IntervalSelector interval={interval} setInterval={setInterval} />
            </div>

            {/* Chart area — always mounted so chart instance is never destroyed */}
            <div className="relative">
                {/* Loading overlay */}
                {isLoading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg"
                        style={{ backgroundColor: isDark ? 'rgba(15,23,42,0.5)' : 'rgba(255,255,255,0.6)' }}
                    >
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                            </svg>
                            Loading…
                        </div>
                    </div>
                )}

                {/* No data message */}
                {!isLoading && !normalizedData.length && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg">
                        <span className="text-slate-400 text-sm">Không có dữ liệu giá lịch sử</span>
                    </div>
                )}

                <div ref={chartContainerRef} className="w-full rounded-lg" style={{ height: '400px' }} />
            </div>

            {/* OHLCV footer — shows latest bar, updates live on crosshair hover */}
            <div className="mt-1 border-t border-slate-100 dark:border-slate-800">
                <OHLCVBar bar={displayBar} />
            </div>
        </div>
    );
}
