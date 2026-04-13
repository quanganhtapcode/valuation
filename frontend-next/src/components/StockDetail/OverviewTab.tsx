import React, { useMemo } from 'react';
import { formatNumber } from '@/lib/api';
import styles from '../../app/stock/[symbol]/page.module.css';
import { BarChart, LineChart } from '@tremor/react';

function classNames(...classes: Array<string | false | undefined | null>) {
    return classes.filter(Boolean).join(' ');
}

function formatDateRange(_days: number) {
    return ''; // Return empty initially, tooltips are secondary
}

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
    profitGrowth?: number;
    debtToEquity?: number;
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
    timeRange: '3M' | '6M' | '1Y' | '3Y' | '5Y';
    setTimeRange: (range: '3M' | '6M' | '1Y' | '3Y' | '5Y') => void;
    isDescExpanded: boolean;
    setIsDescExpanded: (v: boolean) => void;
    isLoading: boolean;
    news?: NewsItem[];
    epsHistory?: EpsHistoryItem[];
}

export default function OverviewTab({
    symbol: _symbol,
    stockInfo,
    priceData,
    financials,
    historicalData,
    timeRange,
    setTimeRange,
    isDescExpanded,
    setIsDescExpanded,
    isLoading,
    news = [],
    epsHistory = [],
}: OverviewTabProps) {
    console.log('[OverviewTab] Props - news:', news?.length, 'items, epsHistory:', epsHistory?.length, 'items');
    // Prepare chart data for Tremor
    const chartData = useMemo(() => {
        if (!historicalData || historicalData.length === 0) return [];

        return historicalData.map((d, i) => {
            const date = new Date(d.time);
            const day   = date.getDate().toString().padStart(2, '0');
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const year  = date.getFullYear().toString().slice(-2);

            // Determine volume color based on price change
            const prevClose = i > 0 ? historicalData[i - 1].close : d.open;
            const isUp = d.close >= prevClose;

            return {
                date: `${day}/${month}/${year}`,
                Price: d.close,
                Volume: d.volume,
                volumeColor: isUp ? '#10b981' : '#ef4444',
            };
        });
    }, [historicalData]);

    const valueFormatter = (number: number) =>
        `${Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(number)}`;

    const filterButtons = [
        { key: '3M' as const, label: '3M', tooltip: formatDateRange(90) },
        { key: '6M' as const, label: '6M', tooltip: formatDateRange(180) },
        { key: '1Y' as const, label: '1Y', tooltip: formatDateRange(365) },
        { key: '3Y' as const, label: '3Y', tooltip: formatDateRange(1095) },
        { key: '5Y' as const, label: '5Y', tooltip: formatDateRange(1825) },
    ];


    const stats52w = useMemo(() => {
        if (!historicalData || historicalData.length === 0) {
            return {
                high52w: null as number | null,
                low52w: null as number | null,
                avgVol52w: null as number | null,
            };
        }

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 365);

        const last52w = historicalData.filter((d) => new Date(d.time).getTime() >= cutoff.getTime());
        if (last52w.length === 0) {
            return {
                high52w: null as number | null,
                low52w: null as number | null,
                avgVol52w: null as number | null,
            };
        }

        const highs = last52w.map((d) => d.high).filter((v) => !Number.isNaN(v));
        const lows = last52w.map((d) => d.low).filter((v) => !Number.isNaN(v));
        const vols = last52w.map((d) => d.volume).filter((v) => !Number.isNaN(v));

        const high52w = highs.length ? Math.max(...highs) : null;
        const low52w = lows.length ? Math.min(...lows) : null;
        const avgVol52w = vols.length ? Math.round(vols.reduce((a, b) => a + b, 0) / vols.length) : null;

        return { high52w, low52w, avgVol52w };
    }, [historicalData]);

    // Get today's stats from the latest entry in historicalData (more reliable than API)
    const todayStats = useMemo(() => {
        if (!historicalData || historicalData.length === 0) {
            return {
                open: priceData?.open || 0,
                high: priceData?.high || 0,
                low: priceData?.low || 0,
            };
        }
        const latest = historicalData[historicalData.length - 1];
        return {
            open: latest.open || priceData?.open || 0,
            high: latest.high || priceData?.high || 0,
            low: latest.low || priceData?.low || 0,
        };
    }, [historicalData, priceData]);

    const priceRange = useMemo(() => {
        const prices = chartData.map((d) => Number(d.Price)).filter((v) => !Number.isNaN(v));
        if (prices.length === 0) return { min: 0, max: 0 };
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const padding = (max - min) * 0.05;
        const rawMin = min - padding;
        const rawMax = max + padding;
        const step = 1000;
        return {
            min: Math.floor(rawMin / step) * step,
            max: Math.ceil(rawMax / step) * step,
        };
    }, [chartData]);

    return (
        <div className={styles.mainContent}>
            {/* Left Column */}
            <div className={styles.leftColumn}>
                {/* Price Chart */}
                <section className={`${styles.section} ${styles.sectionChart} mt-2 sm:mt-0`}>
                    <div className={styles.sectionHeader}>
                        <div className="hidden items-center rounded-tremor-small text-tremor-default font-medium shadow-tremor-input dark:shadow-dark-tremor-input sm:inline-flex">
                            {filterButtons.map((item, index) => (
                                <button
                                    key={item.key}
                                    type="button"
                                    title={item.tooltip}
                                    onClick={() => setTimeRange(item.key)}
                                    className={classNames(
                                        index === 0 ? 'rounded-l-tremor-small' : '-ml-px',
                                        index === filterButtons.length - 1 ? 'rounded-r-tremor-small' : '',
                                        'border border-tremor-border bg-tremor-background px-4 py-2 text-tremor-content-strong hover:bg-tremor-background-muted hover:text-tremor-content-strong focus:z-10 focus:outline-none dark:border-dark-tremor-border dark:bg-gray-950 dark:text-dark-tremor-content-strong hover:dark:bg-gray-950/50',
                                        timeRange === item.key && 'bg-tremor-brand-muted text-tremor-brand dark:bg-dark-tremor-brand-muted dark:text-dark-tremor-brand'
                                    )}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                        {/* Mobile Filter Buttons */}
                        <div className="flex w-full items-center justify-between rounded-tremor-small text-tremor-default font-medium shadow-tremor-input dark:shadow-dark-tremor-input sm:hidden mt-2">
                            {filterButtons.map((item, index) => (
                                <button
                                    key={item.key}
                                    type="button"
                                    title={item.tooltip}
                                    onClick={() => setTimeRange(item.key)}
                                    className={classNames(
                                        index === 0 ? 'rounded-l-tremor-small' : '-ml-px',
                                        index === filterButtons.length - 1 ? 'rounded-r-tremor-small' : '',
                                        'flex-1 border border-tremor-border bg-tremor-background py-2 text-center text-tremor-content-strong hover:bg-tremor-background-muted hover:text-tremor-content-strong focus:z-10 focus:outline-none dark:border-dark-tremor-border dark:bg-gray-950 dark:text-dark-tremor-content-strong hover:dark:bg-gray-950/50',
                                        timeRange === item.key && 'bg-tremor-brand-muted text-tremor-brand dark:bg-dark-tremor-brand-muted dark:text-dark-tremor-brand'
                                    )}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="mt-6 grid grid-cols-1 gap-6">
                        <div className="">
                            {isLoading && (
                                <div className="flex h-80 items-center justify-center">
                                    <div className="spinner" />
                                </div>
                            )}
                            {!isLoading && chartData.length > 0 && (
                                <>
                                    <LineChart
                                        data={chartData}
                                        index="date"
                                        categories={["Price"]}
                                        colors={["blue"]}
                                        valueFormatter={valueFormatter}
                                        yAxisWidth={70}
                                        showLegend={false}
                                        minValue={priceRange.min}
                                        maxValue={priceRange.max}
                                        showXAxis={false}
                                        showTooltip={true}
                                        className="hidden h-72 sm:block"
                                    />
                                    <LineChart
                                        data={chartData}
                                        index="date"
                                        categories={["Price"]}
                                        colors={["blue"]}
                                        valueFormatter={valueFormatter}
                                        showYAxis={false}
                                        showLegend={false}
                                        startEndOnly={false}
                                        minValue={priceRange.min}
                                        maxValue={priceRange.max}
                                        showXAxis={false}
                                        showTooltip={true}
                                        className="h-72 sm:hidden"
                                    />
                                    <div className="mt-3">
                                        <BarChart
                                            data={chartData}
                                            index="date"
                                            categories={["Volume"]}
                                            colors={["emerald"]}
                                            valueFormatter={(value) => Intl.NumberFormat('en-US').format(value)}
                                            showLegend={false}
                                            showYAxis={false}
                                            startEndOnly={false}
                                            showXAxis={true}
                                            className="h-16"
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                        {priceData && (
                            <div className="">
                                <div className="grid grid-cols-3 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                                    {[
                                        { name: '52W High', value: stats52w.high52w !== null ? formatNumber(stats52w.high52w, { maximumFractionDigits: 0 }) : '-', bgColor: 'bg-blue-500' },
                                        { name: '52W Low', value: stats52w.low52w !== null ? formatNumber(stats52w.low52w, { maximumFractionDigits: 0 }) : '-', bgColor: 'bg-violet-500' },
                                        { name: 'Today Open', value: todayStats.open > 0 ? formatNumber(todayStats.open, { maximumFractionDigits: 0 }) : '-', bgColor: 'bg-fuchsia-500' },
                                        { name: 'Today High', value: todayStats.high > 0 ? formatNumber(todayStats.high, { maximumFractionDigits: 0 }) : '-', bgColor: 'bg-amber-500' },
                                        { name: 'Today Low', value: todayStats.low > 0 ? formatNumber(todayStats.low, { maximumFractionDigits: 0 }) : '-', bgColor: 'bg-cyan-500' },
                                        { name: 'Avg 52W Vol', value: stats52w.avgVol52w !== null ? formatNumber(stats52w.avgVol52w) : '-', bgColor: 'bg-emerald-500' },
                                    ].map((item) => (
                                        <div key={item.name} className="flex items-center gap-3">
                                            <span className={classNames(item.bgColor, 'h-8 w-1 shrink-0 rounded')} aria-hidden={true} />
                                            <div className="min-w-0">
                                                <p className="text-tremor-default text-tremor-content dark:text-dark-tremor-content">
                                                    {item.name}
                                                </p>
                                                <p className="truncate font-medium text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                                    {item.value}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
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
                                const sentiment = item.sentiment || item.Sentiment || '';
                                const score = item.score ?? item.Score;

                                // Determine sentiment class
                                const sentLower = sentiment.toLowerCase();
                                let badgeClass = styles.sentimentNeutral;
                                let badgeText = sentiment;
                                if (sentLower.includes('pos') || (typeof score === 'number' && score > 0)) {
                                    badgeClass = styles.sentimentPositive;
                                    badgeText = score != null ? `${sentiment} (${score})` : sentiment;
                                } else if (sentLower.includes('neg') || (typeof score === 'number' && score < 0)) {
                                    badgeClass = styles.sentimentNegative;
                                    badgeText = score != null ? `${sentiment} (${score})` : sentiment;
                                } else if (typeof score === 'number' && score === 0) {
                                    badgeText = `Neutral (${score})`;
                                }

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
                                            {sentiment && (
                                                <div className={styles.newsSentiment}>
                                                    <span className={`${styles.sentimentBadge} ${badgeClass}`}>
                                                        {badgeText}
                                                    </span>
                                                </div>
                                            )}
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

                            {/* EPS */}
                            <div className={styles.metricCard}>
                                <span className={styles.metricLabel}>EPS:</span>
                                <span className={styles.metricValue}>
                                    {financials.eps !== undefined ? `${formatNumber(financials.eps, { maximumFractionDigits: 0 })} đ` : '-'}
                                </span>
                            </div>

                            {/* Net Profit Margin */}
                            <div className={styles.metricCard}>
                                <span className={styles.metricLabel}>NET PROFIT MARGIN:</span>
                                <span className={styles.metricValue}>
                                    {financials.netProfitMargin !== undefined
                                        ? `${financials.netProfitMargin.toFixed(1)}%`
                                        : '-'}
                                </span>
                            </div>

                            {/* ROE */}
                            <div className={styles.metricCard}>
                                <span className={styles.metricLabel}>ROE (%):</span>
                                <span className={styles.metricValue}>
                                    {financials.roe !== undefined ? `${financials.roe.toFixed(1)}%` : '-'}
                                </span>
                            </div>

                            {/* ROA */}
                            <div className={styles.metricCard}>
                                <span className={styles.metricLabel}>ROA (%):</span>
                                <span className={styles.metricValue}>
                                    {financials.roa !== undefined ? `${financials.roa.toFixed(1)}%` : '-'}
                                </span>
                            </div>

                            {/* Profit Growth */}
                            <div className={styles.metricCard}>
                                <span className={styles.metricLabel}>PROFIT GROWTH:</span>
                                <span className={styles.metricValue}>
                                    {financials.profitGrowth !== undefined
                                        ? `${(Math.abs(financials.profitGrowth) < 1
                                            ? financials.profitGrowth * 100
                                            : financials.profitGrowth).toFixed(1)}%`
                                        : '-'}
                                </span>
                            </div>

                            {/* Debt/Equity */}
                            <div className={styles.metricCard}>
                                <span className={styles.metricLabel}>DEBT/EQUITY:</span>
                                <span className={styles.metricValue}>
                                    {financials.debtToEquity !== undefined
                                        ? financials.debtToEquity.toFixed(2)
                                        : '-'}
                                </span>
                            </div>
                        </div>
                        <p className="text-[11px] text-tremor-content-subtle dark:text-dark-tremor-content-subtle mt-3 italic text-center">
                            * Data from most recent quarter
                        </p>
                    </section>
                )}

                {/* EPS History Section */}
                {epsHistory && epsHistory.length >= 2 && (
                    <section className={`${styles.section} ${styles.sectionEpsHistory}`}>
                        <div className={styles.sectionHeader}>
                            <h3 className="text-tremor-title font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                EPS
                            </h3>
                        </div>
                        <div className="flex items-end gap-2 h-20 mt-2">
                            {(() => {
                                const maxEps = Math.max(...epsHistory.map(h => Math.abs(h.eps)));
                                if (maxEps <= 0) return null;

                                return epsHistory.map(h => {
                                    const barPct = Math.max(8, (Math.abs(h.eps) / maxEps) * 100);
                                    const isPositive = h.eps >= 0;
                                    return (
                                        <div key={h.year} className="flex-1 flex flex-col items-center gap-1">
                                            <div className="w-full flex items-end justify-center" style={{ height: `${barPct}%` }}>
                                                <div
                                                    className={`w-2 h-2 rounded-full transition-all ${isPositive ? 'bg-blue-500' : 'bg-red-500'}`}
                                                    title={`${h.year}: ${Math.round(h.eps).toLocaleString('vi-VN')} VND`}
                                                />
                                            </div>
                                            <span className={styles.epsHistoryYear}>{String(h.year).slice(2)}</span>
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[10px] text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                            <span>Cao nhất: <span className="font-semibold">{Math.round(Math.max(...epsHistory.map(h => h.eps))).toLocaleString('vi-VN')} ₫</span></span>
                            <span>Gần nhất: <span className="font-semibold">{Math.round(epsHistory[epsHistory.length - 1].eps).toLocaleString('vi-VN')} ₫</span></span>
                        </div>
                    </section>
                )}
            </aside>
        </div>
    );
}
