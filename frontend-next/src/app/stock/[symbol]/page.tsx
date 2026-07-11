'use client';

import { useState, useEffect, useTransition, useCallback } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { API, formatNumber, formatPercentChange, subscribePricesStream } from '@/lib/api';
import type { StockApiData } from '@/lib/types';
import { useWatchlist } from '@/lib/watchlistContext';
import { RiStarFill, RiStarLine } from '@remixicon/react';
import styles from './page.module.css';
import { getTickerData } from '@/lib/tickerCache';
import { siteConfig } from '@/app/siteConfig';
import { useLanguage } from "@/lib/languageContext";
import { translations } from "@/lib/translations";

type StockTabId = 'overview' | 'financials' | 'holders' | 'valuation' | 'priceHistory' | 'analysis' | 'news' | 'technical';

function TabLoading() {
    return (
        <div className="flex items-center justify-center p-10">
            <div className="spinner" />
        </div>
    );
}

const OverviewTab = dynamic(() => import('@/components/StockDetail/OverviewTab'), { loading: TabLoading });
const FinancialsTab = dynamic(() => import('@/components/StockDetail/FinancialsTab'), { loading: TabLoading });
const PriceHistoryTab = dynamic(() => import('@/components/StockDetail/PriceHistoryTab'), { loading: TabLoading });
const ValuationTab = dynamic(() => import('@/components/StockDetail/ValuationTab'), { loading: TabLoading });
const AnalysisTab = dynamic(() => import('@/components/StockDetail/AnalysisTab'), { loading: TabLoading });
const HoldersTab = dynamic(() => import('@/components/StockDetail/HoldersTab'), { loading: TabLoading });
const VciNewsFeed = dynamic(() => import('@/components/StockDetail/VciNewsFeed'), { loading: TabLoading });
const TechnicalTab = dynamic(() => import('@/components/StockDetail/TechnicalTab'), { loading: TabLoading });

function classNames(...classes: Array<string | false | undefined | null>) {
    return classes.filter(Boolean).join(' ');
}

function profileHtmlToText(value: string): string {
    const documentFragment = document.createElement('div');
    documentFragment.innerHTML = value;
    return (documentFragment.textContent || '').replace(/\s+/g, ' ').trim();
}

function scheduleIdleWork(callback: () => void, timeout = 1200): () => void {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        const idleId = window.requestIdleCallback(callback, { timeout });
        return () => window.cancelIdleCallback(idleId);
    }

    const timer = window.setTimeout(callback, Math.min(timeout, 300));
    return () => window.clearTimeout(timer);
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
    grossMargin?: number;
    debtToEquity?: number;
    currentRatio?: number;
}

export default function StockDetailPage() {
    const params = useParams();
    const symbol = (params.symbol as string)?.toUpperCase() || '';
    const { lang } = useLanguage()
    const t = translations[lang]

    const [stockInfo, setStockInfo] = useState<StockInfo | null>(null);
    const [priceData, setPriceData] = useState<PriceData | null>(null);
    const [targetPrice, setTargetPrice] = useState<number | null>(null);
    const [financials, setFinancials] = useState<FinancialData | null>(null);
    const [historicalData, setHistoricalData] = useState<HistoricalData[]>([]);
    const [isDescExpanded, setIsDescExpanded] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<StockTabId>('overview');
    const [visitedTabs, setVisitedTabs] = useState<Set<StockTabId>>(new Set<StockTabId>(['overview']));
    const [, startTransition] = useTransition();
    const [financialPeriod, setFinancialPeriod] = useState<'quarter' | 'year'>('quarter');
    const [rawOverviewData, setRawOverviewData] = useState<StockApiData | null>(null);
    const [news, setNews] = useState<any[]>([]);
    const [epsHistory, setEpsHistory] = useState<Array<{ year: number; eps: number }>>([]);

    const handleTabChange = useCallback((nextTab: StockTabId) => {
        if (nextTab === activeTab) return;
        startTransition(() => {
            setActiveTab(nextTab);
        });
    }, [activeTab, startTransition]);

    // New state for chart loading
    const [isChartLoading, setIsChartLoading] = useState(false);

    useEffect(() => {
        setVisitedTabs(prev => {
            const next = new Set(prev);
            next.add(activeTab);
            return next;
        });
    }, [activeTab]);

    const handleDownloadExcel = useCallback(() => {
        if (!symbol) return;
        window.open(`https://fiin.quanganh.org/excel/${symbol}.xlsx`, '_blank');
    }, [symbol]);

    // 1. Fetch Static Data & Parallel Pre-fetching
    useEffect(() => {
        if (!symbol) return;

        const controller = new AbortController();
        const idleCleanups: Array<() => void> = [];

        async function loadData() {
            setIsLoading(true);
            setError(null);

            try {
                // Start realtime price request immediately so it runs in parallel
                // with ticker/overview fetching instead of waiting for them.
                const realtimePricePromise = fetch(API.CURRENT_PRICE(symbol), { signal: controller.signal })
                    .then(r => r.ok ? r.json() : null)
                    .catch(() => null);

                // PHASE 1: Critical overview payload. Use one direct backend request
                // instead of four proxy requests so first render is not gated by
                // repeated provider/cache work.
                const [tickerData, stockRes] = await Promise.all([
                    getTickerData(),
                    fetch(API.STOCK_OVERVIEW_FULL(symbol), { signal: controller.signal })
                        .then(r => r.ok ? r.json() : null)
                        .catch(() => null),
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
                            companyName: lang === "en" && ticker.en_name ? ticker.en_name : ticker.name,
                            sector: lang === "en" && ticker.en_sector ? ticker.en_sector : ticker.sector,
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
                    const tp = data.target_price ?? data.targetPrice ?? null;
                    if (tp) setTargetPrice(Number(tp));
                    setFinancials({
                        eps: data.eps || (data.current_price && data.pe && data.pe > 0 ? Math.round(data.current_price / data.pe) : undefined),
                        pe: data.pe,
                        pb: data.pb,
                        roe: data.roe,
                        roa: data.roa,
                        marketCap: data.market_cap || data.marketCap,
                        bookValue: data.bvps || data.bookValue,
                        dividend: data.dividend_per_share || data.dividend,
                        sharesOutstanding: data.shares_outstanding || data.sharesOutstanding,
                        netProfitMargin: data.after_tax_margin ?? data.net_margin ?? data.netProfitMargin,
                        grossMargin: data.gross_margin ?? data.grossMargin,
                        debtToEquity: data.debt_to_equity ?? data.debtToEquity ?? data.de,
                        currentRatio: data.current_ratio ?? data.currentRatio,
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

                // PHASE 2: Non-critical overview enrichments. Keep them off the
                // critical path so first paint is not competing with extra API calls.
                idleCleanups.push(scheduleIdleWork(() => {
                    fetch(`/api/company-profile/${symbol}?lang=${lang}`, { signal: controller.signal })
                        .then(r => r.ok ? r.json() : null)
                        .then(res => {
                            if (res?.available && typeof res.profile === 'string') {
                                const description = profileHtmlToText(res.profile);
                                if (!description) return;
                                setStockInfo(prev => prev ? {
                                    ...prev,
                                    overview: { ...prev.overview, description },
                                } : prev);
                            }
                        })
                        .catch(err => {
                            if (!controller.signal.aborted) console.error('[Company profile API] Error:', err);
                        });

                    fetch(`/api/stock/${symbol}/news?compact=1`, { signal: controller.signal })
                        .then(r => r.ok ? r.json() : null)
                        .then(res => {
                            const newsData = res?.data || res;
                            if (Array.isArray(newsData) && newsData.length > 0) {
                                setNews(newsData.slice(0, 6));
                            }
                        })
                        .catch(err => {
                            if (!controller.signal.aborted) console.error('[News API] Error:', err);
                        });

                    fetch(`/api/stock/${symbol}/financial-report?type=income&period=year&limit=10`, { signal: controller.signal })
                        .then(r => r.ok ? r.json() : null)
                        .then(res => {
                            const rows = res?.data || res;
                            if (Array.isArray(rows) && rows.length > 0) {
                                const epsHistory = rows
                                    .filter((row: any) => row.isa23 !== null && row.isa23 !== undefined)
                                    .map((row: any) => ({
                                        year: row.year || row.year_report || 0,
                                        eps: Number(row.isa23) || 0,
                                    }))
                                    .filter((item: any) => item.eps > 0)
                                    .sort((a: any, b: any) => a.year - b.year);
                                if (epsHistory.length > 0) {
                                    setEpsHistory(epsHistory);
                                }
                            }
                        })
                        .catch(err => {
                            if (!controller.signal.aborted) console.error('[EPS API] Error:', err);
                        });
                }));

                // PHASE 2: Apply real-time price when available
                const priceRes = await realtimePricePromise;
                if (priceRes && priceRes.success) {
                    const data = priceRes.data || priceRes;

                    // Backend normalizes all prices to full VND
                    const newPrice = data.current_price || data.price || 0;
                    const ob = data.orderbook;

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
                            ...(ob && {
                                orderbook: {
                                    bid: (ob.bid || []).slice(0, 3).map((b: any) => ({ price: b?.price || 0, volume: b?.volume || 0 })),
                                    ask: (ob.ask || []).slice(0, 3).map((a: any) => ({ price: a?.price || 0, volume: a?.volume || 0 })),
                                },
                            }),
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

        return () => {
            idleCleanups.forEach(cleanup => cleanup());
            controller.abort();
        };
    }, [symbol, lang]);

    // ── WebSocket: Real-time price stream (VCI) ────────────────────────────
    useEffect(() => {
        if (!symbol) return;

        const unsub = subscribePricesStream({
            onData: (data: any) => {
                // data shape: { SYM: { c, ref, vo, orderbook } }
                if (!data || typeof data !== 'object') return;
                const symData = data[symbol];
                if (!symData) return;

                const c = symData.c;       // current price
                const ref = symData.ref;   // reference price
                const vo = symData.vo;     // volume
                const ob = symData.orderbook;

                if (c == null && ref == null) return;

                const refPrice = ref ?? 0;
                const curPrice = c ?? 0;
                const change = refPrice > 0 ? curPrice - refPrice : 0;
                const changePercent = refPrice > 0 ? (change / refPrice) * 100 : 0;

                setPriceData(prev => {
                    const obFormatted = ob ? {
                        bid: (ob.bid || []).slice(0, 3).map((b: any) => ({ price: b?.price || 0, volume: b?.volume || 0 })),
                        ask: (ob.ask || []).slice(0, 3).map((a: any) => ({ price: a?.price || 0, volume: a?.volume || 0 })),
                    } : undefined;

                    if (!prev) {
                        // Bootstrap from WS snapshot before HTTP fetch completes
                        if (curPrice <= 0 && refPrice <= 0) return prev;
                        return {
                            price: curPrice,
                            change,
                            changePercent,
                            open: 0, high: 0, low: 0,
                            volume: vo ?? 0,
                            value: 0, ceiling: 0, floor: 0,
                            ref: refPrice,
                            ...(obFormatted && { orderbook: obFormatted }),
                        };
                    }
                    return {
                        ...prev,
                        ...(curPrice > 0 && { price: curPrice }),
                        ...(refPrice > 0 && { ref: refPrice }),
                        ...(vo != null && { volume: vo }),
                        ...(obFormatted && { orderbook: obFormatted }),
                        ...(change !== 0 && { change }),
                        ...(changePercent !== 0 && { changePercent }),
                    };
                });
            },
            onStatus: (status) => {
                // Optional: could show a subtle indicator when WS is live
                if (process.env.NODE_ENV === 'development') {
                    console.log(`[WS Prices] ${symbol}: ${status}`);
                }
            },
        });

        return () => {
            unsub();
        };
    }, [symbol]);

    // State to hold full 5-year history for client-side filtering
    const [fullHistoryData, setFullHistoryData] = useState<HistoricalData[]>([]);

    // 1. Fetch FULL PRICE History Once (Independent)
    useEffect(() => {
        if (!symbol) return;
        const controller = new AbortController();

        async function loadFullHistory() {
            setIsChartLoading(true);
            try {
                // Fetch ALL history (defaults to 5 years/ALL in backend)
                const res = await fetch(`/api/stock/history/${symbol}?period=ALL`, { signal: controller.signal });
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
                            const histChange = latest.close - prevClose;
                            const histChangePercent = prevClose > 0 ? (histChange / prevClose) * 100 : 0;

                            setPriceData(prev => {
                                if (!prev) return prev;
                                const currentPrice = (prev.price && prev.price > 0) ? prev.price : latest.close;
                                // If we already have a ref price from the realtime API, use it for change
                                // (gap-adjusted history gives wrong prev-close vs actual session ref price)
                                const refPrice = prev.ref > 0 ? prev.ref : 0;
                                const change = refPrice > 0 ? currentPrice - refPrice : histChange;
                                const changePercent = refPrice > 0 ? (change / refPrice) * 100 : histChangePercent;
                                return {
                                    ...prev,
                                    price: currentPrice,
                                    open: latest.open,
                                    high: latest.high,
                                    low: latest.low,
                                    volume: latest.volume,
                                    change,
                                    changePercent,
                                };
                            });
                        }
                    }
                }
            } catch (e) {
                if (!controller.signal.aborted) console.error("Fetch full history failed", e);
            } finally {
                setIsChartLoading(false);
            }
        }
        const cancelIdle = scheduleIdleWork(loadFullHistory, 900);
        return () => {
            cancelIdle();
            controller.abort();
        };
    }, [symbol]);

    // 2. Use all data (infinite range)
    useEffect(() => {
        if (fullHistoryData.length === 0) return;
        setHistoricalData(fullHistoryData);
    }, [fullHistoryData]);

    // Watchlist Logic (via global context — syncs across sidebar)
    const { toggle: toggleWatchlist, isWatched } = useWatchlist();
    const isWatchlisted = isWatched(symbol);

    if (isLoading) {
        return (
            <div className={styles.container}>
                <div className={styles.loading}>
                    <div className="spinner" />
                    <span>{t.stock.loading(symbol)}</span>
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
            {/* ── Stock header ─────────────────────────────────────── */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] mb-0">

                {/* Top identity bar */}
                <div className="flex items-center gap-2.5 px-5 pt-4 pb-0">
                    {/* Logo */}
                    <div className="relative w-8 h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={siteConfig.stockLogoUrl(symbol)}
                            alt={symbol}
                            className="w-full h-full object-contain p-0.5"
                            onError={(e) => {
                                const t = e.target as HTMLImageElement;
                                if (!t.src.includes('/logos/')) { t.src = `/logos/${symbol}.jpg`; }
                                else { t.style.display = 'none'; }
                            }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white rounded-md"
                            style={{ background: 'linear-gradient(135deg,#2563eb,#3b82f6)', zIndex: -1 }}>
                            {symbol.slice(0, 2)}
                        </div>
                    </div>

                    {/* Symbol + exchange + sector */}
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <h1 className="text-[15px] font-bold text-slate-900 dark:text-white leading-none tracking-tight">{symbol}</h1>
                        {(stockInfo?.exchange || stockInfo?.sector) && (
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                                {stockInfo?.exchange && (
                                    <span className="border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 font-semibold leading-none">
                                        {stockInfo.exchange}
                                    </span>
                                )}
                                {stockInfo?.exchange && stockInfo?.sector && (
                                    <span className="text-slate-300 dark:text-slate-600">·</span>
                                )}
                                {stockInfo?.sector && (
                                    <span className="truncate max-w-[180px]">{stockInfo.sector}</span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Watchlist star */}
                    <button
                        type="button"
                        onClick={() => toggleWatchlist(symbol)}
                        title={isWatchlisted ? t.stock.removeWatchlist : t.stock.addWatchlist}
                        className="p-1 rounded-full transition-colors hover:bg-amber-50 dark:hover:bg-amber-950/40 flex-shrink-0"
                    >
                        {isWatchlisted
                            ? <RiStarFill className="h-4.5 w-4.5 text-amber-400" />
                            : <RiStarLine className="h-4.5 w-4.5 text-slate-400 dark:text-slate-500 hover:text-amber-400" />}
                    </button>
                </div>

                {/* Company name */}
                <p className="px-5 pt-0.5 pb-0 text-[13px] text-slate-500 dark:text-slate-400 truncate leading-snug">
                    {stockInfo?.companyName || '—'}
                </p>

                {/* Price section */}
                {priceData && (() => {
                    const isCeiling = priceData.ceiling > 0 && priceData.price >= priceData.ceiling;
                    const isFloor = priceData.floor > 0 && priceData.price <= priceData.floor;
                    const isUp = priceData.change > 0;
                    const isDown = priceData.change < 0;
                    const isRef = !isUp && !isDown && priceData.ref > 0;

                    const priceColor = isCeiling ? '#9333ea' : isFloor ? '#0891b2'
                        : isUp ? '#16a34a' : isDown ? '#ef4444' : isRef ? '#d97706' : '#0f172a';
                    const changeColor = isUp ? '#16a34a' : isDown ? '#ef4444' : '#d97706';

                    const targetPct = targetPrice && priceData.price > 0
                        ? ((targetPrice - priceData.price) / priceData.price * 100)
                        : null;

                    // formatPercentChange already adds sign, so only prepend + for positive to avoid ++
                    const pctStr = formatPercentChange(priceData.changePercent);
                    const changeStr = `${isUp ? '+' : ''}${formatNumber(priceData.change)}`;

                    return (
                        <>
                            <div className="px-5 py-4 flex items-center justify-between gap-4">
                            {/* LEFT — price + change */}
                            <div className="flex flex-col gap-1 min-w-0">
                                <div className="flex items-baseline gap-3 flex-wrap">
                                    <span className="text-[2.25rem] font-bold tabular-nums leading-none tracking-tight" style={{ color: priceColor }}>
                                        {formatNumber(priceData.price)}
                                    </span>
                                    <div className="flex items-baseline gap-1.5 tabular-nums font-bold" style={{ color: changeColor }}>
                                        <span className="text-[1.15rem]">{pctStr}</span>
                                        <span className="text-[12px] font-semibold opacity-75">({changeStr})</span>
                                    </div>
                                </div>
                                <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{t.detail.latestData}</div>
                            </div>

                            {/* RIGHT — target badge + KLCP */}
                            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                                {targetPct !== null && (
                                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold border"
                                        style={{
                                            background: targetPct >= 0 ? 'rgba(22,163,74,0.08)' : 'rgba(239,68,68,0.08)',
                                            borderColor: targetPct >= 0 ? 'rgba(22,163,74,0.25)' : 'rgba(239,68,68,0.25)',
                                            color: targetPct >= 0 ? '#16a34a' : '#ef4444',
                                        }}>
                                        <span className="text-slate-400 dark:text-slate-500 font-medium text-[10px]">{t.stock.upside}</span>
                                        <span>{targetPct >= 0 ? '▲' : '▼'} {Math.abs(targetPct).toFixed(1)}%</span>
                                    </div>
                                )}
                                {financials?.sharesOutstanding ? (
                                    <div className="text-[11px] text-slate-400 dark:text-slate-500">
                                        {t.stock.shares} <span className="text-slate-600 dark:text-slate-300 font-medium tabular-nums">{formatNumber(financials.sharesOutstanding)}</span>
                                    </div>
                                ) : null}
                            </div>
                            </div>

                        <dl className="grid grid-cols-2 border-t border-slate-100 dark:border-slate-800/60 sm:grid-cols-3 lg:grid-cols-5">
                            {[
                                { label: t.overview.open, value: priceData.open },
                                { label: t.overview.high, value: priceData.high },
                                { label: t.overview.low, value: priceData.low },
                                { label: t.overview.volume, value: priceData.volume },
                                { label: t.detail.marketCap, value: financials?.marketCap },
                            ].map((item, index) => (
                                <div key={item.label} className={`min-w-0 px-5 py-3 ${index < 4 ? 'lg:border-r lg:border-slate-100 lg:dark:border-slate-800/60' : ''}`}>
                                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{item.label}</dt>
                                    <dd className="mt-1 truncate text-[13px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                                        {item.value ? formatNumber(item.value, { maximumFractionDigits: 0 }) : '—'}
                                    </dd>
                                </div>
                            ))}
                            </dl>
                        </>
                    );
                })()}

                {/* Tab Navigation — Vietcap underline style */}
                <div className="sticky top-16 z-20 border-t border-slate-100 dark:border-slate-800/60 bg-white dark:bg-[#111827]">
                    <nav className="flex overflow-x-auto scrollbar-hide px-2" aria-label="Điều hướng chi tiết cổ phiếu">
                        {[
                            { id: 'overview', label: t.stock.tabs.overview },
                            { id: 'financials', label: t.stock.tabs.financials },
                            { id: 'holders', label: t.stock.tabs.holders },
                            { id: 'priceHistory', label: t.stock.tabs.priceHistory },
                            { id: 'news', label: t.stock.tabs.news },
                            { id: 'analysis', label: t.stock.tabs.analysis },
                            { id: 'technical', label: t.stock.tabs.technical },
                            { id: 'valuation', label: t.stock.tabs.valuation },
                        ].map(tab => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => handleTabChange(tab.id as StockTabId)}
                                className={classNames(
                                    'inline-flex items-center whitespace-nowrap border-b-2 px-3.5 py-3 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-blue-600',
                                    activeTab === tab.id
                                        ? 'border-blue-600 text-blue-700 dark:text-blue-400'
                                        : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                )}
                                aria-current={activeTab === tab.id ? 'page' : undefined}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </nav>
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
                        isDescExpanded={isDescExpanded}
                        setIsDescExpanded={setIsDescExpanded}
                        historicalData={historicalData}
                        isLoading={isChartLoading}
                        news={news}
                        epsHistory={epsHistory}
                        isBank={
                            (stockInfo as any)?.isbank === true ||
                            stockInfo?.sector === 'Ngân hàng' ||
                            ['VCB','BID','CTG','VPB','MBB','TCB','ACB','HDB','VIB','STB',
                             'TPB','MSB','LPB','SHB','OCB','VBB','BAB','BVB','EIB','KLB',
                             'SGB','PGB','NVB','VAB'].includes(symbol)
                        }
                    />
                </div>

                {/* Financials Tab - Lazy & Persistent */}
                {visitedTabs.has('financials') && (
                    <div className={activeTab === 'financials' ? 'block' : 'hidden'}>
                        <FinancialsTab
                            symbol={symbol}
                            period={financialPeriod}
                            setPeriod={setFinancialPeriod}
                            initialOverviewData={rawOverviewData}
                            onDownloadExcel={handleDownloadExcel}
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
                            initialHistory={null}
                            isLoading={false}
                        />
                    </div>
                )}

                {/* Technical Tab - Lazy & Persistent */}
                {visitedTabs.has('technical') && (
                    <div className={activeTab === 'technical' ? 'block' : 'hidden'}>
                        <TechnicalTab symbol={symbol} />
                    </div>
                )}
            </div>
        </div>
    );
}
