'use client';

import { useCallback, useEffect, useState } from 'react';
// Keep the index chart in the initial render for the above-the-fold content.
import HeroIndexCard from '@/components/HeroIndexCard';
import {
    fetchAllIndices,
    subscribeIndicesStream,
    isTradingHours,
    PRICE_SYNC_INTERVAL_MS,
    IDLE_REFRESH_INTERVAL_MS,
    INDEX_MAP,
    type MarketIndexData,
} from '@/lib/api';

export interface OverviewIndexData {
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

const PLACEHOLDER_INDICES: { id: string; name: string }[] = Object.entries(INDEX_MAP).map(([, info]) => ({
    id: info.id,
    name: info.name,
}));

// Keep live quote updates local so the rest of the dashboard does not re-render
// for every market-index snapshot.
export default function MarketIndices({ initialIndices }: { initialIndices: OverviewIndexData[] }) {
    const [indices, setIndices] = useState(initialIndices);

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
                    id: info.id, name: info.name, value: currentIndex, change, percentChange: percent,
                    chartData: [] as number[], advances: data.Advances, declines: data.Declines,
                    noChanges: data.NoChanges, ceilings: data.Ceilings, floors: data.Floors,
                    totalShares: data.Volume, totalValue: data.Value,
                };
            })
            .filter((r): r is OverviewIndexData => r !== null);
        setIndices(results);
    }, []);

    // A connected socket does not guarantee a snapshot. Bound the initial wait
    // and fetch immediately on failure instead of waiting a full polling cycle.
    useEffect(() => {
        let disposed = false;
        let streamVersion = 0;
        let fallbackRunning = false;
        let fallbackTimer: ReturnType<typeof setInterval> | null = null;
        let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
        const refreshFallback = async () => {
            if (disposed || fallbackRunning || document.visibilityState !== 'visible') return;
            fallbackRunning = true;
            const version = streamVersion;
            try {
                const marketData = await fetchAllIndices();
                // A late HTTP response must not overwrite a newer live snapshot.
                if (!disposed && version === streamVersion) mapMarketDataToIndices(marketData);
            } catch (error) {
                console.error('Error loading indices:', error);
            } finally {
                fallbackRunning = false;
            }
        };
        const startFallback = () => {
            if (disposed || fallbackTimer) return;
            void refreshFallback();
            fallbackTimer = setInterval(() => { void refreshFallback(); },
                isTradingHours() ? PRICE_SYNC_INTERVAL_MS : IDLE_REFRESH_INTERVAL_MS);
        };
        const stopFallback = () => {
            if (snapshotTimer) clearTimeout(snapshotTimer);
            if (fallbackTimer) clearInterval(fallbackTimer);
            snapshotTimer = null;
            fallbackTimer = null;
        };
        snapshotTimer = setTimeout(startFallback, 1500);
        const unsubscribe = subscribeIndicesStream({
            onData: (marketData) => {
                if (!Object.values(marketData).some(data => data.CurrentIndex > 0)) return;
                streamVersion += 1;
                mapMarketDataToIndices(marketData);
                stopFallback();
            },
            onStatus: (status) => {
                if (status !== 'open') startFallback();
            },
        });
        const onVisibility = () => {
            if (fallbackTimer) void refreshFallback();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            disposed = true;
            unsubscribe();
            stopFallback();
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [mapMarketDataToIndices]);

    return (
        <HeroIndexCard
            indices={PLACEHOLDER_INDICES.map((placeholder) => {
                const data = indices.find(d => d.id === placeholder.id);
                return {
                    id: placeholder.id, name: placeholder.name,
                    value: data?.value ?? 0, change: data?.change ?? 0,
                    percentChange: data?.percentChange ?? 0,
                    advances: data?.advances, declines: data?.declines,
                    noChanges: data?.noChanges, ceilings: data?.ceilings,
                    floors: data?.floors, totalShares: data?.totalShares,
                    totalValue: data?.totalValue,
                };
            })}
        />
    );
}
