import { apiFetch } from './apiFetch';
import { API_BASE, REALTIME_API_BASE } from './apiConfig';
export { API_BASE, REALTIME_API_BASE, apiUrl, resolveApiLink } from './apiConfig';

const stockSymbol = (symbol: string) => encodeURIComponent(symbol.trim().toUpperCase());

// Canonical resource URLs. Legacy URLs are supported only at the backend boundary.
export const API = {
    // Market Data
    INDEX_VALUATIONS: `${API_BASE}/market/index-valuations`,
    SCREENER: `${API_BASE}/market/screener`,
    INDICES: `${REALTIME_API_BASE}/market/indices`,
    NEWS: `${API_BASE}/market/news`,
    TOP_MOVERS: `${REALTIME_API_BASE}/market/top-movers`,
    FOREIGN_FLOW: `${API_BASE}/market/foreign-flow`,
    FOREIGN_NET_VALUE: `${API_BASE}/market/foreign-net-value`,
    FOREIGN_VOLUME_CHART: `${API_BASE}/market/foreign-volume-chart`,
    GOLD: `${API_BASE}/market/gold`,
    POLYMARKET_EVENTS: `${API_BASE}/market/polymarket-events`,
    LOTTERY: `${API_BASE}/market/lottery`,
    EARNINGS_SEASON: `${API_BASE}/market/earnings-season`,
    AI_TAKEAWAYS: `${API_BASE}/market/ai-takeaways`,
    STOCK_AI_ANALYSIS: (symbol: string) => `${API_BASE}/stocks/${stockSymbol(symbol)}/ai-analysis`,
    MACRO_RATES: `${API_BASE}/market/macro/rates`,
    MACRO_ECONOMIC: `${API_BASE}/market/macro/economic`,
    GDP: `${API_BASE}/market/macro/gdp`,
    MACRO_INDICATORS: (types?: string) => types
        ? `${API_BASE}/market/macro/indicators?types=${types}`
        : `${API_BASE}/market/macro/indicators`,
    MARKET_EVENTS: (date: string) => `${API_BASE}/market/events?date=${date}`,
    MARKET_EVENTS_RANGE: (fromDate: string, toDate: string) =>
        `${API_BASE}/market/events?fromDate=${fromDate}&toDate=${toDate}`,
    MARKET_EVENTS_EXPORT: (fromDate: string, toDate: string) =>
        `${API_BASE}/market/events/export?fromDate=${fromDate}&toDate=${toDate}`,
    MACRO_HISTORY: (symbol: string, days: number) =>
        `${API_BASE}/market/macro/history?symbol=${encodeURIComponent(symbol)}&days=${days}`,
    MACRO_HISTORY_FULL: (symbol: string) =>
        `${API_BASE}/market/macro/history?symbol=${encodeURIComponent(symbol)}&full=1`,
    MACRO_HISTORY_BATCH: (symbols: string[], days: number) =>
        `${API_BASE}/market/macro/history/batch?symbols=${symbols.map(encodeURIComponent).join(',')}&days=${days}`,

    // Stock resources
    STOCK: (symbol: string) => `${API_BASE}/stocks/${stockSymbol(symbol)}?fetch_price=true`,
    STOCK_SUMMARY: (symbol: string) => `${API_BASE}/stocks/${stockSymbol(symbol)}/summary`,
    STOCK_PROFILE: (symbol: string) => `${API_BASE}/stocks/${stockSymbol(symbol)}/profile`,
    STOCK_RATIO_HISTORY: (symbol: string) => `${API_BASE}/stocks/${stockSymbol(symbol)}/ratio-history`,
    STOCK_RATIO_SERIES: (symbol: string) => `${API_BASE}/stocks/${stockSymbol(symbol)}/ratio-series`,
    STOCK_OVERVIEW: (symbol: string) => `${REALTIME_API_BASE}/stocks/${stockSymbol(symbol)}/overview`,
    STOCK_QUOTE: (symbol: string) => `${API_BASE}/stocks/${stockSymbol(symbol)}/quote`,
    STOCK_CHART: (symbol: string) => `${API_BASE}/stocks/${stockSymbol(symbol)}/chart-data`,
    PRICE_HISTORY: (symbol: string) => `${API_BASE}/stocks/${stockSymbol(symbol)}/price-history`,
    COMPANY_PROFILE: (symbol: string) => `${API_BASE}/companies/${stockSymbol(symbol)}/profile`,
    STOCK_NEWS: (symbol: string) => `${API_BASE}/stocks/${stockSymbol(symbol)}/news`,
    STOCK_EVENTS: (symbol: string) => `${API_BASE}/stocks/${stockSymbol(symbol)}/events`,
    STOCK_TECHNICAL: (symbol: string, timeframe = '1d') =>
        `${API_BASE}/stocks/${stockSymbol(symbol)}/technical?timeframe=${encodeURIComponent(timeframe)}&compact=1`,

    // Valuation
    VALUATION: (symbol: string) => `${API_BASE}/stocks/${stockSymbol(symbol)}/valuation`,

    // Utilities
    TICKERS: `${API_BASE}/tickers`,
    HEALTH: `${API_BASE}/health`,
} as const;

/**
 * Generic fetch wrapper with error handling.
 */
export class ApiRequestError extends Error {
    constructor(public readonly status: number, public readonly code: string, message: string) {
        super(message);
        this.name = 'ApiRequestError';
    }
}

export async function fetchAPI<T>(url: string, options?: RequestInit): Promise<T> {
    try {
        const resolvedUrl =
            typeof window === 'undefined' && url.startsWith('/')
                ? new URL(
                    url,
                    process.env.NEXT_PUBLIC_SITE_URL ||
                    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'),
                ).toString()
                : url;

        const headers = new Headers(options?.headers);
        headers.set('Accept', 'application/json');
        if (options?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
        const response = await apiFetch(resolvedUrl, {
            ...options,
            headers,
            signal: options?.signal ?? AbortSignal.timeout(20_000),
        });

        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new ApiRequestError(response.status,
                payload?.error?.code || 'REQUEST_FAILED',
                payload?.error?.message || `API Error: ${response.status} ${response.statusText}`);
        }

        return response.json();
    } catch (error) {
        // Aborting an in-flight request is expected when a component unmounts,
        // a filter changes, or navigation starts. Keep the rejection so callers
        // can stop their own work, but do not report normal cleanup as an error.
        if (!(error instanceof Error && error.name === 'AbortError')) {
            console.error(`Fetch error for ${url}:`, error);
        }
        throw error;
    }
}
