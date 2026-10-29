'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { isTradingHours, fetchTopMovers, fetchGoldPrices, fetchNews, type NewsItem, type TopMoverItem, type GoldPriceItem } from '@/lib/api';
import { useVisiblePolling } from '@/hooks/useVisiblePolling';
import DeferredPanel from '@/components/ui/DeferredPanel';

const moversDelay = () => isTradingHours() ? 30000 : 300000;
const newsDelay = () => 120000;

export function PanelSkeleton({ height = 'h-48' }: { height?: string }) {
    return <div aria-hidden="true" className={`rounded-lg border border-slate-200 bg-slate-100 animate-pulse motion-reduce:animate-none dark:border-slate-800 dark:bg-slate-800/60 ${height}`} />;
}

const TradingViewForexTable = dynamic(() => import('@/components/Macro/TradingViewForexTable'), {
    loading: () => <PanelSkeleton height="h-80" />,
});
const NewsSection = dynamic(() => import('@/components/NewsSection'), {
    loading: () => <PanelSkeleton height="h-80" />,
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

export function NewsPanel({ initialNews, initialNewsFetchedAt }: { initialNews: NewsItem[]; initialNewsFetchedAt: number }) {
    const [news, setNews] = useState(initialNews);
    const [loading, setLoading] = useState(initialNews.length === 0);
    const [error, setError] = useState<string | null>(null);
    const refresh = useCallback(async () => {
        try {
            setError(null);
            setNews(await fetchNews(1, 30));
        } catch (error) {
            console.error('Error loading market news:', error);
            setError('Unable to refresh market news');
        } finally {
            setLoading(false);
        }
    }, []);
    useVisiblePolling(refresh, newsDelay, initialNews.length === 0, initialNewsFetchedAt);
    return <NewsSection news={news} isLoading={loading} error={error} />;
}

export function GoldPanel({ initialGoldPrices, initialGoldSource, initialGoldStale, initialGoldFetchedAt }: {
    initialGoldPrices: GoldPriceItem[]; initialGoldSource: string; initialGoldStale: boolean; initialGoldFetchedAt: number;
}) {
    const [goldPrices, setGoldPrices] = useState(initialGoldPrices);
    const [goldSource, setGoldSource] = useState(initialGoldSource);
    const [goldStale, setGoldStale] = useState(initialGoldStale);
    const goldNeedsRefresh = useRef(initialGoldPrices.length === 0 || initialGoldStale);
    const goldDelay = useCallback(() => goldNeedsRefresh.current ? 5_000 : 60_000, []);
    const loadGold = useCallback(async () => {
        try {
            const result = await fetchGoldPrices();
            setGoldPrices(result.data);
            setGoldStale(Boolean(result.stale));
            goldNeedsRefresh.current = Boolean(result.stale);
            if (result.source) setGoldSource(result.source);
        } catch (error) {
            goldNeedsRefresh.current = true;
            console.error('Error loading gold prices:', error);
            setGoldStale(true);
        }
    }, []);

    useVisiblePolling(loadGold, goldDelay, initialGoldPrices.length === 0, initialGoldFetchedAt);
    return <GoldPrice prices={goldPrices} isLoading={false} source={goldSource} stale={goldStale} />;
}

export function MoversPanel({ initialGainers, initialLosers, initialMoversFetchedAt }: {
    initialGainers: TopMoverItem[]; initialLosers: TopMoverItem[]; initialMoversFetchedAt: number;
}) {
    const [gainers, setGainers] = useState(initialGainers);
    const [losers, setLosers] = useState(initialLosers);
    const [moversLoading, setMoversLoading] = useState(initialGainers.length === 0 && initialLosers.length === 0);
    const moversInFlightRef = useRef(false);
    const gainersRef = useRef(initialGainers);
    const losersRef = useRef(initialLosers);
    useEffect(() => { gainersRef.current = gainers; }, [gainers]);
    useEffect(() => { losersRef.current = losers; }, [losers]);
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

    useVisiblePolling(loadMovers, moversDelay, initialGainers.length === 0 || initialLosers.length === 0, initialMoversFetchedAt);
    return <DeferredPanel height={256}><MarketPulse gainers={gainers} losers={losers} isLoading={moversLoading} /></DeferredPanel>;
}

export function OverviewWidgets() {
    return <>
        <DeferredPanel><FFWorldMarkets /></DeferredPanel>
        <DeferredPanel><CryptoPrices /></DeferredPanel>
    </>;
}

export function OverviewWatchlist() {
    return <DeferredPanel height={208}><WatchlistCard /></DeferredPanel>;
}

export function OverviewEarnings() {
    return <DeferredPanel height={288}><EarningsSeason /></DeferredPanel>;
}

export function OverviewForex() {
    return <section className="mt-4" aria-label="TradingView forex rates"><DeferredPanel height={360}><TradingViewForexTable /></DeferredPanel></section>;
}

export function OverviewPredictions() {
    return <DeferredPanel height={480}><PolymarketEvents /></DeferredPanel>;
}
