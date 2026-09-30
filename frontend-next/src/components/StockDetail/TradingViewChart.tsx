'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import {
    createChart,
    IChartApi,
    ISeriesApi,
    CandlestickSeries,
    HistogramSeries,
    Time,
    BusinessDay,
    ColorType,
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

const CROSSHAIR_COLOR = '#0E6BFF';

interface TradingViewChartProps {
    data: HistoricalData[];
    isLoading: boolean;
    onLoadOlderHistory?: () => void;
}

// ── Displayed bar (hovered trading day) ──────────────────────────────────
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
        border:    isDark ? '#1f2937' : '#e5e7eb',
        gridLine:  isDark ? 'rgba(55,65,81,0.3)' : 'rgba(229,231,235,0.6)',
        crosshair: isDark ? '#4b5563' : '#d1d5db',
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

function toBusinessDay(time: string | number): BusinessDay {
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
        const t = time as BusinessDay;
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

// ── OHLCV overlay tooltip (only shown while hovering/touching) ────────────────
function OHLCVOverlay({ bar }: { bar: BarDisplay | null }) {
    if (!bar) return null;
    const isUp = bar.change >= 0;
    return (
        <div className="absolute top-2 left-2 z-20 pointer-events-none">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-[11px] shadow-lg dark:border-slate-700 dark:bg-slate-900/95">
                <span className="text-slate-500 dark:text-slate-400 font-medium">{bar.time}</span>
                <span className="flex items-center gap-1">
                    <span className="text-slate-400">O</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{formatPrice(bar.open)}</span>
                </span>
                <span className="flex items-center gap-1">
                    <span className="text-slate-400">H</span>
                    <span className="font-semibold text-emerald-400 tabular-nums">{formatPrice(bar.high)}</span>
                </span>
                <span className="flex items-center gap-1">
                    <span className="text-slate-400">L</span>
                    <span className="font-semibold text-red-400 tabular-nums">{formatPrice(bar.low)}</span>
                </span>
                <span className="flex items-center gap-1">
                    <span className="text-slate-400">C</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{formatPrice(bar.close)}</span>
                </span>
                <span className="flex items-center gap-1">
                    <span className="text-slate-400">Vol</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{formatVolume(bar.volume)}</span>
                </span>
                <span className={`font-semibold tabular-nums ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isUp ? '+' : '-'}{formatPrice(Math.abs(bar.change))} ({isUp ? '+' : ''}{bar.changePct.toFixed(2)}%)
                </span>
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TradingViewChart({ data, isLoading, onLoadOlderHistory }: TradingViewChartProps) {
    const chartContainerRef    = useRef<HTMLDivElement>(null);
    const chartRef             = useRef<IChartApi | null>(null);
    const candleSeriesRef      = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const barsByDateRef        = useRef<Map<string, BarDisplay>>(new Map());
    const volumeSeriesRef      = useRef<ISeriesApi<'Histogram'> | null>(null);
    const loadOlderRef = useRef(onLoadOlderHistory);
    const firstDateRef = useRef<string | null>(null);
    const interactedRef = useRef(false);
    const loadingRef = useRef(isLoading);
    useEffect(() => { loadOlderRef.current = onLoadOlderHistory; }, [onLoadOlderHistory]);
    useEffect(() => { loadingRef.current = isLoading; }, [isLoading]);
    // Bar displayed in the OHLCV overlay (null = hidden, only shown while hovering/touching)
    const [hoveredBar, setHoveredBar] = useState<BarDisplay | null>(null);

    // Dark mode
    const isDark = useDarkMode();
    const theme  = useMemo(() => buildTheme(isDark), [isDark]);

    const normalizedData = useMemo(() => normalizeData(data), [data]);
    // ── Chart init (once) ────────────────────────────────────────────────────
    useEffect(() => {
        if (!chartContainerRef.current || chartRef.current) return;

        const initTheme = buildTheme(document.documentElement.classList.contains('dark'));

        const chart = createChart(chartContainerRef.current, {
            width:  chartContainerRef.current.clientWidth,
            height: 380,
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
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
                vertLine: { color: initTheme.crosshair, width: 1, style: 2, labelBackgroundColor: CROSSHAIR_COLOR },
                horzLine: { color: initTheme.crosshair, width: 1, style: 2, labelBackgroundColor: CROSSHAIR_COLOR },
            },
            rightPriceScale: {
                borderColor:  initTheme.border,
                scaleMargins: { top: 0.08, bottom: 0.25 },
            },
            timeScale: {
                borderColor:           initTheme.border,
                timeVisible:           false,
                rightOffset:           5,
                barSpacing:            6,
                minBarSpacing:         2,
                rightBarStaysOnScroll: true,
            },
            handleScroll: { vertTouchDrag: false },
            kineticScroll: { mouse: true, touch: true },
        });

        const candleSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#22c55e',
            downColor: '#ef4444',
            wickUpColor: '#22c55e',
            wickDownColor: '#ef4444',
            borderVisible: false,
            priceLineVisible: false,
            lastValueVisible: true,
            priceFormat: { type: 'price', precision: 0, minMove: 1 },
        });

        const volumeSeries = chart.addSeries(HistogramSeries, {
            priceFormat:  { type: 'volume' },
            priceScaleId: '',
            priceLineVisible: false,
            lastValueVisible: false,
        });
        volumeSeries.priceScale().applyOptions({
            scaleMargins: { top: 0.90, bottom: 0 },
        });

        // Coalesce pointer events into one overlay update per animation frame.
        let hoverFrame: number | null = null;
        let pendingBar: BarDisplay | null = null;
        const scheduleHover = (bar: BarDisplay | null) => {
            pendingBar = bar;
            if (hoverFrame !== null) return;
            hoverFrame = requestAnimationFrame(() => {
                hoverFrame = null;
                const nextBar = pendingBar;
                setHoveredBar(current => current === nextBar ? current : nextBar);
            });
        };
        chart.subscribeCrosshairMove((param: MouseEventParams) => {
            const bar = param.time && param.point && param.seriesData.get(candleSeries)
                ? barsByDateRef.current.get(formatDate(param.time)) ?? null
                : null;
            scheduleHover(bar);
        });

        chartRef.current           = chart;
        candleSeriesRef.current    = candleSeries;
        volumeSeriesRef.current    = volumeSeries;

        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const w = entry.contentRect.width;
                chart.applyOptions({ width: w, height: w < 640 ? 300 : 380 });
            }
        });
        ro.observe(chartContainerRef.current);

        // Clear overlay when user lifts finger (mobile)
        const el = chartContainerRef.current;
        const markInteraction = () => { interactedRef.current = true; };
        el.addEventListener('pointerdown', markInteraction, { passive: true });
        el.addEventListener('wheel', markInteraction, { passive: true });
        chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
            if (!range) return;
            // Fetch ahead while half a viewport of older bars still remains.
            const preloadThreshold = Math.max(8, (range.to - range.from) / 2);
            if (!loadingRef.current && interactedRef.current && range.from <= preloadThreshold) {
                // Applying a longer data set also changes this range. Consume
                // the gesture so a single drag requests just one next period.
                interactedRef.current = false;
                loadOlderRef.current?.();
            }
        });
        const clearOnTouchEnd = () => scheduleHover(null);
        el.addEventListener('touchend', clearOnTouchEnd, { passive: true });

        return () => {
            if (hoverFrame !== null) cancelAnimationFrame(hoverFrame);
            ro.disconnect();
            el.removeEventListener('touchend', clearOnTouchEnd);
            el.removeEventListener('pointerdown', markInteraction);
            el.removeEventListener('wheel', markInteraction);
            chart.remove();
            chartRef.current = null;
            candleSeriesRef.current = null;
            volumeSeriesRef.current = null;
        };
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
        if (!chartRef.current || !candleSeriesRef.current || !volumeSeriesRef.current) return;
        const previousRange = firstDateRef.current ? chartRef.current.timeScale().getVisibleLogicalRange() : null;
        const addedBars = firstDateRef.current
            ? normalizedData.findIndex(d => dayKey(d.time) === firstDateRef.current)
            : -1;
        interactedRef.current = false;
        barsByDateRef.current = new Map(normalizedData.map((d, i) => {
            const previousClose = i > 0 ? normalizedData[i - 1].close : d.open;
            const change = d.close - previousClose;
            const time = formatDate(toBusinessDay(d.time));
            return [time, {
                ...d,
                time,
                change,
                changePct: previousClose > 0 ? (change / previousClose) * 100 : 0,
            }];
        }));
        queueMicrotask(() => setHoveredBar(null));
        candleSeriesRef.current.setData(normalizedData.map(d => ({
            time: toBusinessDay(d.time),
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
        })));
        volumeSeriesRef.current.setData(normalizedData.map(d => ({
            time: toBusinessDay(d.time),
            value: d.volume,
            color: d.close >= d.open
                ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
        })));
        firstDateRef.current = normalizedData.length ? dayKey(normalizedData[0].time) : null;
        if (!normalizedData.length) return;
        if (previousRange && addedBars >= 0) {
            // Prepending history must preserve the user's zoom and scroll position.
            chartRef.current.timeScale().setVisibleLogicalRange({
                from: previousRange.from + addedBars,
                to: previousRange.to + addedBars,
            });
            return;
        }

        // Start with readable candles; older sessions are fetched on pan/zoom demand.
        chartRef.current.timeScale().setVisibleLogicalRange({
            from: Math.max(0, normalizedData.length - 90),
            to: normalizedData.length - 1 + 5,
        });
    }, [normalizedData]);

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="w-full">
            {/* Chart area — always mounted so chart instance is never destroyed */}
            <div className="relative">
                {/* Loading overlay */}
                {isLoading && !normalizedData.length && (
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

                {/* OHLCV overlay — only visible while hovering/touching the chart */}
                <OHLCVOverlay bar={hoveredBar} />

                <div
                    ref={chartContainerRef}
                    className="h-[300px] w-full rounded-lg sm:h-[380px]"
                />
            </div>
        </div>
    );
}
