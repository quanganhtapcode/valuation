'use client';

import { useCallback, useState } from 'react';
import Image from 'next/image';
import { Card } from '@tremor/react';
import { siteConfig } from '@/config/siteConfig';
import { fetchMarketTakeaways, MarketTakeawaysData } from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/translations';
import { useVisiblePolling } from '@/hooks/useVisiblePolling';
import NewsSourceLogos from './NewsSourceLogos';

const refreshDelay = () => 60_000;

function CompanyLogo({ symbol }: { symbol: string }) {
    const [failed, setFailed] = useState(false);

    return (
        <span title={symbol} className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white dark:bg-gray-800">
            {failed ? (
                <span className="text-[10px] font-semibold text-gray-600">{symbol}</span>
            ) : (
                <Image
                    src={siteConfig.stockLogoUrl(symbol)}
                    alt={symbol}
                    width={36}
                    height={36}
                    unoptimized
                    className="h-full w-full object-contain p-1"
                    onError={() => setFailed(true)}
                />
            )}
        </span>
    );
}

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

    const refresh = useCallback(async () => {
        try {
            const data = await fetchMarketTakeaways();
            if (data) setTakeaways(data);
        } finally {
            setLoading(false);
        }
    }, []);
    useVisiblePolling(refresh, refreshDelay);

    const isEnglish = lang === 'en';
    const copy = translations[lang].dashboard.aiTakeaways;
    const news = (isEnglish ? takeaways?.news_summary : takeaways?.news_summary_vi) || [];

    return (
        <Card className="p-0 overflow-hidden border-tremor-border dark:border-dark-tremor-border shadow-sm">
            <div className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-3">
                <h2 className="text-base font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">{copy.summary}</h2>
                {takeaways && (
                    <p className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                        {takeaways.stale || takeaways.news_stale ? (isEnglish ? 'Last available' : 'Dữ liệu gần nhất') : (isEnglish ? 'Updated' : 'Cập nhật')}{' '}
                        {new Date(takeaways.news_generated_at || takeaways.generated_at).toLocaleString(translations[lang].overview.locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' })}
                    </p>
                )}
            </div>
            {loading ? <div className="px-4 pb-4"><Skeleton /></div> : !takeaways || !news.length ? (
                <p className="px-4 pb-4 text-sm text-gray-400 dark:text-gray-500">{copy.waiting}</p>
            ) : (
                <div className="overflow-hidden">
                    <div className="divide-y divide-tremor-border dark:divide-dark-tremor-border">
                        {news.slice(0, 5).map((item, index) => {
                            const source = takeaways.news_sources?.[index];
                            const rawSymbol = source?.symbol || takeaways.recent_news?.find(article => article.url === source?.url)?.symbol;
                            const symbol = rawSymbol?.trim().toUpperCase();
                            const title = (isEnglish ? source?.title_en : source?.title_vi)
                                || (!isEnglish ? source?.title : undefined)
                                || (isEnglish ? `News update ${index + 1}` : `Tin nổi bật ${index + 1}`);
                            const detail = item.trim().toLocaleLowerCase() === title.trim().toLocaleLowerCase()
                                ? (isEnglish ? 'Read the original article for details.' : 'Xem bài gốc để đọc chi tiết.')
                                : item;
                            return (
                                <details key={source?.url || `${index}-${item}`} className="group">
                                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-blue-500 dark:text-gray-100 dark:hover:bg-gray-800 [&::-webkit-details-marker]:hidden">
                                        {symbol && /^[A-Z0-9]{3,10}$/.test(symbol) && <CompanyLogo key={symbol} symbol={symbol} />}
                                        <span className="min-w-0 flex-1">{title}</span>
                                        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180">
                                            <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    </summary>
                                    <p className="px-4 pb-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{detail}</p>
                                    {source?.url && (
                                        <a href={source.url} target="_blank" rel="noopener noreferrer" className="mx-4 mb-3 inline-flex text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
                                            {isEnglish ? 'Read original article' : 'Đọc bài gốc'} ↗
                                        </a>
                                    )}
                                </details>
                            );
                        })}
                    </div>
                    <div className="px-4 py-3">
                        <NewsSourceLogos sources={takeaways.recent_news?.length ? takeaways.recent_news : takeaways.news_sources} label={isEnglish ? 'Sources' : 'Nguồn'} />
                    </div>
                </div>
            )}
        </Card>
    );
}
