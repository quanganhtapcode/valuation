// All browser REST traffic uses the same-origin proxy. This centralizes
// caching, timeout and error behaviour, and avoids a browser dependency on
// backend CORS. WebSockets remain configured separately because Vercel cannot
// proxy WebSocket connections.
export const API_BASE = '/api';
export const REALTIME_API_BASE = API_BASE;

const stockSymbol = (symbol: string) => encodeURIComponent(symbol.trim().toUpperCase());

// Canonical resource URLs. Legacy URLs are supported only at the backend boundary.
export const API = {
    // Market Data
    PE_CHART: `${API_BASE}/market/index-valuations`,
    SCREENER: `${API_BASE}/market/screener`,
    VCI_INDICES: `${REALTIME_API_BASE}/market/indices`,
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
    MACRO_FIREANT_GDP: `${API_BASE}/market/macro/gdp`,
    MACRO_FIREANT: (types?: string) => types
        ? `${API_BASE}/market/macro/indicators?types=${types}`
        : `${API_BASE}/market/macro/indicators`,
    MARKET_EVENTS: (date: string) => `${API_BASE}/market/events?date=${date}`,
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
    STOCK_OVERVIEW_FULL: (symbol: string) => `${REALTIME_API_BASE}/stocks/${stockSymbol(symbol)}/overview`,
    APP_DATA: (symbol: string) => `${API_BASE}/app-data/${stockSymbol(symbol)}?fetch_price=true`,
    CURRENT_PRICE: (symbol: string) => `${REALTIME_API_BASE}/stocks/${stockSymbol(symbol)}/quote`,
    PRICE: (symbol: string) => `${API_BASE}/stocks/${stockSymbol(symbol)}/quote`,
    HISTORICAL_CHART: (symbol: string) => `${API_BASE}/stocks/${stockSymbol(symbol)}/chart-data`,
    STOCK_HISTORY: (symbol: string) => `${API_BASE}/stocks/${stockSymbol(symbol)}/price-history`,
    COMPANY_PROFILE: (symbol: string) => `${API_BASE}/companies/${stockSymbol(symbol)}/profile`,
    NEWS_STOCK: (symbol: string) => `${API_BASE}/stocks/${stockSymbol(symbol)}/news`,
    EVENTS: (symbol: string) => `${API_BASE}/stocks/${stockSymbol(symbol)}/events`,

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
        const response = await fetch(resolvedUrl, {
            ...options,
            headers,
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
