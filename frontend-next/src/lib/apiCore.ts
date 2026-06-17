// API Base URL - prefer same-origin proxy (/api) for consistent caching/CORS.
// Can be overridden via NEXT_PUBLIC_API_URL environment variable.
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

export const REALTIME_API_BASE =
    process.env.NEXT_PUBLIC_REALTIME_API_URL ||
    process.env.NEXT_PUBLIC_BACKEND_API_URL ||
    'https://api.quanganh.org/v1/valuation';

// API Endpoints
export const API = {
    // Market Data
    PE_CHART: `${API_BASE}/market/pe-chart`,
    EMA50_BREADTH: `${API_BASE}/market/ema50-breadth`,
    SCREENER: `${API_BASE}/market/screener`,
    VCI_INDICES: `${REALTIME_API_BASE}/market/vci-indices`,
    NEWS: `${API_BASE}/market/news`,
    TOP_MOVERS: `${REALTIME_API_BASE}/market/top-movers`,
    FOREIGN_FLOW: `${API_BASE}/market/foreign-flow`,
    FOREIGN_NET_VALUE: `${API_BASE}/market/foreign-net-value`,
    FOREIGN_VOLUME_CHART: `${API_BASE}/market/foreign-volume-chart`,
    GOLD: `${API_BASE}/market/gold`,
    LOTTERY: `${API_BASE}/market/lottery`,
    EARNINGS_SEASON: `${API_BASE}/market/earnings-season`,
    STOCK_AI_ANALYSIS: (symbol: string) => `${API_BASE}/${symbol}/ai-analysis`,
    MACRO_RATES: `${API_BASE}/market/macro/rates`,
    MACRO_ECONOMIC: `${API_BASE}/market/macro/economic`,
    MACRO_FIREANT_GDP: `${API_BASE}/market/macro/fireant-gdp`,
    MACRO_FIREANT: (types?: string) => types
        ? `${API_BASE}/market/macro/fireant?types=${types}`
        : `${API_BASE}/market/macro/fireant`,
    MARKET_EVENTS: (date: string) => `${API_BASE}/market/events?date=${date}`,
    MARKET_EVENTS_EXPORT: (fromDate: string, toDate: string) =>
        `${API_BASE}/market/events/export?fromDate=${fromDate}&toDate=${toDate}`,
    MACRO_HISTORY: (symbol: string, days: number) =>
        `${API_BASE}/market/macro/history?symbol=${encodeURIComponent(symbol)}&days=${days}`,

    // Stock Data (VCI Source via vnstock)
    STOCK: (symbol: string) => `${API_BASE}/stock/${symbol}?fetch_price=true`,
    STOCK_SUMMARY: (symbol: string) => `${API_BASE}/stock/${symbol}/summary`,
    STOCK_PROFILE: (symbol: string) => `${API_BASE}/stock/${symbol}/profile`,
    STOCK_RATIO_HISTORY: (symbol: string) => `${API_BASE}/stock/${symbol}/ratio-history`,
    STOCK_RATIO_SERIES: (symbol: string) => `${API_BASE}/stock/${symbol}/ratio-series`,
    STOCK_OVERVIEW_FULL: (symbol: string) => `${REALTIME_API_BASE}/stock/${symbol}/overview-full`,
    APP_DATA: (symbol: string) => `${API_BASE}/app-data/${symbol}?fetch_price=true`,
    CURRENT_PRICE: (symbol: string) => `${REALTIME_API_BASE}/stock/${symbol}/current-price`,
    PRICE: (symbol: string) => `${API_BASE}/price/${symbol}`,
    HISTORICAL_CHART: (symbol: string) => `${API_BASE}/historical-chart-data/${symbol}`,
    STOCK_HISTORY: (symbol: string) => `${API_BASE}/stock/history/${symbol}`,
    COMPANY_PROFILE: (symbol: string) => `${API_BASE}/company/profile/${symbol}`,
    NEWS_STOCK: (symbol: string) => `${API_BASE}/news/${symbol}`,
    EVENTS: (symbol: string) => `${API_BASE}/events/${symbol}`,

    // Valuation
    VALUATION: (symbol: string) => `${API_BASE}/valuation/${symbol}`,

    // Utilities
    TICKERS: `${API_BASE}/tickers`,
    HEALTH: `${API_BASE}/health`,
} as const;

/**
 * Generic fetch wrapper with error handling.
 */
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

        const response = await fetch(resolvedUrl, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options?.headers,
            },
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        return response.json();
    } catch (error) {
        console.error(`Fetch error for ${url}:`, error);
        throw error;
    }
}
