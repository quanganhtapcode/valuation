'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchMarketTakeaways, MarketTakeawaysData } from '@/lib/api';
import { useLanguage } from '@/lib/languageContext';

function Skeleton() {
    return (
        <div className="animate-pulse space-y-3">
            <div className="h-5 w-2/3 rounded bg-gray-100 dark:bg-gray-800" />
            {[1, 2, 3, 4].map(item => (
                <div key={item} className="h-10 rounded-lg bg-gray-100 dark:bg-gray-800" />
            ))}
        </div>
    );
}

export default function EarningsSeason() {
    const { lang } = useLanguage();
    const [takeaways, setTakeaways] = useState<MarketTakeawaysData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const timer = window.setTimeout(() => {
            fetchMarketTakeaways().then(data => {
                if (!cancelled) {
                    setTakeaways(data);
                    setLoading(false);
                }
            });
        }, 500);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, []);

    const isEnglish = lang === 'en';
    const copy = isEnglish
        ? { title: 'AI market takeaways', subtitle: 'News and market moves from the last 24 hours', waiting: 'Awaiting the next market summary.', up: 'Up', down: 'Down', neutral: 'Market news' }
        : { title: 'Tổng hợp thị trường AI', subtitle: 'Tin tức và biến động trong 24 giờ gần nhất', waiting: 'Đang chờ bản tổng hợp mới.', up: 'Tăng', down: 'Giảm', neutral: 'Tin nổi bật' };
    const headline = isEnglish ? takeaways?.headline : (takeaways?.headline_vi || takeaways?.headline);
    const summary = isEnglish ? takeaways?.summary : (takeaways?.summary_vi?.length ? takeaways.summary_vi : takeaways?.summary);
    const marketSummary = isEnglish ? takeaways?.market_summary : takeaways?.market_summary_vi;
    const newsSummary = isEnglish ? takeaways?.news_summary : takeaways?.news_summary_vi;
    const sections = marketSummary?.length || newsSummary?.length
        ? [
            { title: isEnglish ? 'Largest price moves' : 'Biến động giá mạnh', items: marketSummary || [], color: 'bg-emerald-500' },
            { title: isEnglish ? 'News in the last 24 hours' : 'Tin tức trong 24 giờ', items: newsSummary || [], color: 'bg-blue-500' },
        ].filter(section => section.items.length > 0)
        : [{ title: isEnglish ? 'Market summary' : 'Tổng hợp thị trường', items: summary || [], color: 'bg-blue-500' }];

    return (
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800">
            <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">{copy.title}</h2>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{copy.subtitle}</p>
                </div>
                {takeaways && (
                    <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                        {new Date(takeaways.generated_at).toLocaleString(isEnglish ? 'en-US' : 'vi-VN')}
                    </span>
                )}
            </div>

            {loading ? <Skeleton /> : !takeaways ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">{copy.waiting}</p>
            ) : (
                <>
                    <div className="mb-4 rounded-xl bg-slate-50 p-3 dark:bg-gray-800">
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-50">{headline}</p>
                            <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                                takeaways.available
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                    : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                            }`}>
                                {takeaways.available ? 'AI' : 'Fallback'}
                            </span>
                        </div>
                        <div className="space-y-3">
                            {sections.map(section => (
                                <div key={section.title}>
                                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{section.title}</p>
                                    <ul className="space-y-1.5">
                                        {section.items.slice(0, 3).map((item, index) => (
                                            <li key={`${section.title}-${index}-${item}`} className="flex gap-2 text-sm leading-snug text-gray-600 dark:text-gray-300">
                                                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${section.color}`} />
                                                <span>{item}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    </div>

                    {takeaways.watchlist && takeaways.watchlist.length > 0 && (
                        <div className="grid gap-2 sm:grid-cols-2">
                            {takeaways.watchlist.slice(0, 4).map(item => {
                                const label = item.direction === 'up' ? copy.up : item.direction === 'down' ? copy.down : copy.neutral;
                                const color = item.direction === 'up'
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                    : item.direction === 'down'
                                        ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                        : 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
                                return (
                                    <Link
                                        key={`${item.symbol}-${item.direction}`}
                                        href={`/stock/${item.symbol}`}
                                        className="rounded-lg border border-gray-100 p-2.5 transition-colors hover:border-blue-200 hover:bg-blue-50/40 dark:border-gray-800 dark:hover:border-blue-900 dark:hover:bg-blue-950/20"
                                    >
                                        <div className="mb-1 flex items-center gap-2">
                                            <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">{item.symbol}</span>
                                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${color}`}>{label}</span>
                                        </div>
                                        <p className="line-clamp-2 text-xs leading-snug text-gray-500 dark:text-gray-400">{isEnglish ? item.takeaway : (item.takeaway_vi || item.takeaway)}</p>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
