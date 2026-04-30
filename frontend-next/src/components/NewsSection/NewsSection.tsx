'use client';

import { NewsItem, formatRelativeTime } from '@/lib/api';
import { Card, Icon } from '@tremor/react';
import { RiArrowRightUpLine, RiNewspaperLine } from '@remixicon/react';
import Link from 'next/link';

interface NewsSectionProps {
    news: NewsItem[];
    isLoading?: boolean;
    error?: string | null;
}

function sentimentColor(sentiment: string | undefined): string {
    if (!sentiment) return 'text-gray-500 dark:text-gray-400';
    const s = sentiment.toLowerCase();
    if (s === 'positive') return 'text-emerald-600 dark:text-emerald-400';
    if (s === 'negative') return 'text-rose-600 dark:text-rose-400';
    return 'text-gray-500 dark:text-gray-400';
}

export default function NewsSection({ news, isLoading, error }: NewsSectionProps) {
    if (isLoading) {
        return (
            <Card className="p-4 md:p-6">
                <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                    <Icon icon={RiNewspaperLine} className="text-blue-500" size="sm" />
                    <h3 className="text-base md:text-lg font-bold">Market News</h3>
                </div>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 animate-pulse">
                            <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-4/5" />
                            <div className="mt-2 h-4 bg-slate-200 dark:bg-slate-800 rounded w-3/5" />
                            <div className="mt-4 h-3 bg-slate-100 dark:bg-slate-900 rounded w-1/2" />
                        </div>
                    ))}
                </div>
            </Card>
        );
    }

    if (error) {
        return (
            <Card className="p-4 md:p-6">
                <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                    <Icon icon={RiNewspaperLine} className="text-blue-500" size="sm" />
                    <h3 className="text-base md:text-lg font-bold">Market News</h3>
                </div>
                <div className="mt-4 rounded-xl border border-rose-200 dark:border-rose-900/40 bg-rose-50/80 dark:bg-rose-950/30 p-4">
                    <p className="text-rose-600 dark:text-rose-400 font-medium text-sm">⚠️ {error}</p>
                </div>
            </Card>
        );
    }

    return (
        <Card className="p-4 md:p-6 mt-2 md:mt-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                        <Icon icon={RiNewspaperLine} className="text-blue-500" size="sm" />
                        <h3 className="text-base md:text-lg font-bold">Market News</h3>
                    </div>
                    <p className="mt-1 text-xs md:text-sm text-slate-500 dark:text-slate-400">
                        Tin mới nhất, cập nhật liên tục theo thị trường.
                    </p>
                </div>
                <Link
                    href="/news"
                    className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-blue-600 hover:border-blue-300 dark:hover:text-blue-400"
                >
                    View all
                    <Icon icon={RiArrowRightUpLine} size="xs" className="ml-1" />
                </Link>
            </div>

            {news.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                    Chưa có tin tức mới.
                </div>
            ) : (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {news.slice(0, 10).map((item, index) => {
                    const url = item.url || item.Link || item.NewsUrl || '#';
                    const finalUrl = url.startsWith('http') ? url : `https://cafef.vn${url}`;
                    const title = item.title || item.Title || '';
                    const source = item.source || item.Source || 'Tổng hợp';
                    const pubDateStr = item.publish_date || item.PostDate || item.PublishDate;
                    const timeFormat = pubDateStr ? formatRelativeTime(pubDateStr, 'vi-VN') : '';
                    const image = item.image_url || item.ImageThumb || item.Avatar || '';
                    const symbol = item.Symbol || item.symbol || '';
                    const sentiment = item.Sentiment || item.sentiment;
                    const colorClass = sentimentColor(sentiment);

                    return (
                        <a
                            key={index}
                            href={finalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="group rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-3 md:p-4 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm transition-all"
                        >
                            <div className="flex items-start gap-3">
                                {image ? (
                                    <div className="w-16 h-16 md:w-20 md:h-16 shrink-0 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={image}
                                            alt=""
                                            className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-300"
                                            loading="lazy"
                                            onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                                        />
                                    </div>
                                ) : (
                                    <div className="w-16 h-16 md:w-20 md:h-16 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                                        <Icon icon={RiNewspaperLine} size="sm" className="text-slate-400" />
                                    </div>
                                )}

                                <div className="min-w-0 flex-1">
                                    <h4 className="text-[14px] md:text-[15px] font-semibold text-slate-900 dark:text-slate-100 leading-snug line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                                    {title}
                                    </h4>

                                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] md:text-xs text-slate-500 dark:text-slate-400">
                                        <div className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5">
                                            <span className="font-medium text-slate-700 dark:text-slate-300">{source}</span>
                                        </div>
                                        {timeFormat && (
                                            <span className="inline-flex items-center rounded-md bg-slate-50 dark:bg-slate-900 px-1.5 py-0.5 border border-slate-200 dark:border-slate-700">
                                                {timeFormat}
                                            </span>
                                        )}
                                        {symbol && (
                                            <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-bold bg-slate-100 dark:bg-slate-800 ${colorClass}`}>
                                                {symbol}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </a>
                    );
                })}
                </div>
            )}
        </Card>
    );
}
