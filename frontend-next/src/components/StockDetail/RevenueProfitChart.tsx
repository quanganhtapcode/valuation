'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
    Card,
    Text,
} from '@tremor/react';
import {
    ComposedChart,
    Bar,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts';

interface RevenueProfitChartProps {
    symbol: string;
    period?: 'quarter' | 'year';
    hideCard?: boolean;
    customTooltip?: any;
}

interface PeriodData {
    period: string;
    revenue: number;
    netMargin: number;
    year: number;
    quarter: number;
}

export default function RevenueProfitChart({
    symbol,
    period = 'quarter',
    hideCard = false,
    customTooltip: ExternalCustomTooltip
}: RevenueProfitChartProps) {
    const [data, setData] = useState<PeriodData[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchData() {
            setIsLoading(true);
            setError(null);
            try {
                const res = await fetch(`/api/stock/${symbol}/revenue-profit?period=${period}`);
                if (!res.ok) {
                    throw new Error('Failed to fetch revenue data');
                }
                const json = await res.json();
                setData(json.periods || []);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Unknown error');
            } finally {
                setIsLoading(false);
            }
        }
        fetchData();
    }, [symbol, period]);

    // Format period for display (e.g., "2024 Q1" -> "Q1'24" or just "2024")
    const chartData = useMemo(() => {
        return data.map(d => ({
            ...d,
            displayPeriod: d.quarter > 0 ? `${d.year} Q${d.quarter}` : `${d.year}`,
        }));
    }, [data]);

    // Custom tooltip
    const InternalCustomTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload || payload.length === 0) return null;

        return (
            <>
                <div className="w-56 rounded-md border border-gray-500/10 bg-blue-500 px-4 py-1.5 text-sm shadow-md dark:border-gray-400/20 dark:bg-gray-900 z-[100]">
                    <p className="flex items-center justify-between">
                        <span className="text-gray-50 dark:text-gray-50">
                            Period
                        </span>
                        <span className="font-medium text-gray-50 dark:text-gray-50">{label ?? ''}</span>
                    </p>
                </div>
                <div className="mt-1 w-56 space-y-1 rounded-md border border-gray-500/10 bg-white px-4 py-2 text-sm shadow-md dark:border-gray-400/20 dark:bg-gray-900 z-[100]">
                    {payload.map((item: any, index: number) => {
                        const color = item.color || item.payload?.fill || item.stroke;
                        const isHex = color?.startsWith('#') || color?.startsWith('rgb');

                        return (
                            <div key={index} className="flex items-center space-x-2.5">
                                <div
                                    className={`size-2.5 shrink-0 rounded-sm ${!isHex ? `bg-${color}-500` : ''}`}
                                    style={isHex ? { backgroundColor: color } : {}}
                                    aria-hidden={true}
                                />
                                <div className="flex w-full justify-between items-center space-x-2">
                                    <span className="text-gray-700 dark:text-gray-300 truncate">
                                        {item.name}
                                    </span>
                                    <span className="font-medium text-gray-900 dark:text-gray-50 whitespace-nowrap">
                                        {typeof item.value === 'number'
                                            ? (String(item.name).includes('%'))
                                                ? `${item.value.toFixed(1)}%`
                                                : `${item.value.toLocaleString()} B`
                                            : item.value}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </>
        );
    };

    const CustomTooltip = ExternalCustomTooltip || InternalCustomTooltip;

    if (isLoading) {
        return hideCard ? (
            <div className="flex h-full items-center justify-center">
                <div className="spinner" />
            </div>
        ) : (
            <Card className="p-6">
                <div className="flex h-64 items-center justify-center">
                    <div className="spinner" />
                </div>
            </Card>
        );
    }

    if (error || data.length === 0) {
        return hideCard ? (
            <div className="flex h-full items-center justify-center">
                <Text className="text-gray-500 text-sm">No revenue data available</Text>
            </div>
        ) : (
            <Card className="p-6">
                <div className="flex h-64 items-center justify-center">
                    <Text className="text-gray-500">No revenue data available</Text>
                </div>
            </Card>
        );
    }

    const chartContent = (
        <div className={hideCard ? "h-full w-full" : "h-80"}>
            {!hideCard && (
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Revenue & Profit
                </h3>
            )}
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
                <ComposedChart
                    data={chartData}
                    margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
                >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} opacity={0.5} />
                    <XAxis
                        dataKey="displayPeriod"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'Inter' }}
                        dy={5}
                        interval={2}
                    />
                    <YAxis
                        yAxisId="left"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#6b7280', fontSize: 11, fontFamily: 'Inter' }}
                        width={40}
                        tickFormatter={(value) => value >= 1000 ? `${(value / 1000).toFixed(0)}k` : value}
                    />
                    <YAxis
                        yAxisId="right"
                        orientation="right"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#10b981', fontSize: 11, fontFamily: 'Inter' }}
                        width={35}
                        tickFormatter={(value) => `${value}%`}
                        domain={['auto', 'auto']}
                    />
                    <Tooltip content={(props: any) => <CustomTooltip {...props} />} />
                    <Legend
                        verticalAlign="top"
                        align="right"
                        iconType="circle"
                        wrapperStyle={{
                            fontSize: '12px',
                            paddingBottom: '20px',
                            fontFamily: 'Inter',
                        }}
                    />
                    <Bar
                        yAxisId="left"
                        dataKey="revenue"
                        name="Revenue"
                        fill="#818cf8"
                        radius={[2, 2, 0, 0]}
                        barSize={20}
                        animationDuration={0}
                    />
                    <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="netMargin"
                        name="Net Margin (%)"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={{ fill: '#10b981', strokeWidth: 1, stroke: '#fff', r: 3 }}
                        activeDot={{ r: 5, strokeWidth: 1, stroke: '#fff', fill: '#10b981' }}
                        animationDuration={0}
                    />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );

    if (hideCard) return chartContent;

    return (
        <Card className="p-6">
            {chartContent}
        </Card>
    );
}
