import { apiFetch } from '@/lib/apiFetch';
import { API } from './apiCore';
import { requestStockQuote } from './stockQuoteRequest';
import { decodePriceHistory, type StockHistoryPayload } from './priceHistoryPayload';
export type { StockHistoryRow, StockHistoryPayload } from './priceHistoryPayload';

export type HistoryPeriod = '1Y' | '2Y' | '5Y' | 'ALL';
export type StockSummaryPayload = Record<string, any>;

// Keep intent prefetches small and bounded; only successful public snapshots live
// past the request. Live quotes keep their separate one-second freshness limit.
function snapshotResource<T extends { success?: boolean }>(ttl: number, normalize: (raw: unknown) => T | null = raw => raw as T) {
    const entries = new Map<string, { promise: Promise<T | null>; value?: T; completedAt?: number }>();
    function peek(key: string): T | undefined {
        const entry = entries.get(key);
        if (entry?.completedAt !== undefined && Date.now() - entry.completedAt >= ttl) {
            entries.delete(key);
            return undefined;
        }
        return entry?.value;
    }
    function request(key: string, url: string): Promise<T | null> {
        peek(key);
        const existing = entries.get(key);
        if (existing) return existing.promise;
        while (entries.size >= 20) entries.delete(entries.keys().next().value!);
        const entry: { promise: Promise<T | null>; value?: T; completedAt?: number } = {
            promise: apiFetch(url, { signal: AbortSignal.timeout(8000) })
                .then(response => response.ok ? response.json() : null)
                .then(normalize)
                .catch(() => null)
                .then(data => {
                    if (!data || data.success === false) {
                        if (entries.get(key) === entry) entries.delete(key);
                        return null;
                    }
                    entry.value = data as T;
                    entry.completedAt = Date.now();
                    return entry.value;
                }),
        };
        entries.set(key, entry);
        return entry.promise;
    }
    return { request, peek };
}

const summaries = snapshotResource<StockSummaryPayload>(30_000);
const histories = snapshotResource<StockHistoryPayload>(15_000, decodePriceHistory);
const ticker = (symbol: string) => symbol.trim().toUpperCase();
const historyKey = (symbol: string, period: HistoryPeriod) => `${ticker(symbol)}:${period}`;

export const peekStockSummary = (symbol: string) => summaries.peek(ticker(symbol));
export const requestStockSummary = (symbol: string) => summaries.request(ticker(symbol), `${API.STOCK_SUMMARY(symbol)}?realtime=0`);
export const peekStockHistory = (symbol: string, period: HistoryPeriod = '1Y') => histories.peek(historyKey(symbol, period));
export const requestStockHistory = (symbol: string, period: HistoryPeriod = '1Y') => histories.request(
    historyKey(symbol, period), `${API.PRICE_HISTORY(symbol)}?period=${period}&snapshot=1&format=columns`,
);

let chartCode: Promise<unknown> | undefined;

export function prefetchStockData(symbol: string): void {
    if (!/^[A-Z0-9]{1,10}$/.test(ticker(symbol))) return;
    void requestStockQuote(symbol);
    void requestStockSummary(symbol);
    void requestStockHistory(symbol);
    if (typeof window !== 'undefined') {
        chartCode ??= import('@/components/StockDetail/TradingViewChart').catch(() => { chartCode = undefined; });
    }
}
