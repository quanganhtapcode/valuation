'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

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

export function WatchlistProvider({ children }: { children: ReactNode }) {
    const [watchlist, setWatchlist] = useState<string[]>([]);

    // Load from localStorage on client mount
    useEffect(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('watchlist') || '[]');
            if (Array.isArray(saved)) setWatchlist(saved);
        } catch { /* ignore corrupt data */ }
    }, []);

    const toggle = useCallback((symbol: string) => {
        setWatchlist(prev => {
            const next = prev.includes(symbol)
                ? prev.filter(s => s !== symbol)
                : [...prev, symbol];
            localStorage.setItem('watchlist', JSON.stringify(next));
            return next;
        });
    }, []);

    const removeSymbol = useCallback((symbol: string) => {
        setWatchlist(prev => {
            const next = prev.filter(s => s !== symbol);
            localStorage.setItem('watchlist', JSON.stringify(next));
            return next;
        });
    }, []);

    const isWatched = useCallback((symbol: string) => watchlist.includes(symbol), [watchlist]);

    return (
        <WatchlistContext.Provider value={{ watchlist, toggle, isWatched, removeSymbol }}>
            {children}
        </WatchlistContext.Provider>
    );
}

export function useWatchlist() {
    return useContext(WatchlistContext);
}
