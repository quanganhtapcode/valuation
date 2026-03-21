'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
    BarList,
    Card,
    LineChart,
    Tab,
    TabGroup,
    TabList,
    TabPanel,
    TabPanels,
} from '@tremor/react';
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
        <div className="w-6 h-6 rounded bg-white border border-gray-200 dark:border-gray-600 flex items-center justify-center overflow-hidden shrink-0">
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

const TIME_TABS: { name: string; filter: (t: string) => boolean }[] = [
    { name: 'Sáng', filter: (t) => t >= '09:00' && t <= '11:35' },
    { name: 'Chiều', filter: (t) => t >= '13:00' },
    { name: 'Cả ngày', filter: () => true },
];

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
    const color = negative ? 'rose' : 'emerald';
    const yFormatter = unit === 'volume' ? fmtVolume : fmtBillion;
    const chartKey = unit === 'volume' ? 'KLGD ròng (CP)' : 'GTGD ròng (VND)';
    const chartData = data.map((d) => ({ time: d.time, [chartKey]: d.value }));

    return (
        <Card className="p-0">
            <div className="p-6">
                <p className="text-tremor-default text-tremor-content dark:text-dark-tremor-content">
                    Lũy kế trong phiên
                </p>
                <p className="mt-1 text-tremor-title font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                    {title}
                </p>
                <p className={`mt-1 text-tremor-metric font-semibold tabular-nums ${negative ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {negative ? '-' : '+'}{unit === 'volume' ? fmtMillionVi(Math.abs(value)) : fmtBillionVi(Math.abs(value))}
                </p>
                <p className="mt-0.5 text-tremor-default text-tremor-content dark:text-dark-tremor-content">
                    09:00 – 15:00
                </p>
            </div>

            {isLoading ? (
                <div className="h-72 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-slate-300 dark:border-slate-700 border-t-slate-700 dark:border-t-slate-200 rounded-full animate-spin" />
                </div>
            ) : data.length === 0 ? (
                <div className="h-72 flex items-center justify-center text-tremor-content dark:text-dark-tremor-content text-sm">
                    Không có dữ liệu phiên
                </div>
            ) : (
                <TabGroup defaultIndex={2}>
                    <TabList className="px-6">
                        {TIME_TABS.map((tab) => (
                            <Tab
                                key={tab.name}
                                className="font-medium hover:border-tremor-content-subtle dark:hover:border-dark-tremor-content-subtle dark:hover:text-dark-tremor-content"
                            >
                                {tab.name}
                            </Tab>
                        ))}
                    </TabList>
                    <TabPanels>
                        {TIME_TABS.map((tab) => {
                            const sliced = chartData.filter((d) => tab.filter(d.time));
                            return (
                                <TabPanel key={tab.name} className="p-6">
                                    <LineChart
                                        data={sliced}
                                        index="time"
                                        categories={[chartKey]}
                                        colors={[color]}
                                        valueFormatter={yFormatter}
                                        yAxisWidth={65}
                                        tickGap={10}
                                        showLegend={false}
                                        className="hidden h-56 sm:block"
                                    />
                                    <LineChart
                                        data={sliced}
                                        index="time"
                                        categories={[chartKey]}
                                        colors={[color]}
                                        valueFormatter={yFormatter}
                                        showYAxis={false}
                                        showLegend={false}
                                        startEndOnly={true}
                                        className="h-56 sm:hidden"
                                    />
                                </TabPanel>
                            );
                        })}
                    </TabPanels>
                </TabGroup>
            )}
        </Card>
    );
}

function TopBarChart({
    title,
    subtitle,
    items,
    color,
    isLoading,
}: {
    title: string;
    subtitle: string;
    items: ForeignNetItem[];
    color: 'emerald' | 'rose';
    isLoading: boolean;
}) {
    const data = items.slice(0, 10).map((item) => ({
        name: item.Symbol,
        value: Math.round(item.Value / 1e9 * 10) / 10,
        href: `/stock/${item.Symbol}`,
        icon: () => (
            <div className="w-5 h-5 rounded bg-white border border-slate-200 dark:border-slate-600 flex items-center justify-center overflow-hidden shrink-0 mr-2">
                <img
                    src={siteConfig.stockLogoUrl(item.Symbol)}
                    alt={item.Symbol}
                    className="w-full h-full object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
            </div>
        ),
    }));

    const isEmerald = color === 'emerald';

    return (
        <Card>
            <div className="flex items-center gap-2 mb-1">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isEmerald ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                <p className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                    {title}
                </p>
            </div>
            <p className="text-tremor-default text-tremor-content dark:text-dark-tremor-content mb-5">
                {subtitle}
            </p>

            {isLoading ? (
                <div className="space-y-2.5">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="h-8 rounded animate-pulse bg-slate-100 dark:bg-slate-800" />
                    ))}
                </div>
            ) : data.length === 0 ? (
                <p className="py-10 text-center text-sm text-tremor-content dark:text-dark-tremor-content">
                    Không có dữ liệu
                </p>
            ) : (
                <BarList
                    data={data}
                    color={color}
                    valueFormatter={(v: number) => `${v} tỷ`}
                />
            )}
        </Card>
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
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <TopBarChart
                title="Top Mua ròng"
                subtitle="Khối ngoại mua ròng nhiều nhất hôm nay (tỷ VNĐ)"
                items={buyList}
                color="emerald"
                isLoading={isLoading}
            />
            <TopBarChart
                title="Top Bán ròng"
                subtitle="Khối ngoại bán ròng nhiều nhất hôm nay (tỷ VNĐ)"
                items={sellList}
                color="rose"
                isLoading={isLoading}
            />
        </div>
    );
}

export default function ForeignPage() {
    const [buyList, setBuyList] = useState<ForeignNetItem[]>([]);
    const [sellList, setSellList] = useState<ForeignNetItem[]>([]);
    const [points, setPoints] = useState<ForeignVolumePoint[]>([]);
    const [netLoading, setNetLoading] = useState(true);
    const [chartLoading, setChartLoading] = useState(true);
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
