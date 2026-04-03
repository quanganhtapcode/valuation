'use client';

import { useState, useEffect, useRef, useTransition, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { formatNumber, formatDate, formatPercentChange, fetchStockPeers } from '@/lib/api';
import type { StockApiData } from '@/lib/types';
import { useWatchlist } from '@/lib/watchlistContext';
import { RiStarFill, RiStarLine } from '@remixicon/react';
import styles from './page.module.css';
import OverviewTab from '@/components/StockDetail/OverviewTab';
import FinancialsTab from '@/components/StockDetail/FinancialsTab';
import PriceHistoryTab from '@/components/StockDetail/PriceHistoryTab';
import ValuationTab from '@/components/StockDetail/ValuationTab';
import AnalysisTab from '@/components/StockDetail/AnalysisTab';
import HoldersTab from '@/components/StockDetail/HoldersTab';
import VciNewsFeed from '@/components/StockDetail/VciNewsFeed';
import { Select, SelectItem } from '@tremor/react';
import { getTickerData } from '@/lib/tickerCache';
import { siteConfig } from '@/app/siteConfig';

function classNames(...classes: Array<string | false | undefined | null>) {
    return classes.filter(Boolean).join(' ');
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

interface HistoricalData {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
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

interface FinancialReportItem {
    "Năm"?: number;
    "Kỳ"?: number;
    year?: number;
    quarter?: number;
    [key: string]: any;
}

export default function StockDetailPage() {
    const params = useParams();
    const symbol = (params.symbol as string)?.toUpperCase() || '';

    const [stockInfo, setStockInfo] = useState<StockInfo | null>(null);
    const [priceData, setPriceData] = useState<PriceData | null>(null);
    const [historicalData, setHistoricalData] = useState<HistoricalData[]>([]);
    const [financials, setFinancials] = useState<FinancialData | null>(null);
    const [timeRange, setTimeRange] = useState<'3M' | '6M' | '1Y' | '3Y' | '5Y'>('3M');
    const [isLoading, setIsLoading] = useState(true);

    const [error, setError] = useState<string | null>(null);
    const [isDescExpanded, setIsDescExpanded] = useState(false);
    const [activeTab, setActiveTab] = useState<'overview' | 'financials' | 'holders' | 'valuation' | 'priceHistory' | 'analysis' | 'news'>('overview');
    const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set(['overview']));
    const [, startTransition] = useTransition();
    const [financialPeriod, setFinancialPeriod] = useState<'quarter' | 'year'>('quarter');
    const [financialReport, setFinancialReport] = useState<FinancialReportItem[]>([]);
    const [ratioData, setRatioData] = useState<any[]>([]);

    // New Pre-fetched States
    // const [prefetchedValuation, setPrefetchedValuation] = useState<any>(null); // Removed
    // const [prefetchedChartData, setPrefetchedChartData] = useState<any>(null); // For FinancialsTab // Removed
    // const [prefetchedPeers, setPrefetchedPeers] = useState<any>(null); // For AnalysisTab // Removed
    const [rawOverviewData, setRawOverviewData] = useState<StockApiData | null>(null);
    const [prefetchedChartData, setPrefetchedChartData] = useState<any>(null); // Shared between FinancialsTab & AnalysisTab
    const [isHistoryLoading, setIsHistoryLoading] = useState(true);

    const handleTabChange = useCallback((nextTab: 'overview' | 'financials' | 'holders' | 'valuation' | 'priceHistory' | 'analysis' | 'news') => {
        if (nextTab === activeTab) return;
        startTransition(() => {
            setActiveTab(nextTab);
        });
    }, [activeTab, startTransition]);

    // SHARED DATA: Fetch historical-chart-data ONCE, share with FinancialsTab & AnalysisTab
    useEffect(() => {
        if (!symbol) return;
        setIsHistoryLoading(true);
        const controller = new AbortController();
        fetch(`/api/historical-chart-data/${symbol}?period=quarter`, { signal: controller.signal })
            .then(r => r.ok ? r.json() : null)
            .then(res => {
                if (res?.success && res.data) {
                    setPrefetchedChartData(res); // pass full response so consumers can parse
                }
            })
            .catch(() => { })
            .finally(() => setIsHistoryLoading(false));
        return () => controller.abort();
    }, [symbol]);

    // New state for chart loading
    const [isChartLoading, setIsChartLoading] = useState(false);

    useEffect(() => {
        setVisitedTabs(prev => {
            const next = new Set(prev);
            next.add(activeTab);
            return next;
        });
    }, [activeTab]);

    const handleDownloadExcel = async () => {
        try {
            const res = await fetch(`/api/stock/excel/${symbol}`);
            const data = await res.json();
            if (data.success && data.url) {
                window.open(data.url, '_blank');
            } else {
                alert('Không tìm thấy file dữ liệu Excel cho mã này.');
            }
        } catch (e) {
            console.error(e);
            alert('Lỗi tải file.');
        }
    };

    // 1. Fetch Static Data & Parallel Pre-fetching
    useEffect(() => {
        if (!symbol) return;

        async function loadData() {
            setIsLoading(true);
            setError(null);

            try {
                // Start realtime price request immediately so it runs in parallel
                // with ticker/overview fetching instead of waiting for them.
                const realtimePricePromise = fetch(`/api/current-price/${symbol}`)
                    .then(r => r.ok ? r.json() : null)
                    .catch(() => null);

                // PHASE 1: Fast data from DB/cache (ticker info, profile, stock overview)
                // PHASE 1: Fast data from local cache and summary DB
                const [tickerData, stockRes] = await Promise.all([
                    getTickerData(),
                    fetch(`/api/stock/${symbol}`).then(r => r.ok ? r.json() : null).catch(() => null)
                ]);

                // --- Process Ticker Info ---
                let baseInfo: StockInfo = {
                    symbol,
                    companyName: symbol,
                    sector: 'N/A',
                    exchange: 'N/A',
                };
                if (tickerData) {
                    const ticker = tickerData.tickers?.find(
                        (t: { symbol: string }) => t.symbol.toUpperCase() === symbol
                    );
                    if (ticker) {
                        baseInfo = {
                            symbol: ticker.symbol,
                            companyName: ticker.name,
                            sector: ticker.sector,
                            exchange: ticker.exchange,
                        };
                    }
                }

                setStockInfo(baseInfo);

                // --- Process Stock Data from DB (fast) ---
                let currentPriceValue = 0;
                if (stockRes) {
                    const data = stockRes.data || stockRes;
                    // current_price is normalized to full VND by the backend
                    currentPriceValue = data.current_price || data.price || data.close || 0;
                    const profitGrowthValue = data.profit_growth ?? data.profitGrowth;
                    const debtToEquityValue = data.debt_to_equity ?? data.debtToEquity ?? data.de;
                    setFinancials({
                        eps: data.eps_ttm || data.eps,
                        pe: data.pe_ratio || data.pe || data.PE,
                        pb: data.pb_ratio || data.pb || data.PB,
                        roe: data.roe || data.ROE,
                        roa: data.roa || data.ROA,
                        marketCap: data.market_cap || data.marketCap,
                        bookValue: data.bvps || data.bookValue,
                        dividend: data.dividend_per_share || data.dividend,
                        sharesOutstanding: data.shares_outstanding || data.sharesOutstanding,
                        netProfitMargin: data.net_profit_margin || data.netProfitMargin,
                        profitGrowth: profitGrowthValue === 0 ? undefined : profitGrowthValue,
                        debtToEquity: debtToEquityValue === 0 ? undefined : debtToEquityValue,
                    });
                    setRawOverviewData(data);

                    // Update description from DB if available (faster than fallback fetch)
                    const description = data.company_profile || data.overview?.description;
                    if (description) {
                        setStockInfo(prev => ({
                            ...prev!,
                            overview: { description }
                        }));
                    }

                    // Set initial Price Data from DB to show header immediately
                    setPriceData({
                        price: currentPriceValue,
                        change: data.price_change || data.change || 0,
                        changePercent: data.price_change_percent || data.changePercent || data.pctChange || 0,
                        open: 0,
                        high: 0,
                        low: 0,
                        volume: 0,
                        value: 0,
                        ceiling: 0,
                        floor: 0,
                        ref: 0,
                    });
                }

                // Render Header immediately with DB data
                setIsLoading(false);

                // PHASE 2: Apply real-time price when available
                const priceRes = await realtimePricePromise;
                if (priceRes && priceRes.success) {
                    const data = priceRes.data || priceRes;

                    // Backend normalizes all prices to full VND
                    const newPrice = data.current_price || data.price || 0;

                    // Only update price if we got a valid realtime price
                    // Preserve history-based open/high/low/change if API doesn't provide them
                    if (newPrice > 0) {
                        setPriceData(prev => ({
                            ...prev!,
                            price: newPrice,
                            // Only overwrite these if API provides them (non-zero)
                            ...(data.open > 0 && { open: data.open }),
                            ...(data.high > 0 && { high: data.high }),
                            ...(data.low > 0 && { low: data.low }),
                            ...(data.volume > 0 && { volume: data.volume }),
                            ceiling: data.ceiling || data.priceHigh || 0,
                            floor: data.floor || data.priceLow || 0,
                            ref: data.ref_price || data.ref || 0,
                        }));
                    }
                }

            } catch (err) {
                console.error('Error loading static data:', err);
                setError('Failed to load stock data');
                setIsLoading(false);
            }
        }

        loadData();
    }, [symbol]);

    // State to hold full 5-year history for client-side filtering
    const [fullHistoryData, setFullHistoryData] = useState<HistoricalData[]>([]);

    // 1. Fetch FULL PRICE History Once (Independent)
    useEffect(() => {
        if (!symbol) return;

        async function loadFullHistory() {
            setIsChartLoading(true);
            try {
                // Fetch ALL history (defaults to 5 years/ALL in backend)
                const res = await fetch(`/api/stock/history/${symbol}?period=ALL`);
                if (res.ok) {
                    const json = await res.json();
                    const rawData = json.data || json.Data || json || [];
                    if (Array.isArray(rawData)) {
                        const mapped = rawData.map((d: any) => ({
                            time: d.time || d.date,
                            open: d.open,
                            high: d.high,
                            low: d.low,
                            close: d.close,
                            volume: d.volume,
                        }));
                        // Sort by date ascending to ensure proper charting
                        mapped.sort((a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime());
                        setFullHistoryData(mapped);

                        // Update priceData with latest session info (high, low, open, change)
                        if (mapped.length > 0) {
                            const latest = mapped[mapped.length - 1];
                            const prevClose = mapped.length > 1 ? mapped[mapped.length - 2].close : latest.open;
                            const change = latest.close - prevClose;
                            const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

                            setPriceData(prev => ({
                                ...prev!,
                                // Do not overwrite a newer realtime quote.
                                // Only fallback to latest close when price is still missing.
                                price: (prev?.price && prev.price > 0) ? prev.price : latest.close,
                                open: latest.open,
                                high: latest.high,
                                low: latest.low,
                                volume: latest.volume,
                                change: change,
                                changePercent: changePercent,
                            }));
                        }
                    }
                }
            } catch (e) {
                console.error("Fetch full history failed", e);
            } finally {
                setIsChartLoading(false);
            }
        }
        loadFullHistory();
    }, [symbol]);

    // 2. Client-side Filter when timeRange changes (Instant Transition)
    useEffect(() => {
        if (fullHistoryData.length === 0) return;

        const now = new Date();
        const cutoff = new Date();

        switch (timeRange) {
            case '3M': cutoff.setDate(now.getDate() - 90); break;
            case '6M': cutoff.setDate(now.getDate() - 180); break;
            case '1Y': cutoff.setDate(now.getDate() - 365); break;
            case '3Y': cutoff.setDate(now.getDate() - 365 * 3); break;
            case '5Y': cutoff.setDate(now.getDate() - 365 * 5); break;
            default: cutoff.setDate(now.getDate() - 90); // Default 3M
        }

        const filtered = fullHistoryData.filter(d => new Date(d.time) >= cutoff);
        setHistoricalData(filtered);
    }, [timeRange, fullHistoryData]);

    const isUp = priceData ? priceData.change >= 0 : true;

    // Watchlist Logic (via global context — syncs across sidebar)
    const { toggle: toggleWatchlist, isWatched } = useWatchlist();
    const isWatchlisted = isWatched(symbol);

    // Polling Price every 5 seconds
    useEffect(() => {
        if (!symbol) return;

        const interval = setInterval(() => {
            fetch(`/api/current-price/${symbol}`)
                .then(r => r.ok ? r.json() : null)
                .then(priceRes => {
                    if (priceRes && priceRes.success) {
                        const data = priceRes.data || priceRes;
                        // Backend normalizes all prices to full VND
                        const newPrice = data.current_price || data.price || 0;

                        if (newPrice > 0) {
                            setPriceData(prev => {
                                if (!prev) return null;
                                const refPrice = data.ref_price || data.ref || prev.ref;

                                let change = 0;
                                let changePercent = 0;

                                if (refPrice > 0) {
                                    change = newPrice - refPrice;
                                    changePercent = (change / refPrice) * 100;
                                } else {
                                    change = data.change || data.price_change || 0;
                                    changePercent = data.changePercent || data.price_change_percent || 0;
                                }

                                return {
                                    ...prev,
                                    price: newPrice,
                                    ref: refPrice > 0 ? refPrice : prev.ref,
                                    change: change,
                                    changePercent: changePercent,
                                    ...(data.open > 0 && { open: data.open }),
                                    ...(data.high > 0 && { high: data.high }),
                                    ...(data.low > 0 && { low: data.low }),
                                    ...(data.volume > 0 && { volume: data.volume }),
                                    ...(data.ceiling > 0 && { ceiling: data.ceiling }),
                                    ...(data.floor > 0 && { floor: data.floor }),
                                };
                            });
                        }
                    }
                })
                .catch(err => console.error("Polling error", err));
        }, 10000);

        return () => clearInterval(interval);
    }, [symbol]);

    if (isLoading) {
        return (
            <div className={styles.container}>
                <div className={styles.loading}>
                    <div className="spinner" />
                    <span>Đang tải dữ liệu {symbol}...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.container}>
                <div className={styles.error}>
                    <span>⚠️ {error}</span>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* Header Compact */}
            <div className={styles.stockHeaderCompact}>
                <div className={styles.identityCompact}>
                    <div className={styles.logoWrapper} style={{ width: '56px', height: '56px', backgroundColor: '#fff', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                        <img
                            src={siteConfig.stockLogoUrl(symbol)}
                            alt={symbol}
                            className={styles.logoCompact}
                            style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '4px' }}
                            onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                if (!target.src.includes('/logos/')) {
                                    target.src = `/logos/${symbol}.jpg`;
                                } else {
                                    target.style.display = 'none';
                                }
                            }}
                        />
                        <div className={styles.fallbackLogo} style={{ width: '56px', height: '56px', fontSize: '1.25rem' }}>{symbol.slice(0, 2)}</div>
                    </div>

                    <div className={styles.stockMetaCompact}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <h1 className="text-tremor-content-strong dark:text-dark-tremor-content-strong" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>{symbol}</h1>
                            <button
                                type="button"
                                onClick={() => toggleWatchlist(symbol)}
                                title={isWatchlisted ? 'Xoá khỏi Watchlist' : 'Thêm vào Watchlist'}
                                className="p-1 rounded-full transition-colors hover:bg-amber-50 dark:hover:bg-amber-950"
                            >
                                {isWatchlisted
                                    ? <RiStarFill className="h-5 w-5 text-amber-400" />
                                    : <RiStarLine className="h-5 w-5 text-tremor-content dark:text-dark-tremor-content hover:text-amber-400" />}
                            </button>
                        </div>
                        <div className="text-tremor-content dark:text-dark-tremor-content" style={{ fontSize: '0.85rem', lineHeight: '1.4', marginTop: '2px' }}>
                            {stockInfo?.companyName}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                            <span className={styles.tag} style={{ fontSize: '10px', padding: '2px 6px' }}>{stockInfo?.exchange}</span>
                            <span className={styles.tag} style={{ fontSize: '10px', padding: '2px 6px' }}>{stockInfo?.sector}</span>
                        </div>
                    </div>
                </div>

                {priceData && (
                    <div className={styles.priceCompact}>
                        <div className={styles.priceRowCompact}>
                            <span className="text-tremor-content-strong dark:text-dark-tremor-content-strong" style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1 }}>
                                {formatNumber(priceData.price)}
                            </span>
                            <span className="text-tremor-content-subtle dark:text-dark-tremor-content-subtle" style={{ fontSize: '0.75rem', fontWeight: 500 }}>VND</span>
                            <span style={{ fontSize: '1rem', fontWeight: 600, color: priceData.change >= 0 ? '#10b981' : '#ef4444' }}>
                                {priceData.change > 0 ? '+' : ''}{formatNumber(priceData.change)} <span style={{ opacity: 0.7 }}>({formatPercentChange(priceData.changePercent)})</span>
                            </span>
                        </div>
                        <div className={styles.klcpCompact}>
                            KLCP: {financials?.sharesOutstanding ? formatNumber(financials.sharesOutstanding) : '-'}
                        </div>
                    </div>
                )}
            </div>

            {/* Tab Navigation */}
            <div className="border-b border-tremor-border dark:border-dark-tremor-border">
                <div className="px-2 sm:px-4">
                    <div className="flex h-14 overflow-x-auto scrollbar-hide">
                        <nav className="-mb-px flex space-x-6 min-w-max" aria-label="Tabs">
                            {[
                                { id: 'overview', label: 'Overview' },
                                { id: 'financials', label: 'Financials' },
                                { id: 'holders', label: 'Holders' },
                                { id: 'priceHistory', label: 'Price History' },
                                { id: 'news', label: 'News' },
                                { id: 'analysis', label: 'Analysis' },
                                { id: 'valuation', label: 'Valuation' }
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => handleTabChange(tab.id as 'overview' | 'financials' | 'holders' | 'valuation' | 'priceHistory' | 'analysis' | 'news')}
                                    className={classNames(
                                        activeTab === tab.id
                                            ? 'border-tremor-brand text-tremor-brand dark:border-dark-tremor-brand dark:text-dark-tremor-brand'
                                            : 'border-transparent text-tremor-content-emphasis hover:border-tremor-content-subtle hover:text-tremor-content-strong dark:text-dark-tremor-content-emphasis hover:dark:border-dark-tremor-content-subtle hover:dark:text-dark-tremor-content-strong',
                                        'inline-flex items-center whitespace-nowrap border-b-2 px-2 text-tremor-default font-medium'
                                    )}
                                    aria-current={activeTab === tab.id ? 'page' : undefined}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </nav>
                    </div>
                </div>
            </div>

            {/* Main Content with Persistent Tabs (Lazy Loaded) */}
            <div className={styles.mainContentFull}>
                {/* Overview - Always keep mounted if visited, typically visited first */}
                <div className={activeTab !== 'overview' ? 'hidden' : undefined}>
                    <OverviewTab
                        symbol={symbol}
                        stockInfo={stockInfo}
                        priceData={priceData}
                        financials={financials}
                        timeRange={timeRange}
                        setTimeRange={setTimeRange}
                        isDescExpanded={isDescExpanded}
                        setIsDescExpanded={setIsDescExpanded}
                        historicalData={historicalData}
                        isLoading={isChartLoading}
                    />
                </div>

                {/* Financials Tab - Lazy & Persistent */}
                {visitedTabs.has('financials') && (
                    <div className={activeTab === 'financials' ? 'block' : 'hidden'}>
                        <div className="mb-4 flex items-center justify-between gap-4">
                            <h3 className="text-tremor-title font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong whitespace-nowrap">
                                Financial Reports
                            </h3>
                            <div className="flex items-center gap-2">
                                <Select
                                    value={financialPeriod}
                                    onValueChange={(val) => setFinancialPeriod(val as 'quarter' | 'year')}
                                    className="w-32"
                                >
                                    <SelectItem value="quarter">Quarter</SelectItem>
                                    <SelectItem value="year">Year</SelectItem>
                                </Select>
                                <button
                                    type="button"
                                    onClick={handleDownloadExcel}
                                    className="inline-flex items-center justify-center gap-2 rounded-tremor-small border border-tremor-border bg-white px-3 py-2 text-tremor-default font-medium text-tremor-content-strong shadow-sm hover:bg-tremor-background-muted dark:border-dark-tremor-border dark:bg-dark-tremor-background dark:text-dark-tremor-content-strong"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                        <polyline points="7 10 12 15 17 10" />
                                        <line x1="12" y1="15" x2="12" y2="3" />
                                    </svg>
                                    <span className="hidden sm:inline">Export Excel</span>
                                    <span className="sm:hidden">Excel</span>
                                </button>
                            </div>
                        </div>
                        <FinancialsTab
                            symbol={symbol}
                            period={financialPeriod}
                            setPeriod={setFinancialPeriod}
                            initialChartData={prefetchedChartData}
                            initialOverviewData={rawOverviewData}
                            isLoading={isHistoryLoading}
                        />
                    </div>
                )}

                {/* Holders Tab - Lazy & Persistent */}
                {visitedTabs.has('holders') && (
                    <div className={activeTab === 'holders' ? 'block' : 'hidden'}>
                        <div className="mb-4 flex items-center justify-between gap-4">
                            <h3 className="text-tremor-title font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong whitespace-nowrap">
                                Holders
                            </h3>
                        </div>
                        <HoldersTab symbol={symbol} />
                    </div>
                )}

                {/* Price History Tab - Lazy & Persistent */}
                {visitedTabs.has('priceHistory') && (
                    <div className={activeTab === 'priceHistory' ? 'block' : 'hidden'}>
                        <PriceHistoryTab
                            symbol={symbol}
                            initialData={fullHistoryData.length > 0 ? fullHistoryData : undefined}
                        />
                    </div>
                )}

                {/* News Tab - Lazy & Persistent */}
                {visitedTabs.has('news') && (
                    <div className={activeTab === 'news' ? 'block' : 'hidden'}>
                        <div className="mb-4 flex items-center justify-between gap-4">
                            <h3 className="text-tremor-title font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong whitespace-nowrap">
                                News
                            </h3>
                        </div>
                        <VciNewsFeed symbol={symbol} />
                    </div>
                )}

                {/* Valuation Tab - Lazy & Persistent */}
                {visitedTabs.has('valuation') && (
                    <div className={activeTab === 'valuation' ? 'block' : 'hidden'}>
                        <ValuationTab
                            symbol={symbol}
                            currentPrice={priceData?.price || 0}
                            initialData={null}
                            isBank={stockInfo?.sector === 'Ngân hàng' || ['VCB', 'BID', 'CTG', 'VPB', 'MBB', 'TCB', 'ACB', 'HDB', 'VIB', 'STB', 'TPB', 'MSB', 'LPB', 'SHB', 'OCB', 'VBB', 'BAB', 'BVB', 'EIB', 'KLB', 'SGB', 'PGB', 'NVB', 'VAB'].includes(symbol)}
                        />
                    </div>
                )}

                {/* Analysis Tab - Lazy & Persistent */}
                {visitedTabs.has('analysis') && (
                    <div className={activeTab === 'analysis' ? 'space-y-4' : 'hidden'}>
                        <div className="flex items-center justify-between gap-4">
                            <h3 className="text-tremor-title font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong whitespace-nowrap">
                                Analysis
                            </h3>
                        </div>
                        <AnalysisTab
                            symbol={symbol}
                            sector={stockInfo?.sector || 'Unknown'}
                            initialPeers={null}
                            initialHistory={prefetchedChartData}
                            isLoading={isHistoryLoading}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
