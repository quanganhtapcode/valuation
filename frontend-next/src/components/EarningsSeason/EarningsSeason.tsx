'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchMarketTakeaways, MarketTakeawaysData } from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/translations';
import { localizedPath } from '@/lib/localePath';
import NewsSourceLogos from './NewsSourceLogos';

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

function uniqueTakeawayItems(items?: string[]): string[] {
    const seen = new Set<string>();
    return (items || []).filter(item => {
        const key = item.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
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
    const copy = translations[lang].dashboard.aiTakeaways;
    const headline = isEnglish ? takeaways?.headline : (takeaways?.headline_vi || takeaways?.headline);
    const summary = uniqueTakeawayItems(isEnglish ? takeaways?.summary : (takeaways?.summary_vi?.length ? takeaways.summary_vi : takeaways?.summary));
    const marketSummary = uniqueTakeawayItems(isEnglish ? takeaways?.market_summary : takeaways?.market_summary_vi);
    const newsSummary = uniqueTakeawayItems(isEnglish ? takeaways?.news_summary : takeaways?.news_summary_vi);
    const sections = marketSummary?.length || newsSummary?.length
        ? [
            { title: copy.largestMoves, items: marketSummary || [], isNews: false },
            { title: copy.recentNews, items: newsSummary || [], isNews: true },
        ].filter(section => section.items.length > 0)
        : [{ title: copy.summary, items: summary || [], isNews: false }];

    return (
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800">
            <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">{copy.title}</h2>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{copy.subtitle}</p>
                </div>
                {takeaways && (
                    <div className="shrink-0 text-right text-xs text-gray-400 dark:text-gray-500">
                        {takeaways.market_session_date && (
                            <p>
                                HOSE · {isEnglish ? 'Session' : 'Phiên'}{' '}
                                {new Date(`${takeaways.market_session_date}T12:00:00+07:00`).toLocaleDateString(translations[lang].overview.locale, { timeZone: 'Asia/Ho_Chi_Minh' })}
                            </p>
                        )}
                        <p>
                            {isEnglish ? 'Updated' : 'Cập nhật'}{' '}
                            {new Date(takeaways.generated_at).toLocaleTimeString(translations[lang].overview.locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' })}
                        </p>
                    </div>
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
                                {takeaways.available ? 'AI' : (isEnglish ? 'Summary' : 'Tổng hợp')}
                            </span>
                        </div>
                        <div className="space-y-3">
                            {sections.map(section => (
                                <div key={section.title}>
                                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">{section.title}</p>
                                    <div className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-900">
                                        {section.items.slice(0, 3).map((item, index) => {
                                            const source = section.isNews ? takeaways.news_sources?.[index] : undefined;
                                            const title = !isEnglish && source?.title
                                                ? source.title
                                                : item.split(/(?<=[.!?])\s/)[0];
                                            if (!section.isNews) {
                                                return <p key={item} className="px-3 py-2.5 text-sm text-gray-600 dark:text-gray-300">{item}</p>;
                                            }
                                            return (
                                                <details key={`${section.title}-${index}-${item}`} className="group">
                                                    <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-3 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-blue-500 dark:text-gray-100 dark:hover:bg-gray-800 [&::-webkit-details-marker]:hidden">
                                                        <span className="line-clamp-2 group-open:line-clamp-none">{title}</span>
                                                        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180">
                                                            <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                        </svg>
                                                    </summary>
                                                    <div className="px-3 pb-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                                                        <p>{item}</p>
                                                    </div>
                                                </details>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <NewsSourceLogos sources={takeaways.recent_news?.length ? takeaways.recent_news : takeaways.news_sources} label={isEnglish ? 'Sources' : 'Nguồn'} />

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
                                        href={localizedPath(`/stock/${item.symbol}`, lang)}
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
