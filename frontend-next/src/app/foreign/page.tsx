'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
    AreaChart, Area,
    BarChart, Bar,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
    fetchForeignNetValue,
    fetchForeignVolumeChart,
    ForeignNetItem,
    ForeignVolumePoint,
} from '@/lib/api';
import { siteConfig } from '@/app/siteConfig';

const REFRESH_MS = 60_000; // 60s

// ─── Formatters ──────────────────────────────────────────────────────────────

function fmtBillion(val: number) {
    if (Math.abs(val) >= 1e12) return `${(val / 1e12).toFixed(1)}T`;
    if (Math.abs(val) >= 1e9)  return `${(val / 1e9).toFixed(1)}B`;
    if (Math.abs(val) >= 1e6)  return `${(val / 1e6).toFixed(0)}M`;
    return val.toLocaleString('en-US');
}

function fmtVolume(val: number) {
    if (Math.abs(val) >= 1e6) return `${(val / 1e6).toFixed(2)}M`;
    if (Math.abs(val) >= 1e3) return `${(val / 1e3).toFixed(1)}K`;
    return val.toLocaleString('en-US');
}

// ─── Stock row ────────────────────────────────────────────────────────────────

function ForeignRow({ item, rank, isBuy }: { item: ForeignNetItem; rank: number; isBuy: boolean }) {
    const color = isBuy ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400';
    const sign  = isBuy ? '+' : '-';
    return (
        <Link
            href={`/stock/${item.Symbol}`}
            className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        >
            <span className="w-5 text-xs text-gray-400 tabular-nums text-right shrink-0">{rank}</span>
            <div className="w-8 h-8 rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 flex items-center justify-center overflow-hidden shrink-0 shadow-sm">
                <img
                    src={siteConfig.stockLogoUrl(item.Symbol)}
                    alt={item.Symbol}
                    className="w-full h-full object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{item.Symbol}</p>
                <p className="text-xs text-gray-500 truncate">{item.CompanyName}</p>
            </div>
            <div className="text-right shrink-0">
                <p className={`text-sm font-bold tabular-nums ${color}`}>
                    {sign}{fmtBillion(item.Value)}
                </p>
                <p className={`text-xs tabular-nums ${item.ChangePricePercent >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {item.ChangePricePercent >= 0 ? '+' : ''}{item.ChangePricePercent.toFixed(2)}%
                </p>
            </div>
        </Link>
    );
}

// ─── Net value table ──────────────────────────────────────────────────────────

function NetValueSection({ buyList, sellList, isLoading }: {
    buyList: ForeignNetItem[];
    sellList: ForeignNetItem[];
    isLoading: boolean;
}) {
    const [tab, setTab] = useState<'buy' | 'sell'>('buy');
    const items = tab === 'buy' ? buyList : sellList;

    return (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    Top Mua/Bán Khối Ngoại
                </h2>
                <span className="text-xs text-gray-400">HOSE · Theo giá trị ròng</span>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-100 dark:border-gray-800 mx-4">
                <button
                    onClick={() => setTab('buy')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        tab === 'buy'
                            ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                            : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                >
                    Mua ròng
                </button>
                <button
                    onClick={() => setTab('sell')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                        tab === 'sell'
                            ? 'border-red-500 text-red-600 dark:text-red-400'
                            : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                >
                    Bán ròng
                </button>
            </div>

            {/* List */}
            <div className="divide-y divide-gray-50 dark:divide-gray-800/60">
                {isLoading ? (
                    Array.from({ length: 10 }).map((_, i) => (
                        <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
                            <div className="w-5 h-3 bg-gray-200 dark:bg-gray-700 rounded" />
                            <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-lg" />
                            <div className="flex-1 space-y-1.5">
                                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-16" />
                                <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded w-32" />
                            </div>
                            <div className="w-14 h-3 bg-gray-200 dark:bg-gray-700 rounded" />
                        </div>
                    ))
                ) : items.length > 0 ? (
                    items.map((item, idx) => (
                        <ForeignRow key={item.Symbol} item={item} rank={idx + 1} isBuy={tab === 'buy'} />
                    ))
                ) : (
                    <div className="flex items-center justify-center h-40 text-sm text-gray-400">
                        Không có dữ liệu — thị trường có thể đang đóng cửa
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Volume / Value charts ────────────────────────────────────────────────────

function VolumeCharts({ points, isLoading }: { points: ForeignVolumePoint[]; isLoading: boolean }) {
    const [mode, setMode] = useState<'volume' | 'value'>('volume');
    const isCumulative = true; // always show cumulative

    const chartData = points.map(p => ({
        time: p.time,
        Mua:  isCumulative
            ? (mode === 'volume' ? (p.cumBuyVolume  ?? 0) : (p.cumBuyValue  ?? 0))
            : (mode === 'volume' ? p.buyVolume  : p.buyValue),
        'Bán': isCumulative
            ? (mode === 'volume' ? (p.cumSellVolume ?? 0) : (p.cumSellValue ?? 0))
            : (mode === 'volume' ? p.sellVolume : p.sellValue),
    }));

    const fmt = (v: number) => mode === 'volume' ? fmtVolume(v) : fmtBillion(v);
    const unit = mode === 'volume' ? 'CP' : 'VND';

    const LoadingState = () => (
        <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-blue-600" />
        </div>
    );

    const EmptyState = () => (
        <div className="flex items-center justify-center h-48 text-sm text-gray-400">
            Không có dữ liệu — thị trường có thể đang đóng cửa
        </div>
    );

    return (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2">
                <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                        Giao dịch khối ngoại trong phiên
                    </h2>
                    <p className="text-xs text-gray-400 mt-0.5">Lũy kế từ 09:00 · HOSE</p>
                </div>
                {/* Mode toggle */}
                <div className="flex p-1 bg-gray-100 dark:bg-gray-800 rounded-lg text-xs font-medium">
                    <button
                        onClick={() => setMode('volume')}
                        className={`px-3 py-1.5 rounded-md transition-colors ${
                            mode === 'volume'
                                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                        }`}
                    >
                        Khối lượng
                    </button>
                    <button
                        onClick={() => setMode('value')}
                        className={`px-3 py-1.5 rounded-md transition-colors ${
                            mode === 'value'
                                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                        }`}
                    >
                        Giá trị
                    </button>
                </div>
            </div>

            <div className="px-4 pb-4">
                {isLoading ? <LoadingState /> : chartData.length === 0 ? <EmptyState /> : (
                    <ResponsiveContainer width="100%" height={280}>
                        <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="buyGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                                </linearGradient>
                                <linearGradient id="sellGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.25} />
                                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
                            <XAxis
                                dataKey="time"
                                tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.5 }}
                                tickLine={false}
                                axisLine={false}
                                interval="preserveStartEnd"
                            />
                            <YAxis
                                tickFormatter={fmt}
                                tick={{ fontSize: 10, fill: 'currentColor', opacity: 0.5 }}
                                tickLine={false}
                                axisLine={false}
                                width={60}
                            />
                            <Tooltip
                                formatter={(val: number, name: string) => [fmt(val) + ' ' + unit, name]}
                                labelStyle={{ fontWeight: 600, marginBottom: 4 }}
                                contentStyle={{
                                    borderRadius: 8,
                                    border: '1px solid rgba(0,0,0,0.08)',
                                    fontSize: 12,
                                }}
                            />
                            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                            <Area
                                type="monotone"
                                dataKey="Mua"
                                stroke="#10b981"
                                strokeWidth={2}
                                fill="url(#buyGrad)"
                                dot={false}
                                activeDot={{ r: 3 }}
                            />
                            <Area
                                type="monotone"
                                dataKey="Bán"
                                stroke="#ef4444"
                                strokeWidth={2}
                                fill="url(#sellGrad)"
                                dot={false}
                                activeDot={{ r: 3 }}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
}

// ─── Net flow bar chart ───────────────────────────────────────────────────────

function NetFlowChart({ points, isLoading }: { points: ForeignVolumePoint[]; isLoading: boolean }) {
    const chartData = points.map(p => ({
        time: p.time,
        'Mua ròng': p.buyVolume - p.sellVolume,
    }));

    return (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
            <div className="px-4 pt-4 pb-2">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    Mua ròng theo phút
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">Khối lượng mua − bán từng phút</p>
            </div>
            <div className="px-4 pb-4">
                {isLoading ? (
                    <div className="flex items-center justify-center h-40">
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-blue-600" />
                    </div>
                ) : chartData.length === 0 ? (
                    <div className="flex items-center justify-center h-40 text-sm text-gray-400">
                        Không có dữ liệu — thị trường có thể đang đóng cửa
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
                            <XAxis
                                dataKey="time"
                                tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.5 }}
                                tickLine={false}
                                axisLine={false}
                                interval="preserveStartEnd"
                            />
                            <YAxis
                                tickFormatter={fmtVolume}
                                tick={{ fontSize: 10, fill: 'currentColor', opacity: 0.5 }}
                                tickLine={false}
                                axisLine={false}
                                width={55}
                            />
                            <Tooltip
                                formatter={(val: number) => [fmtVolume(val) + ' CP', 'Mua ròng']}
                                contentStyle={{ borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', fontSize: 12 }}
                            />
                            <Bar
                                dataKey="Mua ròng"
                                radius={[2, 2, 0, 0]}
                                fill="#10b981"
                                /* negative bars rendered red via Cell would need custom logic, kept simple */
                            />
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ForeignPage() {
    const [buyList,  setBuyList]  = useState<ForeignNetItem[]>([]);
    const [sellList, setSellList] = useState<ForeignNetItem[]>([]);
    const [points,   setPoints]   = useState<ForeignVolumePoint[]>([]);
    const [netLoading, setNetLoading]    = useState(true);
    const [chartLoading, setChartLoading] = useState(true);
    const [lastUpdated, setLastUpdated]  = useState<Date | null>(null);

    const loadAll = useCallback(async () => {
        const [netResult, chartResult] = await Promise.allSettled([
            fetchForeignNetValue(),
            fetchForeignVolumeChart(),
        ]);

        if (netResult.status === 'fulfilled') {
            setBuyList(netResult.value.buyList);
            setSellList(netResult.value.sellList);
        }
        setNetLoading(false);

        if (chartResult.status === 'fulfilled') {
            setPoints(chartResult.value);
        }
        setChartLoading(false);
        setLastUpdated(new Date());
    }, []);

    useEffect(() => {
        loadAll();
        const timer = setInterval(loadAll, REFRESH_MS);
        return () => clearInterval(timer);
    }, [loadAll]);

    const totalNetBuy  = buyList.reduce((s, i)  => s + i.Value, 0);
    const totalNetSell = sellList.reduce((s, i) => s + i.Value, 0);
    const netFlow = totalNetBuy - totalNetSell;

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
            <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

                {/* Page header */}
                <div className="flex items-start justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                            Giao dịch Khối Ngoại
                        </h1>
                        <p className="text-sm text-gray-500 mt-0.5">
                            Nguồn: VCI · HOSE · Cập nhật mỗi 60 giây
                        </p>
                    </div>
                    {lastUpdated && (
                        <span className="text-xs text-gray-400 pt-1">
                            {lastUpdated.toLocaleTimeString('vi-VN')}
                        </span>
                    )}
                </div>

                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-4">
                    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 shadow-sm">
                        <p className="text-xs text-gray-500 mb-1">Tổng mua ròng</p>
                        <p className="text-xl font-bold text-emerald-600 tabular-nums">
                            +{fmtBillion(totalNetBuy)}
                        </p>
                    </div>
                    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 shadow-sm">
                        <p className="text-xs text-gray-500 mb-1">Tổng bán ròng</p>
                        <p className="text-xl font-bold text-red-500 tabular-nums">
                            -{fmtBillion(totalNetSell)}
                        </p>
                    </div>
                    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 shadow-sm">
                        <p className="text-xs text-gray-500 mb-1">Dòng tiền ròng</p>
                        <p className={`text-xl font-bold tabular-nums ${netFlow >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {netFlow >= 0 ? '+' : ''}{fmtBillion(netFlow)}
                        </p>
                    </div>
                </div>

                {/* Charts row */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <VolumeCharts   points={points} isLoading={chartLoading} />
                    <NetFlowChart   points={points} isLoading={chartLoading} />
                </div>

                {/* Net value table */}
                <NetValueSection buyList={buyList} sellList={sellList} isLoading={netLoading} />
            </div>
        </div>
    );
}
