'use client';

import { useState, useCallback } from 'react'; // useCallback used by MarketList
import {
    Card,
} from '@tremor/react';
import Link from 'next/link';
import { TopMoverItem } from '@/lib/api';
import { siteConfig } from '@/app/siteConfig';

interface MarketPulseProps {
    gainers: TopMoverItem[];
    losers: TopMoverItem[];
    isLoading?: boolean;
}

const LOGO_BASE_URL = '/logos/';

type Direction = 'up' | 'unchanged' | 'down';

function vietcapArrowUrls(direction: Direction): { light: string; dark: string } {
    const base = 'https://trading.vietcap.com.vn/vietcap-priceboard/images';
    if (direction === 'up') {
        return {
            light: `${base}/light/arrow-top-right.svg`,
            dark: `${base}/dark/arrow-top-right.svg`,
        };
    }
    if (direction === 'down') {
        return {
            light: `${base}/light/arrow-bottom-left.svg`,
            dark: `${base}/dark/arrow-bottom-left.svg`,
        };
    }
    return {
        light: `${base}/light/unchanged.svg`,
        dark: `${base}/dark/unchanged.svg`,
    };
}

function TrendIcon({ direction, alt }: { direction: Direction; alt: string }) {
    const icon = vietcapArrowUrls(direction);
    return (
        <span className="inline-flex items-center">
            <img src={icon.light} alt={alt} className="block dark:hidden size-3.5" loading="lazy" decoding="async" />
            <img src={icon.dark} alt={alt} className="hidden dark:block size-3.5" loading="lazy" decoding="async" />
        </span>
    );
}

export default function MarketPulse({
    gainers,
    losers,
    isLoading
}: MarketPulseProps) {
    return (
        <Card className="p-0 overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm rounded-xl">
            {/* Header */}
            <div className="flex border-b border-gray-100 dark:border-gray-800">
                <div className="flex-1 py-3 text-sm font-medium text-center text-tremor-brand border-b-2 border-tremor-brand">
                    Top Movers
                </div>
            </div>

            {/* Content Area */}
            <div className="p-0">
                <MarketList
                    items1={gainers}
                    items2={losers}
                    label1="Gainers"
                    label2="Losers"
                    type="movers"
                    isLoading={isLoading}
                />
            </div>
        </Card>
    );
}

function MarketList({
    items1,
    items2,
    label1,
    label2,
    type,
    isLoading,
}: {
    items1: TopMoverItem[],
    items2: TopMoverItem[],
    label1: string,
    label2: string,
    type: 'movers' | 'foreign',
    isLoading?: boolean,
}) {
    const [subTab, setSubTab] = useState(0); // 0 or 1
    const items = subTab === 0 ? items1 : items2;

    const handleSubTabChange = useCallback((nextTab: 0 | 1) => {
        setSubTab((prev) => (prev === nextTab ? prev : nextTab));
    }, []);

    return (
        <div className="flex flex-col">
            {/* Sub-tabs (Pills) */}
            <div className="bg-gray-50 dark:bg-gray-800/50 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
                <div className="flex p-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <button
                        onClick={() => handleSubTabChange(0)}
                        className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${subTab === 0
                            ? 'bg-white dark:bg-gray-800 text-tremor-content-strong dark:text-dark-tremor-content-strong shadow-sm'
                            : 'text-tremor-content-subtle hover:text-tremor-content'
                            }`}
                    >
                        {label1}
                    </button>
                    <button
                        onClick={() => handleSubTabChange(1)}
                        className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${subTab === 1
                            ? 'bg-white dark:bg-gray-800 text-tremor-content-strong dark:text-dark-tremor-content-strong shadow-sm'
                            : 'text-tremor-content-subtle hover:text-tremor-content'
                            }`}
                    >
                        {label2}
                    </button>
                </div>
            </div>

            {/* List */}
            <div className="min-h-[300px]">
                {isLoading ? (
                    <div className="flex items-center justify-center h-40">
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-blue-600" />
                    </div>
                ) : items.length > 0 ? (
                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                        {items.slice(0, 5).map((item) => {
                            const isUp = item.ChangePricePercent > 0;
                            const isDown = item.ChangePricePercent < 0;
                            const valueFormatted = type === 'foreign'
                                ? `${(Math.abs(item.Value || 0) / 1000000000).toFixed(1)}B`
                                : null;

                            return (
                                <Link
                                    key={item.Symbol}
                                    href={`/stock/${item.Symbol}`}
                                    className="flex items-center justify-between px-5 py-4 hover:bg-gray-50/80 dark:hover:bg-gray-800/40 transition-all group relative"
                                >
                                    <div className="flex items-center gap-3 overflow-hidden flex-1 mr-2">
                                        <div className="shrink-0 relative w-9 h-9 rounded-lg bg-white border border-gray-100 dark:border-gray-700 dark:bg-gray-800 flex items-center justify-center p-1.5 shadow-sm group-hover:border-blue-200 transition-colors overflow-hidden">
                                            <img
                                                src={siteConfig.stockLogoUrl(item.Symbol)}
                                                alt={item.Symbol}
                                                className="w-full h-full object-contain"
                                                onError={(e) => {
                                                    const target = e.target as HTMLImageElement;
                                                    if (!target.src.includes('/logos/')) {
                                                        target.src = `/logos/${item.Symbol}.jpg`;
                                                    } else {
                                                        target.style.display = 'none';
                                                        target.nextElementSibling?.classList.remove('hidden');
                                                    }
                                                }}
                                            />
                                            <span className="hidden w-full h-full bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center text-[10px] font-bold text-gray-500">
                                                {item.Symbol[0]}
                                            </span>
                                        </div>
                                        <div className="flex flex-col min-w-0 flex-1">
                                            <span className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong truncate w-full" title={item.CompanyName}>
                                                {item.CompanyName}
                                            </span>
                                            <div className="flex items-center gap-1.5 text-xs text-tremor-content-subtle">
                                                <span className="font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis">{item.Symbol}</span>
                                                <span className="text-tremor-content-subtle">·</span>
                                                <span>HOSE</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex flex-col items-end shrink-0 gap-1">
                                        {type === 'movers' ? (
                                            <>
                                                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                                                    {item.CurrentPrice?.toLocaleString('en-US')}
                                                </div>

                                                {isUp ? (
                                                    <span className="inline-flex items-center gap-x-0.5 rounded-tremor-small bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-600/10 dark:bg-emerald-400/20 dark:text-emerald-500 dark:ring-emerald-400/20 tabular-nums">
                                                        <TrendIcon direction="up" alt="Tăng" />
                                                        {item.ChangePricePercent.toFixed(2)}%
                                                    </span>
                                                ) : isDown ? (
                                                    <span className="inline-flex items-center gap-x-0.5 rounded-tremor-small bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800 ring-1 ring-inset ring-red-600/10 dark:bg-red-400/20 dark:text-red-500 dark:ring-red-400/20 tabular-nums">
                                                        <TrendIcon direction="down" alt="Giảm" />
                                                        {Math.abs(item.ChangePricePercent).toFixed(2)}%
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-x-0.5 rounded-tremor-small bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700 ring-1 ring-inset ring-gray-600/10 dark:bg-gray-500/30 dark:text-gray-300 dark:ring-gray-400/20 tabular-nums">
                                                        <TrendIcon direction="unchanged" alt="Đứng giá" />
                                                        0.00%
                                                    </span>
                                                )}
                                            </>
                                        ) : (
                                            <>
                                                <div className={`text-sm font-semibold ${subTab === 0 ? 'text-emerald-600' : 'text-red-500'} tabular-nums`}>
                                                    {subTab === 0 ? '+' : '-'}{valueFormatted}
                                                </div>
                                                <div className="text-[10px] font-medium text-gray-400">
                                                    VND
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-32 text-gray-400">
                        <span className="text-xs">No data available</span>
                    </div>
                )}
            </div>

        </div>
    );
}
