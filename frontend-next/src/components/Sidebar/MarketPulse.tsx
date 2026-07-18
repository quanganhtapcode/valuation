'use client';

import { memo, useState, useCallback, useEffect } from 'react';
import {
    Card,
} from '@tremor/react';
import Link from 'next/link';
import { TopMoverItem } from '@/lib/api';
import { siteConfig } from '@/app/siteConfig';
import { useLanguage } from '@/lib/languageContext';
import { getTickerData } from '@/lib/tickerCache';

interface MarketPulseProps {
    gainers: TopMoverItem[];
    losers: TopMoverItem[];
    isLoading?: boolean;
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

function MarketPulse({
    gainers,
    losers,
    isLoading
}: MarketPulseProps) {
    const { lang } = useLanguage();
    const [englishNames, setEnglishNames] = useState<Record<string, string>>({});

    useEffect(() => {
        if (lang !== 'en') return;
        let active = true;
        getTickerData().then((data) => {
            if (!active || !data?.tickers) return;
            const names = Object.fromEntries(
                data.tickers
                    .filter((ticker: { symbol?: string; en_name?: string }) => ticker.symbol && ticker.en_name)
                    .map((ticker: { symbol: string; en_name: string }) => [ticker.symbol, ticker.en_name]),
            );
            setEnglishNames(names);
        });
        return () => { active = false; };
    }, [lang]);

    return (
        <Card className="p-0 overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm rounded-xl">
            {/* Content Area */}
            <div className="p-0">
                <MarketList
                    items1={gainers}
                    items2={losers}
                    label1={lang === 'en' ? 'Gainers' : 'Tăng giá'}
                    label2={lang === 'en' ? 'Losers' : 'Giảm giá'}
                    type="movers"
                    isLoading={isLoading}
                    companyNames={lang === 'en' ? englishNames : undefined}
                />
            </div>
        </Card>
    );
}

export default memo(
    MarketPulse,
    (prev, next) =>
        prev.isLoading === next.isLoading &&
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
    companyNames,
}: {
    items1: TopMoverItem[],
    items2: TopMoverItem[],
    label1: string,
    label2: string,
    type: 'movers' | 'foreign',
    isLoading?: boolean,
    companyNames?: Record<string, string>,
}) {
    const [subTab, setSubTab] = useState(0); // 0 or 1
    const items = subTab === 0 ? items1 : items2;

    const handleSubTabChange = useCallback((nextTab: 0 | 1) => {
        setSubTab((prev) => (prev === nextTab ? prev : nextTab));
    }, []);

    return (
        <div className="flex flex-col">
            {/* Flat header, matching the Watchlist card rather than a separate tab panel. */}
            <div className="flex items-center gap-1 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
                <button
                    onClick={() => handleSubTabChange(0)}
                    className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${subTab === 0
                        ? 'bg-gray-100 text-gray-950 dark:bg-gray-800 dark:text-gray-50'
                        : 'text-gray-400 hover:bg-gray-50 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200'
                        }`}
                >
                    {label1}
                </button>
                <button
                    onClick={() => handleSubTabChange(1)}
                    className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${subTab === 1
                        ? 'bg-gray-100 text-gray-950 dark:bg-gray-800 dark:text-gray-50'
                        : 'text-gray-400 hover:bg-gray-50 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200'
                        }`}
                >
                    {label2}
                </button>
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
                                    className="flex items-center justify-between px-4 py-3 hover:bg-gray-50/80 dark:hover:bg-gray-800/40 transition-colors group"
                                >
                                    <div className="flex items-center gap-3 overflow-hidden flex-1 mr-2">
                                        <div className="shrink-0 relative size-9 rounded-full bg-white border border-tremor-border dark:border-dark-tremor-border dark:bg-gray-800 flex items-center justify-center p-0.5 group-hover:border-blue-200 transition-colors overflow-hidden">
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
                                            <span className="hidden w-full h-full bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center text-[10px] font-bold text-gray-500">
                                                {item.Symbol[0]}
                                            </span>
                                        </div>
                                        <div className="flex flex-col min-w-0 flex-1">
                                            <span className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong truncate w-full" title={companyNames?.[item.Symbol] || item.CompanyName}>
                                                {companyNames?.[item.Symbol] || item.CompanyName}
                                            </span>
                                            <div className="flex items-center gap-1.5 text-xs text-tremor-content-subtle">
                                                <span className="font-medium text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis">{item.Symbol}</span>
                                                <span className="text-tremor-content-subtle">·</span>
                                                <span>HOSE</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex flex-col items-end shrink-0">
                                        {type === 'movers' ? (
                                            <>
                                                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                                                    {item.CurrentPrice?.toLocaleString('en-US')}
                                                </div>

                                                {isUp ? (
                                                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
                                                        +{item.ChangePricePercent.toFixed(2)}%
                                                    </span>
                                                ) : isDown ? (
                                                    <span className="text-xs font-medium text-red-500 dark:text-red-400 tabular-nums">
                                                        -{Math.abs(item.ChangePricePercent).toFixed(2)}%
                                                    </span>
                                                ) : (
                                                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 tabular-nums">
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
