'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
    Area,
    AreaChart,
    CartesianGrid,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import {
    fetchForeignNetValue,
    fetchForeignVolumeChart,
    ForeignNetItem,
    ForeignVolumePoint,
} from '@/lib/api';
import { siteConfig } from '@/app/siteConfig';

const REFRESH_MS = 60_000;

function fmtBillion(val: number) {
    if (Math.abs(val) >= 1e12) return `${(val / 1e12).toFixed(1)}T`;
    if (Math.abs(val) >= 1e9) return `${(val / 1e9).toFixed(1)}B`;
    if (Math.abs(val) >= 1e6) return `${(val / 1e6).toFixed(0)}M`;
    return val.toLocaleString('en-US');
}

function fmtVolume(val: number) {
    if (Math.abs(val) >= 1e6) return `${(val / 1e6).toFixed(2)}M`;
    if (Math.abs(val) >= 1e3) return `${(val / 1e3).toFixed(1)}K`;
    return val.toLocaleString('en-US');
}

function fmtBillionVi(val: number) {
    return `${(val / 1e9).toFixed(1)} tỷ`;
}

function fmtMillionVi(val: number) {
    return `${(val / 1e6).toFixed(1)} triệu`;
}

function StockDot({ symbol }: { symbol: string }) {
    return (
        <div className="w-6 h-6 rounded bg-neutral-800 border border-neutral-700 flex items-center justify-center overflow-hidden shrink-0">
            <img
                src={siteConfig.stockLogoUrl(symbol)}
                alt={symbol}
                className="w-full h-full object-contain"
                onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                }}
            />
        </div>
    );
}

function toCumulative(points: ForeignVolumePoint[]) {
    let cumBuyVol = 0;
    let cumSellVol = 0;
    let cumBuyVal = 0;
    let cumSellVal = 0;

    const sorted = [...points]
        .filter((p) => p.time >= '09:00' && p.time <= '15:05')
        .sort((a, b) => a.time.localeCompare(b.time));

    return sorted.map((p) => {
        cumBuyVol += p.buyVolume || 0;
        cumSellVol += p.sellVolume || 0;
        cumBuyVal += p.buyValue || 0;
        cumSellVal += p.sellValue || 0;

        const netVolume = (p.cumBuyVolume ?? cumBuyVol) - (p.cumSellVolume ?? cumSellVol);
        const netValue = (p.cumBuyValue ?? cumBuyVal) - (p.cumSellValue ?? cumSellVal);

        return {
            time: p.time,
            netVolume,
            netValue,
        };
    });
}

function CumulativeNetChart({
    title,
    value,
    data,
    unit,
    isLoading,
}: {
    title: string;
    value: number;
    data: Array<{ time: string; value: number }>;
    unit: 'volume' | 'value';
    isLoading: boolean;
}) {
    const negative = value < 0;
    const stroke = negative ? '#ef4444' : '#10b981';
    const fillId = unit === 'volume' ? 'netVolFill' : 'netValFill';
    const yFormatter = unit === 'volume' ? fmtVolume : fmtBillion;

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Lũy kế trong phiên</p>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        {title}
                    </h3>
                    <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">09:00 - 15:05</p>
                </div>
                <div className={`text-right text-2xl font-semibold tabular-nums ${negative ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {negative ? '-' : '+'}
                    {unit === 'volume' ? fmtMillionVi(Math.abs(value)) : fmtBillionVi(Math.abs(value))}
                </div>
            </div>

            {isLoading ? (
                <div className="h-[220px] flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-slate-300 dark:border-slate-700 border-t-slate-700 dark:border-t-slate-200 rounded-full animate-spin" />
                </div>
            ) : data.length === 0 ? (
                <div className="h-[220px] flex items-center justify-center text-slate-500 dark:text-slate-400 text-sm">
                    Không có dữ liệu phiên
                </div>
            ) : (
                <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={stroke} stopOpacity={0.22} />
                                <stop offset="95%" stopColor={stroke} stopOpacity={0.03} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.28)" />
                        <XAxis
                            dataKey="time"
                            tick={{ fill: '#64748b', fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                            interval="preserveStartEnd"
                        />
                        <YAxis
                            tickFormatter={yFormatter}
                            tick={{ fill: '#64748b', fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                            width={65}
                        />
                        <ReferenceLine y={0} stroke="rgba(100,116,139,0.48)" strokeWidth={1} />
                        <Tooltip
                            formatter={(v: number | string | undefined) => {
                                const num = Number(v) || 0;
                                return [unit === 'volume' ? `${fmtVolume(num)} CP` : `${fmtBillion(num)} VND`, 'Ròng tích lũy'];
                            }}
                            contentStyle={{
                                backgroundColor: '#ffffff',
                                border: '1px solid #e2e8f0',
                                borderRadius: 8,
                                color: '#0f172a',
                                fontSize: 12,
                                boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
                            }}
                        />
                        <Area
                            type="monotone"
                            dataKey="value"
                            stroke={stroke}
                            strokeWidth={2}
                            fill={`url(#${fillId})`}
                            dot={false}
                            activeDot={{ r: 3, stroke: '#fff', strokeWidth: 1 }}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            )}
        </div>
    );
}

function TopStocksPanel({
    buyList,
    sellList,
    isLoading,
}: {
    buyList: ForeignNetItem[];
    sellList: ForeignNetItem[];
    isLoading: boolean;
}) {
    const topBuy = buyList.slice(0, 10);
    const topSell = sellList.slice(0, 10);
    const maxBuy = Math.max(...topBuy.map((x) => x.Value), 1);
    const maxSell = Math.max(...topSell.map((x) => x.Value), 1);

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Top cổ phiếu giao dịch (tỷ VND)</h3>
                <span className="text-xs text-slate-500 dark:text-slate-400">Theo giá trị ròng</span>
            </div>

            {isLoading ? (
                <div className="space-y-3">
                    {Array.from({ length: 10 }).map((_, i) => (
                        <div key={i} className="grid grid-cols-2 gap-5 animate-pulse">
                            <div className="h-8 rounded bg-slate-200 dark:bg-slate-800" />
                            <div className="h-8 rounded bg-slate-200 dark:bg-slate-800" />
                        </div>
                    ))}
                </div>
            ) : (
                <div>
                    <div className="grid grid-cols-2 gap-5 text-sm font-semibold mb-3">
                        <p className="text-center text-emerald-600 dark:text-emerald-400">Mua ròng</p>
                        <p className="text-center text-rose-600 dark:text-rose-400">Bán ròng</p>
                    </div>

                    <div className="space-y-2">
                        {Array.from({ length: 10 }).map((_, idx) => {
                            const buy = topBuy[idx];
                            const sell = topSell[idx];
                            return (
                                <div key={idx} className="grid grid-cols-2 gap-5 items-center">
                                    <div>
                                        {buy ? (
                                            <Link href={`/stock/${buy.Symbol}`} className="grid grid-cols-[88px_1fr_auto] items-center gap-2 group">
                                                <span className="text-right text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums text-sm">
                                                    {(buy.Value / 1e9).toFixed(1)}
                                                </span>
                                                <div className="h-6 rounded bg-emerald-100 dark:bg-emerald-900/30 overflow-hidden">
                                                    <div
                                                        className="h-full bg-emerald-500/90 rounded"
                                                        style={{ width: `${Math.max(8, (buy.Value / maxBuy) * 100)}%` }}
                                                    />
                                                </div>
                                                <div className="flex items-center gap-2 min-w-[74px]">
                                                    <StockDot symbol={buy.Symbol} />
                                                    <span className="text-slate-900 dark:text-slate-100 font-semibold group-hover:text-emerald-600 dark:group-hover:text-emerald-300 transition-colors">{buy.Symbol}</span>
                                                </div>
                                            </Link>
                                        ) : (
                                            <div className="h-6" />
                                        )}
                                    </div>

                                    <div>
                                        {sell ? (
                                            <Link href={`/stock/${sell.Symbol}`} className="grid grid-cols-[auto_1fr_88px] items-center gap-2 group">
                                                <div className="flex items-center justify-end gap-2 min-w-[74px]">
                                                    <span className="text-slate-900 dark:text-slate-100 font-semibold group-hover:text-rose-600 dark:group-hover:text-rose-300 transition-colors">{sell.Symbol}</span>
                                                    <StockDot symbol={sell.Symbol} />
                                                </div>
                                                <div className="h-6 rounded bg-rose-100 dark:bg-rose-900/30 overflow-hidden">
                                                    <div
                                                        className="h-full bg-rose-500/90 rounded"
                                                        style={{ width: `${Math.max(8, (sell.Value / maxSell) * 100)}%` }}
                                                    />
                                                </div>
                                                <span className="text-rose-600 dark:text-rose-400 font-semibold tabular-nums text-sm">
                                                    -{(sell.Value / 1e9).toFixed(1)}
                                                </span>
                                            </Link>
                                        ) : (
                                            <div className="h-6" />
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function ForeignPage() {
    const [buyList, setBuyList] = useState<ForeignNetItem[]>([]);
    const [sellList, setSellList] = useState<ForeignNetItem[]>([]);
    const [points, setPoints] = useState<ForeignVolumePoint[]>([]);
    const [netLoading, setNetLoading] = useState(true);
    const [chartLoading, setChartLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const loadAll = useCallback(async () => {
        const [netResult, chartResult] = await Promise.allSettled([
            fetchForeignNetValue(),
            fetchForeignVolumeChart(),
        ]);

        if (netResult.status === 'fulfilled') {
            setBuyList(netResult.value.buyList || []);
            setSellList(netResult.value.sellList || []);
        }
        setNetLoading(false);

        if (chartResult.status === 'fulfilled') {
            setPoints(chartResult.value || []);
        }
        setChartLoading(false);
        setLastUpdated(new Date());
    }, []);

    useEffect(() => {
        loadAll();
        const timer = setInterval(loadAll, REFRESH_MS);
        return () => clearInterval(timer);
    }, [loadAll]);

    const cumulative = useMemo(() => toCumulative(points), [points]);
    const volumeData = useMemo(
        () => cumulative.map((p) => ({ time: p.time, value: p.netVolume })),
        [cumulative]
    );
    const valueData = useMemo(
        () => cumulative.map((p) => ({ time: p.time, value: p.netValue })),
        [cumulative]
    );

    const latestVolume = volumeData[volumeData.length - 1]?.value || 0;
    const latestValue = valueData[valueData.length - 1]?.value || 0;

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
            <div className="max-w-[1600px] mx-auto p-4 md:p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-5">
                    <div>
                        <h1 className="text-3xl md:text-4xl font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100">
                            Nước Ngoài <span className="text-emerald-600 dark:text-emerald-400">Tự Doanh</span>
                        </h1>
                        <div className="w-32 h-1 bg-emerald-500 rounded mt-2" />
                        <p className="text-slate-600 dark:text-slate-300 mt-3 text-sm md:text-base max-w-4xl">
                            Biểu đồ thể hiện các cổ phiếu (bao gồm các quỹ ETF) được nước ngoài giao dịch nhiều nhất theo
                            Khối lượng, Giá trị và Mua/Bán ròng.
                        </p>
                    </div>
                    {lastUpdated && (
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900">
                            Cập nhật: {lastUpdated.toLocaleTimeString('vi-VN')}
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <CumulativeNetChart
                            title="KLGD ròng tích lũy (CP)"
                            value={latestVolume}
                            data={volumeData}
                            unit="volume"
                            isLoading={chartLoading}
                        />
                        <CumulativeNetChart
                            title="GTGD ròng tích lũy (VNĐ)"
                            value={latestValue}
                            data={valueData}
                            unit="value"
                            isLoading={chartLoading}
                        />
                </div>

                <TopStocksPanel buyList={buyList} sellList={sellList} isLoading={netLoading} />
            </div>
        </div>
    );
}
