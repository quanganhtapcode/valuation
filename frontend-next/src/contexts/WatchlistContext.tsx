'use client';

import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { loadWatchlist, normalizeWatchlist, saveWatchlist } from '@/lib/watchlistStorage';

interface WatchlistContextType {
    watchlist: string[];
    toggle: (symbol: string) => void;
    isWatched: (symbol: string) => boolean;
    removeSymbol: (symbol: string) => void;
}

const WatchlistContext = createContext<WatchlistContextType>({
    watchlist: [],
    toggle: () => {},
    isWatched: () => false,
    removeSymbol: () => {},
});

const EMPTY_WATCHLIST: string[] = [];

export function WatchlistProvider({ children }: { children: ReactNode }) {
    const [savedWatchlist, setWatchlist] = useState<string[] | null>(null);
    const watchlist = savedWatchlist ?? EMPTY_WATCHLIST;

    // Load from localStorage on client mount
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setWatchlist(loadWatchlist());
    }, []);

    useEffect(() => {
        if (savedWatchlist !== null) saveWatchlist(savedWatchlist);
    }, [savedWatchlist]);

    const toggle = useCallback((symbol: string) => {
        const ticker = normalizeWatchlist([symbol])[0];
        if (!ticker) return;
        setWatchlist(prev => {
            const current = prev ?? EMPTY_WATCHLIST;
            return current.includes(ticker)
                ? current.filter(s => s !== ticker)
                : [...current, ticker];
        });
    }, []);

    const removeSymbol = useCallback((symbol: string) => {
        const ticker = normalizeWatchlist([symbol])[0];
        if (!ticker) return;
        setWatchlist(prev => prev?.filter(s => s !== ticker) ?? EMPTY_WATCHLIST);
    }, []);

    const isWatched = useCallback((symbol: string) => watchlist.includes(symbol.trim().toUpperCase()), [watchlist]);
    const value = useMemo(() => ({ watchlist, toggle, isWatched, removeSymbol }), [watchlist, toggle, isWatched, removeSymbol]);

    return (
        <WatchlistContext.Provider value={value}>
            {children}
        </WatchlistContext.Provider>
    );
}

export function useWatchlist() {
    return useContext(WatchlistContext);
}
