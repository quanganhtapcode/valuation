'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import MarketIndices, { type OverviewIndexData } from '@/components/HeroIndexCard/MarketIndices';
import {
    isTradingHours,
    fetchTopMovers,
    fetchGoldPrices,
    fetchNews,
    NewsItem,
    TopMoverItem,
    GoldPriceItem,
} from '@/lib/api';
import styles from './page.module.css';
import { useVisiblePolling } from '@/hooks/useVisiblePolling';
import DeferredPanel from '@/components/ui/DeferredPanel';
import TradingViewForexTable from '@/components/Macro/TradingViewForexTable';

const moversDelay = () => isTradingHours() ? 30000 : 300000;
const newsDelay = () => 120000;
const goldDelay = () => 60000;

function PanelSkeleton({ height = 'h-40' }: { height?: string }) {
    return (
        <div className={`rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 ${height}`}>
            <div className="h-full animate-pulse bg-slate-100 dark:bg-slate-800/60" />
        </div>
    );
}

const NewsSection = dynamic(() => import('@/components/NewsSection'), {
    loading: () => <PanelSkeleton height="h-80" />,
});
const HeatmapVN30 = dynamic(() => import('@/components/HeatmapVN30').then(mod => mod.HeatmapVN30), {
    loading: () => <PanelSkeleton height="h-[620px]" />,
});
const EarningsSeason = dynamic(() => import('@/components/EarningsSeason').then(mod => mod.EarningsSeason), {
    loading: () => <PanelSkeleton height="h-72" />,
});
const WatchlistCard = dynamic(() => import('@/components/Sidebar/WatchlistCard'), {
    loading: () => <PanelSkeleton height="h-52" />,
});
const MarketPulse = dynamic(() => import('@/components/Sidebar/MarketPulse'), {
    loading: () => <PanelSkeleton height="h-64" />,
});
const FFWorldMarkets = dynamic(() => import('@/components/Sidebar/FFWorldMarkets'), {
    loading: () => <PanelSkeleton height="h-48" />,
});
const CryptoPrices = dynamic(() => import('@/components/Sidebar/CryptoPrices'), {
    loading: () => <PanelSkeleton height="h-48" />,
});
const GoldPrice = dynamic(() => import('@/components/Sidebar/GoldPrice'), {
    loading: () => <PanelSkeleton height="h-48" />,
});
const PolymarketEvents = dynamic(() => import('@/components/Sidebar/PolymarketEvents'), {
    loading: () => <PanelSkeleton height="h-48" />,
});

interface OverviewClientProps {
    initialIndices: OverviewIndexData[];
    initialNews: NewsItem[];
    initialGainers: TopMoverItem[];
    initialLosers: TopMoverItem[];
    initialGoldPrices: GoldPriceItem[];
}

function sameMovers(a: TopMoverItem[], b: TopMoverItem[]): boolean {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        const x = a[i]; const y = b[i];
        if (!x || !y) return false;
        if (x.Symbol !== y.Symbol ||
            Number(x.CurrentPrice || 0) !== Number(y.CurrentPrice || 0) ||
            Number(x.ChangePricePercent || 0) !== Number(y.ChangePricePercent || 0) ||
            Number(x.Value || 0) !== Number(y.Value || 0)) return false;
    }
    return true;
}

export default function OverviewClient({
    initialIndices,
    initialNews,
    initialGainers,
    initialLosers,
    initialGoldPrices,
}: OverviewClientProps) {
    const [news, setNews] = useState<NewsItem[]>(initialNews);
    const [newsLoading, setNewsLoading] = useState(initialNews.length === 0);
    const [newsError, setNewsError] = useState<string | null>(null);
    const [gainers, setGainers] = useState<TopMoverItem[]>(initialGainers);
    const [losers, setLosers] = useState<TopMoverItem[]>(initialLosers);
    const [moversLoading, setMoversLoading] = useState(initialGainers.length === 0 && initialLosers.length === 0);
    const [goldPrices, setGoldPrices] = useState<GoldPriceItem[]>(initialGoldPrices);
    const [goldSource, setGoldSource] = useState<string>('Phú Quý');
    const [goldStale, setGoldStale] = useState(false);

    const newsInFlightRef = useRef(false);
    const moversInFlightRef = useRef(false);
    // Use refs so loadMovers callback is stable (never recreated)
    const gainersRef = useRef<TopMoverItem[]>(initialGainers);
    const losersRef = useRef<TopMoverItem[]>(initialLosers);
    useEffect(() => { gainersRef.current = gainers; }, [gainers]);
    useEffect(() => { losersRef.current = losers; }, [losers]);

    const loadGold = useCallback(async () => {
        try {
            const result = await fetchGoldPrices();
            setGoldPrices(result.data);
            setGoldStale(Boolean(result.stale));
            if (result.source) setGoldSource(result.source);
        } catch (error) {
            console.error('Error loading gold prices:', error);
            setGoldStale(true);
        }
    }, []);

    const loadNews = useCallback(async () => {
        if (newsInFlightRef.current) return;
        try {
            newsInFlightRef.current = true;
            setNewsError(null);
            const nextNews = await fetchNews(1, 30);
            setNews(nextNews);
        } catch (error) {
            console.error('Error loading market news:', error);
            setNewsError('Unable to refresh market news');
        } finally {
            newsInFlightRef.current = false;
            setNewsLoading(false);
        }
    }, []);

    // Stable loadMovers — uses refs, never recreated
    const loadMovers = useCallback(async () => {
        if (moversInFlightRef.current) return;
        const coldStart = gainersRef.current.length === 0 && losersRef.current.length === 0;
        try {
            moversInFlightRef.current = true;
            if (coldStart) setMoversLoading(true);
            const [up, down] = await Promise.all([
                fetchTopMovers('UP'),
                fetchTopMovers('DOWN'),
            ]);
            setGainers(prev => (sameMovers(prev, up) ? prev : up));
            setLosers(prev => (sameMovers(prev, down) ? prev : down));
        } catch (error) {
            console.error('Error loading top movers:', error);
        } finally {
            moversInFlightRef.current = false;
            if (coldStart) setMoversLoading(false);
        }
    }, []); // stable — no deps

    useVisiblePolling(loadGold, goldDelay, initialGoldPrices.length === 0);

    // News polling
    useVisiblePolling(loadNews, newsDelay, initialNews.length === 0);

    // Movers: cold start
    useVisiblePolling(loadMovers, moversDelay, initialGainers.length === 0 || initialLosers.length === 0);

    return (
        <div className={styles.container}>
            <div className={styles.mainContent}>
                <div className={styles.leftColumn}>
                    <MarketIndices initialIndices={initialIndices} />

                    <DeferredPanel height={620}><HeatmapVN30 /></DeferredPanel>

                    <DeferredPanel height={288}><EarningsSeason /></DeferredPanel>

                    <div className="order-2">
                        <NewsSection news={news} isLoading={newsLoading} error={newsError} />
                        <section className="mt-4" aria-label="TradingView forex rates">
                            <DeferredPanel height={360}><TradingViewForexTable /></DeferredPanel>
                        </section>
                    </div>
                </div>

                <aside className={styles.rightColumn}>
                    <DeferredPanel height={208}><WatchlistCard /></DeferredPanel>
                    <DeferredPanel height={256}><MarketPulse gainers={gainers} losers={losers} isLoading={moversLoading} /></DeferredPanel>
                    <DeferredPanel><FFWorldMarkets /></DeferredPanel>
                    <DeferredPanel><CryptoPrices /></DeferredPanel>
                    <GoldPrice prices={goldPrices} isLoading={false} source={goldSource} stale={goldStale} />
                    <DeferredPanel height={480}><PolymarketEvents /></DeferredPanel>
                    <p className="px-1 text-[11px] leading-relaxed text-justify text-gray-400 dark:text-gray-500">
                        Market and company data is aggregated from sources including Vietcap, Yahoo Finance, SBV (State Bank of Vietnam), Polymarket, and other relevant public sources. All data is provided for informational purposes only and is not intended for trading purposes or as financial, investment, tax, legal, accounting, or other professional advice.
                    </p>
                </aside>
            </div>
        </div>
    );
}
