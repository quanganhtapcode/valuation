import { API, API_BASE, fetchAPI } from './apiCore';
import type { NewsItem } from './newsApi';
import { parsePEChartPayload, type PEChartData } from './valuationChartApi';

export interface TopMoverItem {
    Symbol: string;
    CompanyName: string;
    CurrentPrice: number;
    ChangePricePercent: number;
    Exchange?: string;
    Value?: number;
}

export interface WatchlistPriceSnapshot {
    price: number;
    refPrice: number;
    change: number;
    changePercent: number;
    volume?: number;
}

export interface OverviewRefreshData {
    success: boolean;
    serverTs: number;
    watchlistPrices: Record<string, WatchlistPriceSnapshot>;
    peChart: any;
    news: NewsItem[];
    heatmap: any;
}

/**
 * Fetch top movers (gainers/losers)
 */
export async function fetchTopMovers(type: 'UP' | 'DOWN', centerID: string = 'HOSE'): Promise<TopMoverItem[]> {
    interface TopMoversResponse {
        Data?: TopMoverItem[];
    }
    const response = await fetchAPI<TopMoversResponse>(
        `${API.TOP_MOVERS}?centerID=${centerID}&type=${type}`
    );
    return response.Data || [];
}

export async function fetchOverviewRefresh(options?: {
    symbols?: string[];
    newsSize?: number;
    heatmapLimit?: number;
    heatmapExchange?: string;
    peTimeFrame?: '6M' | 'YTD' | '1Y' | '2Y' | '5Y' | 'ALL';
}): Promise<{
    watchlistPrices: Record<string, WatchlistPriceSnapshot>;
    peData: PEChartData[];
    news: NewsItem[];
    heatmap: any;
}> {
    const params = new URLSearchParams();
    if (options?.symbols && options.symbols.length > 0) {
        params.set('symbols', options.symbols.join(','));
    }
    if (options?.newsSize) {
        params.set('news_size', String(options.newsSize));
    }
    if (options?.heatmapLimit) {
        params.set('heatmap_limit', String(options.heatmapLimit));
    }
    if (options?.heatmapExchange) {
        params.set('heatmap_exchange', String(options.heatmapExchange));
    }
    if (options?.peTimeFrame) {
        params.set('pe_time_frame', String(options.peTimeFrame));
    }

    const query = params.toString();
    const url = `${API_BASE}/market/overview-refresh${query ? `?${query}` : ''}`;
    const response = await fetchAPI<OverviewRefreshData>(url);

    return {
        watchlistPrices: response.watchlistPrices || {},
        peData: parsePEChartPayload(response.peChart || {}),
        news: Array.isArray(response.news) ? response.news : [],
        heatmap: response.heatmap || null,
    };
}
