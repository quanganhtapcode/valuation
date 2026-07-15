import React, { useEffect, useState } from 'react';
import styles from '../../app/stock/[symbol]/page.module.css';
import TradingViewChart from './TradingViewChart';
import OrderBook from './OrderBook';
import BankLoanBreakdown from './BankLoanBreakdown';
import AiInsightCard from './AiInsightCard';
import FinancialMetricsPanel from './FinancialMetricsPanel';
import { fetchAiAnalysis } from '@/lib/api';
import { useLanguage } from "@/lib/languageContext"
import { translations } from "@/lib/translations"

function formatRelativeTime(dateStr: string, tOv: typeof translations.vi.overview): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr.slice(0, 10);
    const diff = Math.floor((Date.now() - date.getTime()) / 86400000);
    if (diff === 0) return tOv.today;
    if (diff === 1) return tOv.yesterday;
    if (diff < 7) return tOv.daysAgo(diff);
    return date.toLocaleDateString(tOv.locale, { day: 'numeric', month: 'numeric', year: 'numeric' });
}

// Source logo mapping
const SOURCE_LOGOS: Record<string, string> = {
    'fireant': 'https://fireant.vn/images/favicon/favicon-32x32.png',
    'vietstock': 'https://vietstock.vn/favicon.ico',
    'cafef': 'https://cafef.vn/favicon.ico',
    'tinnhanhchungkhoan': 'https://www.tinnhanhchungkhoan.vn/favicon.ico',
    'nguoiquansat': 'https://nguoiquansat.vn/favicon.ico',
    'người quan sát': 'https://nguoiquansat.vn/favicon.ico',
    'ndh': 'https://ndh.vn/favicon.ico',
    'vnexpress': 'https://vnexpress.net/favicon.ico',
    'dantri': 'https://dantri.com.vn/favicon.ico',
    'vietnamnet': 'https://vietnamnet.vn/favicon.ico',
    'thanhnien': 'https://thanhnien.vn/favicon.ico',
    'tuoitre': 'https://tuoitre.vn/favicon.ico',
    'vneconomy': 'https://vneconomy.vn/favicon.ico',
    'vietcap': 'https://vietcap.com.vn/favicon.ico',
    'ssi': 'https://www.ssi.com.vn/favicon.ico',
    'hsc': 'https://www.hsc.com.vn/favicon.ico',
    'mbs': 'https://www.mbs.com.vn/favicon.ico',
    'vps': 'https://www.vps.com.vn/favicon.ico',
    'tcbs': 'https://www.tcbs.com.vn/favicon.ico',
};

function SourceBadge({ source }: { source: string }) {
    const key = source.toLowerCase().trim();
    const logoUrl = SOURCE_LOGOS[key];
    if (!logoUrl) return <span className={styles.newsSourceText}>{source}</span>;
    return (
        <span className={styles.newsSource}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={logoUrl}
                alt={source}
                className={styles.newsSourceLogo}
                onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                }}
            />
            <span className={styles.newsSourceText}>{source}</span>
        </span>
    );
}

interface StockInfo {
    symbol: string;
    companyName: string;
    sector: string;
    exchange: string;
    overview?: {
        established?: string;
        listedDate?: string;
        employees?: number;
        website?: string;
        description?: string;
    };
}

interface PriceData {
    price: number;
    change: number;
    changePercent: number;
    open: number;
    high: number;
    low: number;
    volume: number;
    value: number;
    ceiling: number;
    floor: number;
    ref: number;
    avgPrice?: number;
    orderbook?: {
        bid: Array<{ price: number; volume: number }>;
        ask: Array<{ price: number; volume: number }>;
    };
}

interface FinancialData {
    eps?: number;
    pe?: number;
    pb?: number;
    roe?: number;
    roa?: number;
    marketCap?: number;
    bookValue?: number;
    dividend?: number;
    sharesOutstanding?: number;
    netProfitMargin?: number;
    grossMargin?: number;
    debtToEquity?: number;
    currentRatio?: number;
}

interface HistoricalData {
    time: string | number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

interface NewsItem {
    id?: string;
    title?: string;
    Title?: string;
    url?: string;
    Link?: string;
    news_source_link?: string;
    image_url?: string;
    ImageThumb?: string;
    news_image_url?: string;
    update_date?: string;
    PublishDate?: string;
    publish_date?: string;
    source?: string;
    Source?: string;
    news_from_name?: string;
    sentiment?: string;
    Sentiment?: string;
    score?: number;
    Score?: number;
    ticker?: string;
    Symbol?: string;
}

interface OverviewTabProps {
    symbol: string;
    stockInfo: StockInfo | null;
    priceData: PriceData | null;
    financials: FinancialData | null;
    targetPrice?: number | null;
    historicalData: HistoricalData[];
    isDescExpanded: boolean;
    setIsDescExpanded: (v: boolean) => void;
    isLoading: boolean;
    news?: NewsItem[];
    isBank?: boolean;
}

export default function OverviewTab({
    symbol: _symbol,
    stockInfo,
    priceData,
    financials,
    targetPrice,
    historicalData,
    isDescExpanded,
    setIsDescExpanded,
    isLoading,
    news = [],
    isBank = false,
}: OverviewTabProps) {
    const { lang } = useLanguage()
    const tOv = translations[lang].overview

    const [aiData, setAiData] = useState<Awaited<ReturnType<typeof fetchAiAnalysis>> | null>(null);
    useEffect(() => {
        fetchAiAnalysis(_symbol).then(d => setAiData(d.available ? d : null));
    }, [_symbol]);

    return (
        <div className={styles.mainContent}>
            {/* Left Column */}
            <div className={styles.leftColumn}>
                {/* Price Chart */}
                <section className={`${styles.section} ${styles.sectionChart} mt-2 sm:mt-0`}>
                    <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-base font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                            {tOv.priceChart}
                        </h3>
                    </div>

                    <div>
                        <TradingViewChart
                            data={historicalData}
                            isLoading={isLoading}
                        />
                    </div>

                    {/* Order book */}
                    <div className="mt-3">
                        <OrderBook
                            orderbook={priceData?.orderbook}
                            refPrice={priceData?.ref ?? 0}
                            ceiling={priceData?.ceiling ?? 0}
                            floor={priceData?.floor ?? 0}
                        />
                    </div>
                </section>

                {/* News Section */}
                {news && news.length > 0 && (
                    <section className={`${styles.section} ${styles.sectionNews}`}>
                        <div className={styles.sectionHeader}>
                            <h3 className="text-tremor-title font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                Tin tức
                            </h3>
                        </div>
                        <div className={styles.newsGrid}>
                            {news.slice(0, 6).map((item, index) => {
                                const title = item.title || item.Title || '';
                                const url = item.url || item.Link || item.news_source_link || '#';
                                const imageUrl = item.image_url || item.ImageThumb || item.news_image_url || '';
                                const date = item.update_date || item.PublishDate || item.publish_date || '';
                                const source = item.source || item.Source || item.news_from_name || '';
                                const sentiment = (item.sentiment || item.Sentiment || '').toLowerCase();
                                const sentimentColor = sentiment === 'positive' ? 'text-emerald-600 dark:text-emerald-400'
                                    : sentiment === 'negative' ? 'text-rose-600 dark:text-rose-400'
                                    : 'text-gray-400 dark:text-gray-500';
                                const sentimentDot = sentiment === 'positive' ? '▲' : sentiment === 'negative' ? '▼' : '●';

                                return (
                                    <a
                                        key={item.id || index}
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={styles.newsCard}
                                    >
                                        {imageUrl && (
                                            <div className={styles.newsImageWrapper}>
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img
                                                    src={imageUrl}
                                                    alt={title}
                                                    className={styles.newsImage}
                                                    onError={(e) => {
                                                        const target = e.target as HTMLImageElement;
                                                        target.style.display = 'none';
                                                    }}
                                                />
                                            </div>
                                        )}
                                        <div className={styles.newsContent}>
                                            <h4 className={styles.newsCardTitle}>{title}</h4>
                                            <div className={styles.newsCardMeta}>
                                                {source && <SourceBadge source={source} />}
                                                {date && (
                                                    <span className={styles.newsDate}>{formatRelativeTime(date, tOv)}</span>
                                                )}
                                                {sentiment && (
                                                    <span className={sentimentColor}>{sentimentDot}</span>
                                                )}
                                            </div>
                                        </div>
                                    </a>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* Bank loan breakdown — only for bank stocks */}
                {isBank && (
                    <section className={`${styles.section} ${styles.sectionBankLoan}`}>
                        <BankLoanBreakdown symbol={_symbol} />
                    </section>
                )}

            </div>

            {/* Right Column */}
            <aside className={styles.rightColumn}>
                <div className={styles.sectionAiInsight}>
                    <AiInsightCard
                        symbol={_symbol}
                        analysisJson={aiData?.analysis_json}
                        newsJson={aiData?.news_json}
                        quarter={aiData?.quarter}
                        generatedAt={aiData?.generated_at}
                    />
                </div>

                {financials && (
                    <FinancialMetricsPanel
                        financials={financials}
                        price={priceData?.price}
                        targetPrice={targetPrice}
                        companyDescription={stockInfo?.overview?.description}
                        companyMeta={`${stockInfo?.exchange || '—'} · ${stockInfo?.sector || '—'}`}
                        isDescriptionExpanded={isDescExpanded}
                        onDescriptionExpandedChange={setIsDescExpanded}
                    />
                )}

            </aside>
        </div>
    );
}
