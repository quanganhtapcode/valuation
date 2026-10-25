const STORAGE_KEY = 'watchlist';

export function normalizeWatchlist(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
        .filter((symbol): symbol is string => typeof symbol === 'string')
        .map(symbol => symbol.trim().toUpperCase())
        .filter(symbol => /^[A-Z0-9]{2,10}$/.test(symbol)))];
}

export function loadWatchlist(): string[] {
    try {
        return normalizeWatchlist(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
    } catch {
        return [];
    }
}

export function saveWatchlist(watchlist: string[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist));
    } catch {
        // In-memory changes remain usable when browser storage is unavailable.
    }
}
