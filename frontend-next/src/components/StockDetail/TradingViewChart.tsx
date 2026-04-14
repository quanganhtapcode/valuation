'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
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
type Range = '3M' | '6M' | '1Y' | '3Y' | 'ALL';

interface TradingViewChartProps {
    data: HistoricalData[];
    isLoading: boolean;
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
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toString();
}

function formatPrice(value: number): string {
    return value.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(time: Time): string {
    if (typeof time === 'object') {
        return `${String(time.day).padStart(2, '0')}/${String(time.month).padStart(2, '0')}/${time.year}`;
    }
    return String(time);
}

function normalizeData(data: HistoricalData[]): HistoricalData[] {
    if (!Array.isArray(data)) return [];

    const cleaned = data
        .filter((d) => {
            const ts = new Date(d.time).getTime();
            return Number.isFinite(ts)
                && Number.isFinite(d.open)
                && Number.isFinite(d.high)
                && Number.isFinite(d.low)
                && Number.isFinite(d.close)
                && Number.isFinite(d.volume);
        })
        .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    const byDate = new Map<string, HistoricalData>();
    for (const item of cleaned) byDate.set(dayKey(item.time), item);

    return Array.from(byDate.values()).sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

function applyRange(data: HistoricalData[], range: Range): HistoricalData[] {
    if (range === 'ALL' || data.length === 0) return data;

    const latestTs = new Date(data[data.length - 1].time).getTime();
    const daysByRange: Record<Exclude<Range, 'ALL'>, number> = {
        '3M': 92,
        '6M': 183,
        '1Y': 365,
        '3Y': 365 * 3,
    };
    const cutoff = latestTs - daysByRange[range] * 24 * 60 * 60 * 1000;
    const sliced = data.filter((d) => new Date(d.time).getTime() >= cutoff);
    return sliced.length > 0 ? sliced : data;
}

function aggregateData(data: HistoricalData[], interval: Interval): HistoricalData[] {
    if (interval === 'D') return data;

    const groups = new Map<string, HistoricalData[]>();
    data.forEach((d) => {
        const date = new Date(d.time);
        let key: string;
        if (interval === 'W') {
            const weekStart = new Date(date);
            weekStart.setDate(date.getDate() - date.getDay());
            key = `${weekStart.getFullYear()}-W${String(Math.ceil((weekStart.getTime() - new Date(weekStart.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1).padStart(2, '0')}`;
        } else {
            key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        }
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(d);
    });

    const result: HistoricalData[] = [];
    groups.forEach((items) => {
        if (items.length === 0) return;
        result.push({
            time: items[0].time,
            open: items[0].open,
            high: Math.max(...items.map((i) => i.high)),
            low: Math.min(...items.map((i) => i.low)),
            close: items[items.length - 1].close,
            volume: items.reduce((sum, i) => sum + i.volume, 0),
        });
    });
    return result;
}

function ToolbarButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                active
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
        >
            {label}
        </button>
    );
}

export default function TradingViewChart({ data, isLoading }: TradingViewChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const [interval, setInterval] = useState<Interval>('D');
    const [range, setRange] = useState<Range>('1Y');
    const [containerWidth, setContainerWidth] = useState(400);
    const [tooltipData, setTooltipData] = useState<{
        time: string;
        open: string;
        high: string;
        low: string;
        close: string;
        volume: string;
        change: string;
        x: number;
        y: number;
    } | null>(null);

    const normalizedData = useMemo(() => normalizeData(data), [data]);
    const rangeData = useMemo(() => applyRange(normalizedData, range), [normalizedData, range]);
    const aggregatedData = useMemo(() => aggregateData(rangeData, interval), [rangeData, interval]);

    const latestBar = useMemo(() => {
        if (aggregatedData.length === 0) return null;
        const latest = aggregatedData[aggregatedData.length - 1];
        const prev = aggregatedData.length > 1 ? aggregatedData[aggregatedData.length - 2] : latest;
        const change = latest.close - prev.close;
        const changePct = prev.close > 0 ? (change / prev.close) * 100 : 0;
        return { latest, change, changePct };
    }, [aggregatedData]);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        const isDark = document.documentElement.classList.contains('dark');
        const chart = createChart(chartContainerRef.current, {
            width: chartContainerRef.current.clientWidth,
            height: 420,
            layout: {
                background: { type: 'solid', color: 'transparent' },
                textColor: isDark ? '#9ca3af' : '#6b7280',
                fontSize: 12,
            },
            grid: {
                vertLines: { visible: true, color: isDark ? 'rgba(55, 65, 81, 0.25)' : 'rgba(229, 231, 235, 0.7)' },
                horzLines: { visible: true, color: isDark ? 'rgba(55, 65, 81, 0.25)' : 'rgba(229, 231, 235, 0.7)' },
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: {
                    color: isDark ? '#4b5563' : '#cbd5e1',
                    width: 1,
                    style: 0,
                    labelBackgroundColor: '#2563eb',
                },
                horzLine: {
                    color: isDark ? '#4b5563' : '#cbd5e1',
                    width: 1,
                    style: 0,
                    labelBackgroundColor: '#2563eb',
                },
            },
            rightPriceScale: {
                borderColor: isDark ? '#374151' : '#e5e7eb',
                scaleMargins: { top: 0.06, bottom: 0.22 },
            },
            timeScale: {
                borderColor: isDark ? '#374151' : '#e5e7eb',
                timeVisible: false,
                rightOffset: 2,
                barSpacing: 6,
                rightBarStaysOnScroll: true,
            },
            handleScroll: { vertTouchDrag: false },
        });

        const candlestickSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#16a34a',
            downColor: '#dc2626',
            borderDownColor: '#dc2626',
            borderUpColor: '#16a34a',
            wickDownColor: '#dc2626',
            wickUpColor: '#16a34a',
        });

        const volumeSeries = chart.addSeries(HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: '',
            scaleMargins: { top: 0.84, bottom: 0.02 },
        });

        chart.subscribeCrosshairMove((param: MouseEventParams) => {
            if (!param || !param.time || !param.seriesData) return;

            const candle = param.seriesData.get(candlestickSeries);
            const vol = param.seriesData.get(volumeSeries);
            if (!candle) {
                setTooltipData(null);
                return;
            }

            const open = candle.open as number;
            const high = candle.high as number;
            const low = candle.low as number;
            const close = candle.close as number;
            const volume = vol?.value as number;
            const change = close - open;
            const changePct = open > 0 ? (change / open) * 100 : 0;

            setTooltipData({
                time: formatDate(param.time),
                open: formatPrice(open),
                high: formatPrice(high),
                low: formatPrice(low),
                close: formatPrice(close),
                volume: formatVolume(volume || 0),
                change: `${change >= 0 ? '+' : ''}${formatPrice(Math.abs(change))} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`,
                x: param.point?.x ?? 0,
                y: param.point?.y ?? 0,
            });
        });

        chartRef.current = chart;
        candlestickSeriesRef.current = candlestickSeries;
        volumeSeriesRef.current = volumeSeries;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width } = entry.contentRect;
                setContainerWidth(width || 400);
                chart.applyOptions({ width, height: width < 640 ? 340 : 420 });
            }
        });
        resizeObserver.observe(chartContainerRef.current);

        return () => {
            resizeObserver.disconnect();
            chart.remove();
            chartRef.current = null;
            candlestickSeriesRef.current = null;
            volumeSeriesRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!chartRef.current || !candlestickSeriesRef.current || !volumeSeriesRef.current) return;
        if (aggregatedData.length === 0) return;

        const candleData = aggregatedData.map((d) => ({
            time: toUTCTime(d.time),
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
        }));

        const volumeData = aggregatedData.map((d) => ({
            time: toUTCTime(d.time),
            value: d.volume,
            color: d.close >= d.open ? 'rgba(22, 163, 74, 0.30)' : 'rgba(220, 38, 38, 0.30)',
        }));

        candlestickSeriesRef.current.setData(candleData);
        volumeSeriesRef.current.setData(volumeData);
        chartRef.current.timeScale().fitContent();
    }, [aggregatedData]);

    if (isLoading) {
        return <div className="flex h-[420px] items-center justify-center"><div className="spinner" /></div>;
    }

    if (normalizedData.length === 0) {
        return <div className="flex h-[420px] items-center justify-center text-gray-500">Không có dữ liệu giá lịch sử</div>;
    }

    return (
        <div className="w-full">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/50">
                <div className="flex items-center gap-1">
                    {(['3M', '6M', '1Y', '3Y', 'ALL'] as Range[]).map((r) => (
                        <ToolbarButton key={r} active={range === r} label={r} onClick={() => setRange(r)} />
                    ))}
                </div>
                <div className="flex items-center gap-1">
                    {(['D', 'W', 'M'] as Interval[]).map((iv) => (
                        <ToolbarButton
                            key={iv}
                            active={interval === iv}
                            label={iv === 'D' ? 'Ngày' : iv === 'W' ? 'Tuần' : 'Tháng'}
                            onClick={() => setInterval(iv)}
                        />
                    ))}
                </div>
            </div>

            {latestBar && (
                <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700 sm:grid-cols-4 lg:grid-cols-6">
                    <div><span className="text-slate-500">Đóng cửa</span><p className="font-semibold text-slate-900 dark:text-slate-100">{formatPrice(latestBar.latest.close)}</p></div>
                    <div><span className="text-slate-500">Mở cửa</span><p className="font-semibold text-slate-900 dark:text-slate-100">{formatPrice(latestBar.latest.open)}</p></div>
                    <div><span className="text-slate-500">Cao nhất</span><p className="font-semibold text-emerald-600">{formatPrice(latestBar.latest.high)}</p></div>
                    <div><span className="text-slate-500">Thấp nhất</span><p className="font-semibold text-red-500">{formatPrice(latestBar.latest.low)}</p></div>
                    <div><span className="text-slate-500">KLGD</span><p className="font-semibold text-slate-900 dark:text-slate-100">{formatVolume(latestBar.latest.volume)}</p></div>
                    <div><span className="text-slate-500">Thay đổi</span><p className={`font-semibold ${latestBar.change >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{latestBar.change >= 0 ? '+' : ''}{formatPrice(Math.abs(latestBar.change))} ({latestBar.changePct >= 0 ? '+' : ''}{latestBar.changePct.toFixed(2)}%)</p></div>
                </div>
            )}

            <div className="relative">
                {tooltipData && (
                    <div
                        ref={tooltipRef}
                        className="pointer-events-none absolute z-20 rounded-md border border-gray-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/95 dark:text-gray-300"
                        style={{
                            left: Math.min(tooltipData.x + 12, containerWidth - 215),
                            top: Math.max(tooltipData.y - 10, 4),
                        }}
                    >
                        <div className="font-semibold text-gray-900 dark:text-white">{tooltipData.time}</div>
                        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
                            <span className="text-gray-500">Mở cửa</span>
                            <span className="font-mono text-right">{tooltipData.open}</span>
                            <span className="text-gray-500">Cao nhất</span>
                            <span className="font-mono text-right text-emerald-600">{tooltipData.high}</span>
                            <span className="text-gray-500">Thấp nhất</span>
                            <span className="font-mono text-right text-red-500">{tooltipData.low}</span>
                            <span className="text-gray-500">Đóng cửa</span>
                            <span className="font-mono text-right font-semibold">{tooltipData.close}</span>
                            <span className="text-gray-500">Khối lượng</span>
                            <span className="font-mono text-right">{tooltipData.volume}</span>
                            <span className="text-gray-500">Thay đổi</span>
                            <span className={`font-mono text-right font-semibold ${tooltipData.change.startsWith('+') ? 'text-emerald-600' : 'text-red-500'}`}>
                                {tooltipData.change}
                            </span>
                        </div>
                    </div>
                )}

                <div ref={chartContainerRef} className="w-full rounded-lg" style={{ height: '420px' }} />
            </div>
        </div>
    );
}
