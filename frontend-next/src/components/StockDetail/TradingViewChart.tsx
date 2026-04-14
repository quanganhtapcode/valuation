'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
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
import type { DeepPartial, ChartOptions, CandlestickSeriesOptions, HistogramSeriesOptions } from 'lightweight-charts';

interface HistoricalData {
    time: string | number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export type Interval = 'D' | 'W' | 'M';

interface TradingViewChartProps {
    data: HistoricalData[];
    isLoading: boolean;
}

function toUTCTime(time: string | number): UTCTime {
    const d = new Date(time);
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
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

// Aggregate daily data into weekly or monthly
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

export default function TradingViewChart({ data, isLoading }: TradingViewChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const [interval, setInterval] = React.useState<Interval>('D');
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

    // Aggregated data
    const aggregatedData = useMemo(() => aggregateData(data, interval), [data, interval]);

    // Create chart
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const isDark = document.documentElement.classList.contains('dark');

        const chart = createChart(chartContainerRef.current, {
            width: chartContainerRef.current.clientWidth,
            height: 400,
            layout: {
                background: { type: 'solid', color: 'transparent' },
                textColor: isDark ? '#6b7280' : '#9ca3af',
                fontSize: 11,
            },
            grid: {
                vertLines: { visible: false },
                horzLines: { visible: false },
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: {
                    color: isDark ? '#374151' : '#d1d5db',
                    width: 1,
                    style: 0,
                    labelBackgroundColor: '#6366f1',
                },
                horzLine: {
                    color: isDark ? '#374151' : '#d1d5db',
                    width: 1,
                    style: 0,
                    labelBackgroundColor: '#6366f1',
                },
            },
            rightPriceScale: {
                borderColor: isDark ? '#1f2937' : '#e5e7eb',
                scaleMargins: { top: 0.05, bottom: 0.2 },
            },
            timeScale: {
                borderColor: isDark ? '#1f2937' : '#e5e7eb',
                timeVisible: false,
                rightOffset: 2,
                barSpacing: 6,
                rightBarStaysOnScroll: true,
            },
            handleScroll: { vertTouchDrag: false },
        });

        const candlestickSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#22c55e',
            downColor: '#ef4444',
            borderDownColor: '#dc2626',
            borderUpColor: '#16a34a',
            wickDownColor: '#dc2626',
            wickUpColor: '#16a34a',
        });

        const volumeSeries = chart.addSeries(HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: '',
            scaleMargins: { top: 0.85, bottom: 0 },
        });

        // Crosshair move handler
        chart.subscribeCrosshairMove((param: MouseEventParams) => {
            if (!param || !param.time || !param.seriesData || tooltipRef.current) return;

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

            // Calculate tooltip position
            const chartRect = chartContainerRef.current?.getBoundingClientRect();
            if (!chartRect) return;

            const timeStr = formatDate(param.time);
            setTooltipData({
                time: timeStr,
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
                chart.applyOptions({ width });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Update data
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
            color: d.close >= d.open ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
        }));

        candlestickSeriesRef.current.setData(candleData);
        volumeSeriesRef.current.setData(volumeData);

        chartRef.current.timeScale().fitContent();
    }, [aggregatedData]);

    if (isLoading) {
        return <div className="flex h-[400px] items-center justify-center"><div className="spinner" /></div>;
    }

    if (!data || data.length === 0) {
        return <div className="flex h-[400px] items-center justify-center text-gray-500">Không có dữ liệu</div>;
    }

    return (
        <div className="relative w-full">
            {/* Interval Selector */}
            <div className="absolute left-3 top-3 z-10 flex gap-1 rounded-md border border-gray-200 bg-white/90 p-0.5 text-xs font-medium shadow-sm backdrop-blur dark:border-gray-700 dark:bg-gray-900/90">
                {(['D', 'W', 'M'] as Interval[]).map((iv) => (
                    <button
                        key={iv}
                        onClick={() => setInterval(iv)}
                        className={`rounded px-2.5 py-1 transition-colors ${
                            interval === iv
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
                        }`}
                    >
                        {iv === 'D' ? 'Ngày' : iv === 'W' ? 'Tuần' : 'Tháng'}
                    </button>
                ))}
            </div>

            {/* OHLCV Tooltip */}
            {tooltipData && (
                <div
                    ref={tooltipRef}
                    className="pointer-events-none absolute z-20 rounded-md border border-gray-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/95 dark:text-gray-300"
                    style={{
                        left: Math.min(tooltipData.x + 12, (chartContainerRef.current?.clientWidth ?? 400) - 200),
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

            {/* Chart Container */}
            <div
                ref={chartContainerRef}
                className="w-full"
                style={{ height: '400px' }}
            />
        </div>
    );
}
