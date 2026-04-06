'use client';

import { useState, useEffect, useCallback } from 'react';
import IndexCard from '@/components/IndexCard';
import PEChart from '@/components/PEChart';
import NewsSection from '@/components/NewsSection';

import { CryptoPrices, FFWorldMarkets, FFForexRates, GoldPrice, Lottery, MarketPulse, WatchlistCard } from '@/components/Sidebar';
import { HeatmapVN30 } from '@/components/HeatmapVN30';
import { useWatchlist } from '@/lib/watchlistContext';
import {
    fetchAllIndices,
    subscribeIndicesStream,
    isTradingHours,
    fetchOverviewRefresh,
    PRICE_SYNC_INTERVAL_MS,
    IDLE_REFRESH_INTERVAL_MS,
    fetchTopMovers,
    fetchGoldPrices,
    INDEX_MAP,
    MarketIndexData,
    NewsItem,
    TopMoverItem,
    GoldPriceItem,
    PEChartData
} from '@/lib/api';
import styles from './page.module.css';

// Static placeholders — card slots reserved before data arrives
const PLACEHOLDER_INDICES: { id: string; name: string }[] = Object.entries(INDEX_MAP).map(([, info]) => ({
    id: info.id,
    name: info.name,
}));

interface IndexData {
    id: string;
    name: string;
    value: number;
    change: number;
    percentChange: number;
    chartData: number[];
    advances: number | undefined;
    declines: number | undefined;
    noChanges: number | undefined;
    ceilings: number | undefined;
    floors: number | undefined;
    totalShares: number | undefined;
    totalValue: number | undefined;
}

interface OverviewClientProps {
    initialIndices: IndexData[];
    initialNews: NewsItem[];
    initialGainers: TopMoverItem[];
    initialLosers: TopMoverItem[];
    initialGoldPrices: GoldPriceItem[];
    initialGoldUpdated?: string;
    initialPEData: PEChartData[];
}

export default function OverviewClient({
    initialIndices,
    initialNews,
    initialGainers,
    initialLosers,
    initialGoldPrices,
    initialGoldUpdated,
    initialPEData
}: OverviewClientProps) {

    // State for indices
    const [indices, setIndices] = useState<IndexData[]>(initialIndices);

    // State for news
    const [news, setNews] = useState<NewsItem[]>(initialNews);
    const [newsLoading, setNewsLoading] = useState(initialNews.length === 0);
    const [newsError, setNewsError] = useState<string | null>(null);
    const [livePEData, setLivePEData] = useState<PEChartData[]>(initialPEData);
    const [liveHeatmapData, setLiveHeatmapData] = useState<any>(null);
    const [watchlistPrices, setWatchlistPrices] = useState<Record<string, { price: number; changePercent: number }>>({});

    // State for top movers
    const [gainers, setGainers] = useState<TopMoverItem[]>(initialGainers);
    const [losers, setLosers] = useState<TopMoverItem[]>(initialLosers);
    const [moversLoading, setMoversLoading] = useState(false);

    // State for gold prices
    const [goldPrices, setGoldPrices] = useState<GoldPriceItem[]>(initialGoldPrices);
    const [goldLoading] = useState(false);
    const [goldUpdatedAt, setGoldUpdatedAt] = useState<string>(initialGoldUpdated || new Date().toISOString());
    const [goldSource, setGoldSource] = useState<string>('Phú Quý');
    const { watchlist } = useWatchlist();

    const mapMarketDataToIndices = useCallback((marketData: Record<string, MarketIndexData>) => {
        const results = Object.entries(INDEX_MAP)
            .map(([indexId, info]) => {
                const data = marketData[indexId] as MarketIndexData | undefined;
                if (!data) return null;

                const currentIndex = data.CurrentIndex;
                const prevIndex = data.PrevIndex;
                const change = currentIndex - prevIndex;
                const percent = prevIndex > 0 ? (change / prevIndex) * 100 : 0;

                return {
                    id: info.id,
                    name: info.name,
                    value: currentIndex,
                    change,
                    percentChange: percent,
                    chartData: [] as number[],
                    advances: data.Advances,
                    declines: data.Declines,
                    noChanges: data.NoChanges,
                    ceilings: data.Ceilings,
                    floors: data.Floors,
                    totalShares: data.Volume,
                    totalValue: data.Value,
                };
            })
            .filter((r): r is IndexData => r !== null);

        setIndices(results);
    }, []);

    // Load indices data (Client-side Refresh)
    const loadIndices = useCallback(async () => {
        try {
            // Don't set loading to true for background refresh to avoid flickering
            const marketData = await fetchAllIndices();
            mapMarketDataToIndices(marketData);
        } catch (error) {
            console.error('Error loading indices:', error);
        }
    }, [mapMarketDataToIndices]);

    // Load gold prices (Client-side Refresh)
    const loadGold = useCallback(async () => {
        try {
            const result = await fetchGoldPrices();
            setGoldPrices(result.data);
            if (result.updated_at) {
                setGoldUpdatedAt(result.updated_at);
            }
            if (result.source) {
                setGoldSource(result.source);
            }
        } catch (error) {
            console.error('Error loading gold prices:', error);
        }
    }, []);

    const loadOverviewSnapshot = useCallback(async () => {
        try {
            setNewsError(null);
            const snapshot = await fetchOverviewRefresh({
                symbols: watchlist,
                newsSize: 30,
                heatmapLimit: 200,
                heatmapExchange: 'HSX',
                peTimeFrame: '6M',
            });

            setNews(snapshot.news);
            setLivePEData(snapshot.peData);
            setLiveHeatmapData(snapshot.heatmap);

            const nextPrices: Record<string, { price: number; changePercent: number }> = {};
            Object.entries(snapshot.watchlistPrices || {}).forEach(([symbol, snap]) => {
                nextPrices[symbol] = {
                    price: snap?.price || 0,
                    changePercent: snap?.changePercent || 0,
                };
            });
            setWatchlistPrices(nextPrices);
        } catch (error) {
            console.error('Error loading overview snapshot:', error);
            setNewsError('Unable to refresh overview data');
        } finally {
            setNewsLoading(false);
        }
    }, [watchlist]);

    const loadMovers = useCallback(async () => {
        try {
            setMoversLoading(true);
            const [up, down] = await Promise.all([
                fetchTopMovers('UP'),
                fetchTopMovers('DOWN'),
            ]);
            setGainers(up);
            setLosers(down);
        } catch (error) {
            console.error('Error loading top movers:', error);
        } finally {
            setMoversLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!initialGoldPrices || initialGoldPrices.length === 0) {
            loadGold();
        }
    }, [initialGoldPrices, loadGold]);

    useEffect(() => {
        let isCancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const schedule = () => {
            if (isCancelled) return;
            const delay = isTradingHours() ? PRICE_SYNC_INTERVAL_MS : IDLE_REFRESH_INTERVAL_MS;
            timer = setTimeout(async () => {
                await loadOverviewSnapshot();
                schedule();
            }, delay);
        };

        loadOverviewSnapshot().finally(schedule);

        return () => {
            isCancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [loadOverviewSnapshot]);

    useEffect(() => {
        if (!initialGainers || !initialLosers || initialGainers.length === 0 || initialLosers.length === 0) {
            loadMovers();
        }
    }, [initialGainers, initialLosers, loadMovers]);

    // Periodic refresh for movers with realtime cadence.
    useEffect(() => {
        if (!isTradingHours()) return;
        const interval = setInterval(() => {
            loadMovers();
        }, PRICE_SYNC_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [loadMovers]);

    const initialIndicesLength = initialIndices?.length ?? 0;

    // Realtime indices via internal websocket; fallback polling only when WS is down
    useEffect(() => {
        let fallbackTimer: ReturnType<typeof setInterval> | null = null;

        const startFallback = () => {
            if (fallbackTimer) return;
            // During trading hours refresh every 3 s; outside hours every 60 s
            fallbackTimer = setInterval(() => {
                loadIndices();
            }, isTradingHours() ? PRICE_SYNC_INTERVAL_MS : IDLE_REFRESH_INTERVAL_MS);
        };

        const stopFallback = () => {
            if (!fallbackTimer) return;
            clearInterval(fallbackTimer);
            fallbackTimer = null;
        };

        const unsubscribe = subscribeIndicesStream({
            onData: (marketData) => {
                mapMarketDataToIndices(marketData);
                stopFallback();
            },
            onStatus: (status) => {
                if (status === 'open') {
                    stopFallback();
                    return;
                }
                startFallback();
            },
        });

        return () => {
            unsubscribe();
            stopFallback();
        };
    }, [loadIndices, initialIndicesLength, mapMarketDataToIndices]);

    // Auto refresh gold every 60 seconds
    useEffect(() => {
        const interval = setInterval(() => {
            loadGold();
        }, 60000);
        return () => clearInterval(interval);
    }, [loadGold]);

    return (
        <div className={styles.container}>
            <div className={styles.mainContent}>
                {/* Left Column - Main Content */}
                <div className={styles.leftColumn}>

                    {/* Indices Grid - 2x2 layout, no title */}
                    <div className={styles.indicesGrid}>
                        {/* Always render 4 cards — skeleton shows immediately, data fills in */}
                        {PLACEHOLDER_INDICES.map((placeholder) => {
                            const data = indices.find(d => d.id === placeholder.id);
                            return (
                                <IndexCard
                                    key={placeholder.id}
                                    id={placeholder.id}
                                    name={placeholder.name}
                                    value={data?.value ?? 0}
                                    change={data?.change ?? 0}
                                    percentChange={data?.percentChange ?? 0}
                                    chartData={data?.chartData ?? []}
                                    advances={data?.advances ?? 0}
                                    declines={data?.declines ?? 0}
                                    noChanges={data?.noChanges ?? 0}
                                    ceilings={data?.ceilings ?? 0}
                                    floors={data?.floors ?? 0}
                                    totalShares={data?.totalShares ?? 0}
                                    totalValue={data?.totalValue ?? 0}
                                    isLoading={!data}
                                />
                            );
                        })}
                    </div>



                    {/* VN30 Heatmap */}
                    <HeatmapVN30 externalData={liveHeatmapData} useExternalOnly />

                    {/* P/E Chart */}
                    <div className="order-1">
                        <PEChart initialData={initialPEData} externalData={livePEData} useExternalOnly />
                    </div>

                    {/* News Section */}
                    <div className="order-2">
                        <NewsSection
                            news={news}
                            isLoading={newsLoading}
                            error={newsError}
                        />
                    </div>
                </div>

                {/* Right Column - Sidebar */}
                <aside className={styles.rightColumn}>
                    {/* Watchlist */}
                    <WatchlistCard externalPrices={watchlistPrices} useExternalOnly />

                    {/* Market Pulse (Combined Top Movers & Foreign Flow) */}
                    <MarketPulse
                        gainers={gainers}
                        losers={losers}
                        isLoading={moversLoading}
                    />

                    {/* World Markets (FF WebSocket) */}
                    <FFWorldMarkets />

                    {/* Forex Rates (FF WebSocket) */}
                    <FFForexRates />

                    {/* Crypto Prices (OKX WebSocket) */}
                    <CryptoPrices />

                    {/* Gold Prices */}
                    <GoldPrice
                        prices={goldPrices}
                        isLoading={goldLoading}
                        updatedAt={goldUpdatedAt}
                        source={goldSource}
                    />

                    {/* Lottery Results */}
                    <Lottery />

                    <p className="px-1 text-[11px] leading-relaxed text-justify text-gray-400 dark:text-gray-500">
                        Market and company data is aggregated from sources including Vietcap, Yahoo Finance, SBV (State Bank of Vietnam), Polymarket, and other relevant public sources. All data is provided for informational purposes only and is not intended for trading purposes or as financial, investment, tax, legal, accounting, or other professional advice.
                    </p>
                </aside>
            </div>
        </div>
    );
}
