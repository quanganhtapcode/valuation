'use client';

import { useEffect, useState } from 'react';
import { fetchMarketTakeaways, MarketTakeawaysData } from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/translations';
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
    const news = (isEnglish ? takeaways?.news_summary : takeaways?.news_summary_vi) || [];

    return (
        <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800">
            <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-gray-900 dark:text-gray-50">Market Summary</h2>
                {takeaways && (
                    <p className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                        {isEnglish ? 'Updated' : 'Cập nhật'}{' '}
                        {new Date(takeaways.generated_at).toLocaleTimeString(translations[lang].overview.locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' })}
                    </p>
                )}
            </div>
            {loading ? <Skeleton /> : !takeaways || !news.length ? (
                <p className="text-sm text-gray-400 dark:text-gray-500">{copy.waiting}</p>
            ) : (
                <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                        {news.slice(0, 5).map((item, index) => {
                            const source = takeaways.news_sources?.[index];
                            const title = (isEnglish ? source?.title_en : source?.title_vi)
                                || source?.title || (isEnglish ? `News update ${index + 1}` : `Tin nổi bật ${index + 1}`);
                            return (
                                <details key={source?.url || `${index}-${item}`} className="group">
                                    <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-blue-500 dark:text-gray-100 dark:hover:bg-gray-800 [&::-webkit-details-marker]:hidden">
                                        <span>{title}</span>
                                        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180">
                                            <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    </summary>
                                    <p className="px-4 pb-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{item}</p>
                                </details>
                            );
                        })}
                    </div>
                    <div className="px-4 pt-3">
                        <NewsSourceLogos sources={takeaways.recent_news?.length ? takeaways.recent_news : takeaways.news_sources} label={isEnglish ? 'Sources' : 'Nguồn'} />
                    </div>
                </div>
            )}
        </section>
    );
}
