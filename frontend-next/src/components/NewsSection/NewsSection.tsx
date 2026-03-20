'use client';

import { useEffect, useState } from 'react';
import { NewsItem, formatRelativeTime, formatNumber } from '@/lib/api';
import {
    Card,
    Title,
    Flex,
    Icon,
} from '@tremor/react';
import { RiNewspaperLine, RiArrowRightUpLine } from '@remixicon/react';
import Link from 'next/link';

interface NewsSectionProps {
    news: NewsItem[];
    isLoading?: boolean;
    error?: string | null;
}

interface SymbolPrice {
    price: number;
    change: number;
    changePercent: number;
}

export default function NewsSection({ news, isLoading, error }: NewsSectionProps) {
    const [prices, setPrices] = useState<Record<string, SymbolPrice>>({});

    // Fetch prices for ALL news symbols in 1 single request using bulk endpoint
    useEffect(() => {
        if (!news || news.length === 0) return;

        const uniqueSymbols = [...new Set(
            news.map(item => item.Symbol || item.symbol || '').filter(Boolean)
        )];

        if (uniqueSymbols.length === 0) return;

        // ONE request with ?symbols=FMC,SSI,VNM,... instead of N separate requests
        fetch(`/api/market/prices?symbols=${uniqueSymbols.join(',')}`)
            .then(r => r.ok ? r.json() : {})
            .then((data: Record<string, SymbolPrice>) => {
                setPrices(data);
            })
            .catch(() => { /* silently fail - prices are optional */ });
    }, [news]);

    if (isLoading) {
        return (
            <Card className="p-6">
                <Title className="text-tremor-content-strong dark:text-dark-tremor-content-strong font-bold flex items-center">
                    <Icon icon={RiNewspaperLine} className="mr-2 text-blue-500" size="sm" />
                    Market News
                </Title>
                <div className="flex flex-col items-center justify-center py-12 space-y-4">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-tremor-brand" />
                    <p className="text-tremor-content dark:text-dark-tremor-content text-sm">Loading latest news...</p>
                </div>
            </Card>
        );
    }

    if (error) {
        return (
            <Card className="p-6">
                <Title className="text-tremor-content-strong dark:text-dark-tremor-content-strong font-bold flex items-center">
                    <Icon icon={RiNewspaperLine} className="mr-2 text-blue-500" size="sm" />
                    Market News
                </Title>
                <div className="py-12 text-center text-rose-500">
                    <p className="text-rose-500 font-medium text-sm">⚠️ {error}</p>
                </div>
            </Card>
        );
    }

    return (
        <Card className="p-3 md:p-6 mt-4 md:mt-6">
            <Flex alignItems="center" justifyContent="between">
                <Title className="text-sm md:text-tremor-content-strong dark:text-dark-tremor-content-strong font-semibold flex items-center">
                    <Icon icon={RiNewspaperLine} className="mr-1.5 md:mr-2 text-blue-500" size="sm" />
                    Market News
                </Title>
                {news.length > 8 && (
                    <Link href="/news" className="text-xs font-medium text-tremor-brand hover:underline flex items-center">
                        View More<span className="hidden sm:inline">&nbsp;News</span> <Icon icon={RiArrowRightUpLine} size="xs" className="ml-0.5 md:ml-1" />
                    </Link>
                )}
            </Flex>

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 lg:gap-x-4 border-t border-gray-100 dark:border-gray-800">
                {news.slice(0, 10).map((item, index) => {
                    const url = item.url || item.Link || item.NewsUrl || '#';
                    const finalUrl = url.startsWith('http') ? url : `https://cafef.vn${url}`;
                    const title = item.title || item.Title || '';
                    const source = item.source || item.Source || 'Tổng hợp';
                    const pubDateStr = item.publish_date || item.PostDate || item.PublishDate;
                    const timeFormat = pubDateStr ? formatRelativeTime(pubDateStr, 'vi-VN') : '';
                    const image = item.image_url || item.ImageThumb || item.Avatar || '';
                    const symbol = item.Symbol || item.symbol || '';
                    const priceInfo = symbol ? prices[symbol] : undefined;

                    // Price color
                    const priceUp = priceInfo && priceInfo.change > 0;
                    const priceDown = priceInfo && priceInfo.change < 0;
                    const priceColor = priceUp
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : priceDown
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-gray-500';

                    return (
                        <div
                            key={index}
                            className={`flex items-start gap-3 md:gap-4 py-6 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-all cursor-pointer group px-1 ${index % 2 === 0 ? 'lg:border-r lg:pr-4 lg:mr-[-1px]' : 'lg:pl-4'}`}
                            onClick={() => window.open(finalUrl, '_blank')}
                        >
                            <div className="flex-1 min-w-0 order-1">
                                {/* Title */}
                                <h3 className="text-[15px] md:text-[16px] font-bold text-slate-900 dark:text-slate-100 leading-snug line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors mb-3">
                                    {title}
                                </h3>

                                {/* Meta Footer */}
                                <div className="flex items-center gap-2 flex-wrap text-slate-500">
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <div className="w-5 h-5 rounded overflow-hidden flex items-center justify-center bg-white shadow-sm border border-gray-100">
                                            <img
                                                src={`https://www.google.com/s2/favicons?domain=${finalUrl.split('/')[2]}&sz=64`}
                                                alt=""
                                                className="w-3.5 h-3.5 object-contain"
                                                onError={(e) => { (e.target as HTMLImageElement).src = 'https://www.google.com/s2/favicons?domain=cafef.vn&sz=64'; }}
                                            />
                                        </div>
                                        <span className="text-[12px] font-bold text-slate-700 dark:text-slate-300">{source}</span>
                                    </div>
                                    <span className="text-slate-300 dark:text-slate-700 font-bold">·</span>
                                    <span className="text-[12px] font-medium">{timeFormat}</span>

                                    {symbol && (
                                        <>
                                            <span className="text-slate-300 dark:text-slate-700 font-bold">·</span>
                                            <span className={`text-[12px] font-extrabold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 ${priceColor}`}>{symbol}</span>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Thumbnail on the right */}
                            {image && (
                                <div className="w-20 h-20 md:w-28 md:h-20 shrink-0 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 shadow-sm order-2">
                                    <img
                                        src={image}
                                        alt=""
                                        className="w-full h-full object-cover transition-transform group-hover:scale-110 duration-500"
                                        loading="lazy"
                                        onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </Card>
    );
}
