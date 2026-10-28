import { apiFetch } from '@/lib/apiFetch';
import { API } from './apiCore';

interface OrderLevel { price?: number; volume?: number }
export interface StockQuotePayload {
    success?: boolean;
    current_price?: number;
    price?: number;
    price_change?: number;
    price_change_percent?: number;
    ref_price?: number;
    ref?: number;
    volume?: number;
    open?: number;
    high?: number;
    low?: number;
    ceiling?: number;
    floor?: number;
    priceHigh?: number;
    priceLow?: number;
    orderbook?: { bid?: OrderLevel[]; ask?: OrderLevel[] };
    data?: StockQuotePayload;
}

const MAX_AGE_MS = 1000;
const MAX_ENTRIES = 20;
const requests = new Map<string, {
    promise: Promise<StockQuotePayload | null>;
    completedAt?: number;
}>();

async function fetchQuote(key: string): Promise<StockQuotePayload | null> {
    const directUrl = API.STOCK_QUOTE(key);
    const proxyUrl = `/api/stocks/${encodeURIComponent(key)}/quote`;
    const usesDirectApi = directUrl !== proxyUrl;
    try {
        const response = await apiFetch(directUrl, {
            cache: 'no-store',
            credentials: 'omit',
            signal: AbortSignal.timeout(usesDirectApi ? 3000 : 8000),
        });
        // Do not retry client errors, especially rate limits, through another IP.
        if (response.ok) return await response.json() as StockQuotePayload;
        if (response.status < 500) return null;
    } catch {
        // Network, timeout, CORS or malformed responses can use the same-origin proxy.
    }
    if (!usesDirectApi) return null;
    try {
        const response = await apiFetch(proxyUrl, {
            cache: 'no-store', signal: AbortSignal.timeout(8000),
        });
        return response.ok ? await response.json() as StockQuotePayload : null;
    } catch {
        return null;
    }
}

/** Share an intent prefetch with navigation, keeping completed quotes for at most 1s. */
export function requestStockQuote(symbol: string): Promise<StockQuotePayload | null> {
    const key = symbol.trim().toUpperCase();
    const now = Date.now();
    for (const [ticker, item] of requests) {
        if (item.completedAt !== undefined && now - item.completedAt >= MAX_AGE_MS) {
            requests.delete(ticker);
        }
    }
    const existing = requests.get(key);
    if (existing) return existing.promise;
    while (requests.size >= MAX_ENTRIES) {
        requests.delete(requests.keys().next().value!);
    }
    const entry: { promise: Promise<StockQuotePayload | null>; completedAt?: number } = {
        promise: fetchQuote(key)
            .then(result => {
                entry.completedAt = Date.now();
                if (!result?.success && requests.get(key) === entry) requests.delete(key);
                return result;
            }),
    };
    requests.set(key, entry);
    return entry.promise;
}
