'use client';

import Image from 'next/image';
import { memo, useState, useCallback } from 'react'; // useCallback used by MarketList
import {
    Card,
} from '@tremor/react';
import Link from 'next/link';
import { TopMoverItem } from '@/lib/api';
import { siteConfig } from '@/app/siteConfig';

export type MarketCenterID = 'HOSE' | 'HNX' | 'UPCOM';

const MARKET_CENTERS: MarketCenterID[] = ['HOSE', 'HNX', 'UPCOM'];

interface MarketPulseProps {
    gainers: TopMoverItem[];
    losers: TopMoverItem[];
    isLoading?: boolean;
    centerID?: MarketCenterID;
    onCenterChange?: (centerID: MarketCenterID) => void;
}

function sameMovers(a: TopMoverItem[], b: TopMoverItem[]): boolean {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        const x = a[i];
        const y = b[i];
        if (!x || !y) return false;
        if (
            x.Symbol !== y.Symbol ||
            Number(x.CurrentPrice || 0) !== Number(y.CurrentPrice || 0) ||
            Number(x.ChangePricePercent || 0) !== Number(y.ChangePricePercent || 0) ||
            Number(x.Value || 0) !== Number(y.Value || 0)
        ) {
            return false;
        }
    }
    return true;
}

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
            <Image src={icon.light} alt={alt} width={14} height={14} className="block dark:hidden size-3.5" unoptimized />
            <Image src={icon.dark} alt={alt} width={14} height={14} className="hidden dark:block size-3.5" unoptimized />
        </span>
    );
}

function MarketPulse({
    gainers,
    losers,
    isLoading,
    centerID = 'HOSE',
    onCenterChange,
}: MarketPulseProps) {
    return (
        <Card className="p-0 overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm rounded-xl">
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
                <span className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">Top Movers</span>
                <div className="grid grid-cols-3 rounded-md border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-900">
                    {MARKET_CENTERS.map(center => (
                        <button
                            key={center}
                            type="button"
                            onClick={() => onCenterChange?.(center)}
                            className={`min-w-14 rounded px-2 py-1 text-xs font-semibold transition-colors ${
                                centerID === center
                                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100'
                                    : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                            }`}
                        >
                            {center}
                        </button>
                    ))}
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
                    centerID={centerID}
                />
            </div>
        </Card>
    );
}

export default memo(
    MarketPulse,
    (prev, next) =>
        prev.isLoading === next.isLoading &&
        prev.centerID === next.centerID &&
        sameMovers(prev.gainers, next.gainers) &&
        sameMovers(prev.losers, next.losers),
);

function MarketList({
    items1,
    items2,
    label1,
    label2,
    type,
    isLoading,
    centerID,
}: {
    items1: TopMoverItem[],
    items2: TopMoverItem[],
    label1: string,
    label2: string,
    type: 'movers' | 'foreign',
    isLoading?: boolean,
    centerID: MarketCenterID,
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
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
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
                                                <span>{centerID}</span>
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
