import { apiUrl } from '@/lib/apiCore';
let cachedTickers: any = null;
let pendingTickers: Promise<any> | null = null;

export async function getTickerData() {
    if (cachedTickers) return cachedTickers;
    if (pendingTickers) return pendingTickers;

    // Navbar, watchlist and search can request the same directory simultaneously.
    pendingTickers = (async () => {
        try {
            const response = await fetch(apiUrl('/tickers'));
            if (response.ok) {
                cachedTickers = await response.json();
                return cachedTickers;
            }
        } catch (e) {
            console.error('Error loading ticker cache:', e);
        }
        return null;
    })();
    try {
        return await pendingTickers;
    } finally {
        pendingTickers = null;
    }
}
