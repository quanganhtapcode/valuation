import React from 'react';
import styles from '../../app/stock/[symbol]/page.module.css';
import TradingViewChart from './TradingViewChart';

function formatRelativeTime(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr.slice(0, 10);
    const diff = Math.floor((Date.now() - date.getTime()) / 86400000);
    if (diff === 0) return 'Hôm nay';
    if (diff === 1) return 'Hôm qua';
    if (diff < 7) return `${diff} ngày trước`;
    return date.toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric', year: 'numeric' });
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

interface EpsHistoryItem {
    year: number;
    eps: number;
}

interface OverviewTabProps {
    symbol: string;
    stockInfo: StockInfo | null;
    priceData: PriceData | null;
    financials: FinancialData | null;
    historicalData: HistoricalData[];
    isDescExpanded: boolean;
    setIsDescExpanded: (v: boolean) => void;
    isLoading: boolean;
    news?: NewsItem[];
    epsHistory?: EpsHistoryItem[];
}

export default function OverviewTab({
    stockInfo,
    financials,
    historicalData,
    isDescExpanded,
    setIsDescExpanded,
    isLoading,
    news = [],
    epsHistory = [],
}: OverviewTabProps) {
    return (
        <div className={styles.mainContent}>
            {/* Left Column */}
            <div className={styles.leftColumn}>
                {/* Price Chart */}
                <section className={`${styles.section} ${styles.sectionChart} mt-2 sm:mt-0`}>
                    <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                            Biểu đồ giá
                        </h3>
                    </div>
                    <div>
                        <TradingViewChart
                            data={historicalData}
                            isLoading={isLoading}
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
                                                    <span className={styles.newsDate}>{formatRelativeTime(date)}</span>
                                                )}
                                            </div>
                                        </div>
                                    </a>
                                );
                            })}
                        </div>
                    </section>
                )}

            </div>

            {/* Right Column */}
            <aside className={styles.rightColumn}>
                {/* Company Info */}
                <section className={`${styles.section} ${styles.sectionCompanyInfo}`}>
                    <div className="flex flex-col gap-5">
                        <div className="flex flex-col gap-1.5">
                            <span className="text-[11px] uppercase tracking-wider font-semibold text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                                Full Name
                            </span>
                            <span className="text-[15px] font-medium leading-relaxed text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis">
                                {stockInfo?.companyName}
                            </span>
                        </div>
                        <div className="grid grid-cols-2 gap-6 pt-2 border-t border-gray-50 dark:border-gray-800/50">
                            <div className="flex flex-col gap-1.5">
                                <span className="text-[11px] uppercase tracking-wider font-semibold text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                                    Exchange
                                </span>
                                <span className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                    {stockInfo?.exchange}
                                </span>
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <span className="text-[11px] uppercase tracking-wider font-semibold text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                                    Sector
                                </span>
                                <span className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                    {stockInfo?.sector}
                                </span>
                            </div>
                        </div>

                        {/* Description - Seamlessly follows */}
                        <div className="flex flex-col gap-1.5 pt-2 border-t border-gray-50 dark:border-gray-800/50">
                            <span className="text-[11px] uppercase tracking-wider font-semibold text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                                Introduction
                            </span>
                            <div className="text-[13px] leading-relaxed text-tremor-content-emphasis dark:text-dark-tremor-content-emphasis text-justify">
                                {stockInfo?.overview?.description
                                    ? (isDescExpanded
                                        ? stockInfo.overview.description
                                        : (stockInfo.overview.description.length > 300
                                            ? stockInfo.overview.description.slice(0, 300) + '...'
                                            : stockInfo.overview.description))
                                    : "No detailed description available for this company."
                                }
                            </div>
                            {stockInfo?.overview?.description && stockInfo.overview.description.length > 300 && (
                                <button
                                    onClick={() => setIsDescExpanded(!isDescExpanded)}
                                    className="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-500 dark:hover:text-blue-400 self-start mt-1 transition-colors focus:outline-none"
                                >
                                    {isDescExpanded ? 'Show less' : 'Read more'}
                                </button>
                            )}
                        </div>
                    </div>
                </section>

                {/* Key Metrics - Matching Reference Design */}
                {financials && (
                    <section className={`${styles.section} ${styles.sectionMetrics}`}>
                        <div className={styles.metricsGrid} style={{ gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            {/* P/E TTM */}
                            <div className={styles.metricCard}>
                                <span className={styles.metricLabel}>P/E TTM:</span>
                                <span className={styles.metricValue}>
                                    {financials.pe !== undefined && financials.pe !== null && financials.pe > 0 ? financials.pe.toFixed(2) : '-'}
                                </span>
                            </div>

                            {/* P/B TTM */}
                            <div className={styles.metricCard}>
                                <span className={styles.metricLabel}>P/B TTM:</span>
                                <span className={styles.metricValue}>
                                    {financials.pb !== undefined && financials.pb !== null && financials.pb > 0 ? financials.pb.toFixed(2) : '-'}
                                </span>
                            </div>

                            {/* ROE */}
                            <div className={styles.metricCard}>
                                <span className={styles.metricLabel}>ROE (%):</span>
                                <span className={styles.metricValue}>
                                    {financials.roe !== undefined && financials.roe !== 0
                                        ? `${(Math.abs(financials.roe) < 1 ? financials.roe * 100 : financials.roe).toFixed(1)}%`
                                        : '-'}
                                </span>
                            </div>

                            {/* ROA */}
                            <div className={styles.metricCard}>
                                <span className={styles.metricLabel}>ROA (%):</span>
                                <span className={styles.metricValue}>
                                    {financials.roa !== undefined && financials.roa !== 0
                                        ? `${(Math.abs(financials.roa) < 1 ? financials.roa * 100 : financials.roa).toFixed(1)}%`
                                        : '-'}
                                </span>
                            </div>

                            {/* Net Margin */}
                            <div className={styles.metricCard}>
                                <span className={styles.metricLabel}>NET MARGIN (%):</span>
                                <span className={styles.metricValue}>
                                    {financials.netProfitMargin !== undefined && financials.netProfitMargin !== 0
                                        ? `${(Math.abs(financials.netProfitMargin) < 1 ? financials.netProfitMargin * 100 : financials.netProfitMargin).toFixed(1)}%`
                                        : '-'}
                                </span>
                            </div>

                            {/* Gross Margin */}
                            <div className={styles.metricCard}>
                                <span className={styles.metricLabel}>GROSS MARGIN (%):</span>
                                <span className={styles.metricValue}>
                                    {financials.grossMargin !== undefined && financials.grossMargin !== 0
                                        ? `${(Math.abs(financials.grossMargin) < 1 ? financials.grossMargin * 100 : financials.grossMargin).toFixed(1)}%`
                                        : '-'}
                                </span>
                            </div>

                            {/* Debt/Equity */}
                            <div className={styles.metricCard}>
                                <span className={styles.metricLabel}>DEBT/EQUITY:</span>
                                <span className={styles.metricValue}>
                                    {financials.debtToEquity !== undefined && financials.debtToEquity !== 0
                                        ? financials.debtToEquity.toFixed(2)
                                        : '-'}
                                </span>
                            </div>

                            {/* Current Ratio */}
                            <div className={styles.metricCard}>
                                <span className={styles.metricLabel}>CURRENT RATIO:</span>
                                <span className={styles.metricValue}>
                                    {financials.currentRatio !== undefined && financials.currentRatio !== 0
                                        ? financials.currentRatio.toFixed(2)
                                        : '-'}
                                </span>
                            </div>
                        </div>
                        <p className="text-[11px] text-tremor-content-subtle dark:text-dark-tremor-content-subtle mt-3 italic text-center">
                            * Data from VCI Stats Financial (TTM)
                        </p>
                    </section>
                )}

                {/* EPS History Section */}
                {epsHistory && epsHistory.length >= 2 && (() => {
                    const epsMaxVal = Math.max(...epsHistory.map(h => Math.abs(h.eps)), 1);
                    const hasNegative = epsHistory.some(h => h.eps < 0);
                    const barMax = Math.ceil(epsMaxVal / 1000) * 1000;

                    return (
                        <section className={`${styles.section} ${styles.sectionEpsHistory}`}>
                            <div className={styles.sectionHeader}>
                                <h3 className="text-tremor-title font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                    EPS History
                                </h3>
                            </div>
                            <div className="flex items-end gap-2 h-40 px-2">
                                {epsHistory.map((h, i) => {
                                    const isPositive = h.eps >= 0;
                                    const barHeight = hasNegative
                                        ? (Math.abs(h.eps) / barMax) * 45
                                        : (h.eps / barMax) * 100;
                                    const clampedHeight = Math.max(barHeight, 4);

                                    return (
                                        <div key={i} className="flex flex-col items-center flex-1 gap-1">
                                            <span className="text-[10px] font-medium text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                                {Math.round(h.eps).toLocaleString('vi-VN')}
                                            </span>
                                            <div className="w-full flex items-end justify-center" style={{ height: '120px' }}>
                                                <div
                                                    className="w-3/4 rounded-t-sm transition-all duration-300"
                                                    style={{
                                                        height: `${clampedHeight}%`,
                                                        minHeight: '4px',
                                                        backgroundColor: isPositive ? '#10b981' : '#ef4444',
                                                    }}
                                                    title={`${h.year}: ${Math.round(h.eps).toLocaleString('vi-VN')} ₫`}
                                                />
                                            </div>
                                            <span className="text-[10px] text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                                                {h.year}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="mt-2 flex items-center justify-between text-[10px] text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                                <span>Cao nhất: <span className="font-semibold">{Math.round(Math.max(...epsHistory.map(h => h.eps))).toLocaleString('vi-VN')} ₫</span></span>
                                <span>Gần nhất: <span className="font-semibold">{Math.round(epsHistory[epsHistory.length - 1].eps).toLocaleString('vi-VN')} ₫</span></span>
                            </div>
                        </section>
                    );
                })()}
            </aside>
        </div>
    );
}
