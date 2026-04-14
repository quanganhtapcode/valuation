'use client';

import React, { useEffect, useRef, useMemo } from 'react';
import {
    createChart,
    IChartApi,
    ISeriesApi,
    CandlestickSeries,
    HistogramSeries,
    Time,
    UTCTime,
    CrosshairMode,
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

interface TradingViewChartProps {
    data: HistoricalData[];
    isLoading: boolean;
}

function formatTimeValue(time: string | number): Time {
    if (typeof time === 'string') {
        const d = new Date(time);
        const year = d.getFullYear();
        const month = d.getMonth() + 1;
        const day = d.getDate();
        return { year, month, day } as UTCTime;
    }
    const d = new Date(time);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const day = d.getDate();
    return { year, month, day } as UTCTime;
}

function formatVolume(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toString();
}

function formatPrice(value: number): string {
    return value.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default function TradingViewChart({ data, isLoading }: TradingViewChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);

    const chartOptions = useMemo((): DeepPartial<ChartOptions> => ({
        layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: '#9ca3af',
            fontSize: 12,
        },
        grid: {
            vertLines: { color: 'rgba(55, 65, 81, 0.3)' },
            horzLines: { color: 'rgba(55, 65, 81, 0.3)' },
        },
        crosshair: {
            mode: CrosshairMode.Normal,
            vertLine: {
                color: '#6b7280',
                width: 1,
                style: 2,
                labelBackgroundColor: '#374151',
            },
            horzLine: {
                color: '#6b7280',
                width: 1,
                style: 2,
                labelBackgroundColor: '#374151',
            },
        },
        rightPriceScale: {
            borderColor: 'rgba(55, 65, 81, 0.5)',
            scaleMargins: {
                top: 0.1,
                bottom: 0.25,
            },
        },
        timeScale: {
            borderColor: 'rgba(55, 65, 81, 0.5)',
            timeVisible: false,
            rightOffset: 5,
            barSpacing: 8,
        },
        handleScroll: {
            vertTouchDrag: false,
        },
    }), []);

    const candlestickOptions = useMemo((): DeepPartial<CandlestickSeriesOptions> => ({
        upColor: '#10b981',
        downColor: '#ef4444',
        borderDownColor: '#dc2626',
        borderUpColor: '#059669',
        wickDownColor: '#dc2626',
        wickUpColor: '#059669',
    }), []);

    const volumeOptions = useMemo((): DeepPartial<HistogramSeriesOptions> => ({
        priceFormat: {
            type: 'volume',
        },
        priceScaleId: '',
        scaleMargins: {
            top: 0.8,
            bottom: 0,
        },
    }), []);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            ...chartOptions,
            width: chartContainerRef.current.clientWidth,
            height: 320,
        });

        const candlestickSeries = chart.addSeries(CandlestickSeries, candlestickOptions);
        const volumeSeries = chart.addSeries(HistogramSeries, volumeOptions);

        chartRef.current = chart;
        candlestickSeriesRef.current = candlestickSeries;
        volumeSeriesRef.current = volumeSeries;

        // Resize observer
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width } = entry.contentRect;
                chart.applyOptions({ width });
            }
        });
        resizeObserver.observe(chartContainerRef.current);
        resizeObserverRef.current = resizeObserver;

        return () => {
            resizeObserver.disconnect();
            chart.remove();
            chartRef.current = null;
            candlestickSeriesRef.current = null;
            volumeSeriesRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Update chart data when data changes
    useEffect(() => {
        if (!chartRef.current || !candlestickSeriesRef.current || !volumeSeriesRef.current) return;
        if (!data || data.length === 0) return;

        const candleData = data.map((d) => ({
            time: formatTimeValue(d.time),
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
        }));

        const volumeData = data.map((d) => ({
            time: formatTimeValue(d.time),
            value: d.volume,
            color: d.close >= d.open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)',
        }));

        candlestickSeriesRef.current.setData(candleData);
        volumeSeriesRef.current.setData(volumeData);

        // Fit content
        chartRef.current.timeScale().fitContent();
    }, [data]);

    // Handle loading state
    if (isLoading) {
        return (
            <div className="flex h-80 items-center justify-center">
                <div className="spinner" />
            </div>
        );
    }

    if (!data || data.length === 0) {
        return (
            <div className="flex h-80 items-center justify-center text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                Không có dữ liệu
            </div>
        );
    }

    return (
        <div
            ref={chartContainerRef}
            className="w-full"
            style={{ height: '320px' }}
        />
    );
}
