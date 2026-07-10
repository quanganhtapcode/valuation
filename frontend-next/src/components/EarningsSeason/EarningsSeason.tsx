'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchEarningsSeason, fetchMarketTakeaways, EarningsSeasonData, EarningsGrower, MarketTakeawaysData } from '@/lib/api';

type TabKey = 'revenue_yoy' | 'revenue_qoq' | 'profit_yoy' | 'profit_qoq';

const TABS: { key: TabKey; label: string }[] = [
    { key: 'revenue_yoy', label: 'Doanh thu YoY' },
    { key: 'revenue_qoq', label: 'Doanh thu QoQ' },
    { key: 'profit_yoy', label: 'Lợi nhuận YoY' },
    { key: 'profit_qoq', label: 'Lợi nhuận QoQ' },
];

function formatTrillions(val: number): string {
    if (val >= 1e12) return (val / 1e12).toFixed(1) + 'T';
    if (val >= 1e9) return (val / 1e9).toFixed(1) + 'B';
    return (val / 1e6).toFixed(0) + 'M';
}

function GrowthBadge({ pct }: { pct: number }) {
    const color = pct >= 0
        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
        : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    return (
        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${color}`}>
            {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
        </span>
    );
}

function GrowerRow({ rank, item }: { rank: number; item: EarningsGrower }) {
    return (
        <div className="flex items-center gap-3 py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
            <span className="w-5 shrink-0 text-xs text-gray-400 dark:text-gray-600 text-right tabular-nums">{rank}</span>
            <div className="flex-1 min-w-0">
                <Link
                    href={`/stock/${item.ticker}`}
                    className="text-sm font-semibold text-blue-600 hover:text-blue-500 dark:text-blue-400"
                >
                    {item.ticker}
                </Link>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.name}</p>
            </div>
            <div className="text-right shrink-0">
                <GrowthBadge pct={item.growth_pct} />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 tabular-nums">
                    {formatTrillions(item.base_value)} → {formatTrillions(item.current_value)}
                </p>
            </div>
        </div>
    );
}

function Skeleton() {
    return (
        <div className="animate-pulse space-y-3">
            <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3].map(i => (
                    <div key={i} className="rounded-xl bg-gray-100 dark:bg-gray-800 h-16" />
                ))}
            </div>
            <div className="flex gap-2">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className="h-7 w-24 rounded-full bg-gray-100 dark:bg-gray-800" />
                ))}
            </div>
            {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-10 rounded-lg bg-gray-100 dark:bg-gray-800" />
            ))}
        </div>
    );
}

export default function EarningsSeason() {
    const [takeaways, setTakeaways] = useState<MarketTakeawaysData | null>(null);
    const [earnings, setEarnings] = useState<EarningsSeasonData | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabKey>('revenue_yoy');

    useEffect(() => {
        let cancelled = false;
        fetchEarningsSeason().then(data => {
            if (!cancelled) {
                setEarnings(data);
                setLoading(false);
            }
        });

        const fetchTakeaways = () => fetchMarketTakeaways().then(data => {
            if (!cancelled) setTakeaways(data);
        });
        const idleTimer = window.setTimeout(fetchTakeaways, 500);
        return () => {
            cancelled = true;
            window.clearTimeout(idleTimer);
        };
    }, []);

    const data: EarningsSeasonData | null = takeaways?.earnings ?? earnings;
    const growers: EarningsGrower[] = data
        ? activeTab === 'revenue_yoy' ? data.top_revenue_yoy
        : activeTab === 'revenue_qoq' ? data.top_revenue_qoq
        : activeTab === 'profit_yoy' ? data.top_profit_yoy
        : data.top_profit_qoq
        : [];

    return (
        <section className="rounded-2xl bg-white dark:bg-gray-900 ring-1 ring-gray-200 dark:ring-gray-800 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-baseline gap-2">
                    <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">
                        AI Market Takeaways
                    </h2>
                    {data && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                            HSX movers · BCTC {data.quarter}
                        </span>
                    )}
                </div>
                {takeaways && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                        {new Date(takeaways.generated_at).toLocaleDateString('vi-VN')}
                    </span>
                )}
            </div>

            {loading ? (
                <Skeleton />
            ) : !data ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">Không thể tải dữ liệu.</p>
            ) : (
                <>
                    {takeaways && (
                    <div className="mb-4 rounded-xl bg-slate-50 p-3 dark:bg-gray-800">
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                                {takeaways.headline}
                            </p>
                            <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                                takeaways.available
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                    : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                            }`}>
                                {takeaways.available ? 'AI' : 'Fallback'}
                            </span>
                        </div>
                        <ul className="space-y-1.5">
                            {takeaways.summary.slice(0, 4).map((item, index) => (
                                <li key={`${index}-${item}`} className="flex gap-2 text-sm leading-snug text-gray-600 dark:text-gray-300">
                                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                                    <span>{item}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                    )}

                    {takeaways?.watchlist && takeaways.watchlist.length > 0 && (
                        <div className="mb-4 grid gap-2 sm:grid-cols-2">
                            {takeaways.watchlist.slice(0, 4).map((item) => (
                                <Link
                                    key={`${item.symbol}-${item.direction}`}
                                    href={`/stock/${item.symbol}`}
                                    className="rounded-lg border border-gray-100 p-2.5 transition-colors hover:border-blue-200 hover:bg-blue-50/40 dark:border-gray-800 dark:hover:border-blue-900 dark:hover:bg-blue-950/20"
                                >
                                    <div className="mb-1 flex items-center gap-2">
                                        <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">{item.symbol}</span>
                                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                            item.direction === 'up'
                                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                                : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                        }`}>
                                            {item.direction === 'up' ? 'Tăng' : 'Giảm'}
                                        </span>
                                    </div>
                                    <p className="line-clamp-2 text-xs leading-snug text-gray-500 dark:text-gray-400">
                                        {item.takeaway}
                                    </p>
                                </Link>
                            ))}
                        </div>
                    )}

                    {/* Stat cards */}
                    <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Đã có BCTC</p>
                            <p className="text-lg font-bold text-gray-900 dark:text-gray-50 tabular-nums leading-tight">
                                {data.reported_count.toLocaleString('vi-VN')}
                                <span className="text-xs font-normal text-gray-400 dark:text-gray-500">
                                    /{data.total_count.toLocaleString('vi-VN')}
                                </span>
                            </p>
                        </div>
                        <div className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3">
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">% Số công ty</p>
                            <p className="text-lg font-bold text-gray-900 dark:text-gray-50 tabular-nums leading-tight">
                                {data.reported_pct}%
                            </p>
                        </div>
                        <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 p-3">
                            <p className="text-xs text-blue-600 dark:text-blue-400 mb-1">% Vốn hóa</p>
                            <p className="text-lg font-bold text-blue-700 dark:text-blue-300 tabular-nums leading-tight">
                                {data.market_cap_pct}%
                            </p>
                        </div>
                    </div>

                    {/* Sub-tabs */}
                    <div className="flex gap-1.5 mb-3 flex-wrap">
                        {TABS.map(tab => (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                    activeTab === tab.key
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Growers list */}
                    <div>
                        {growers.length === 0 ? (
                            <p className="text-xs text-gray-400 dark:text-gray-500 py-4 text-center">
                                Không có dữ liệu cho kỳ này.
                            </p>
                        ) : (
                            growers.map((item, i) => (
                                <GrowerRow key={item.ticker} rank={i + 1} item={item} />
                            ))
                        )}
                    </div>
                </>
            )}
        </section>
    );
}
