import { API, fetchAPI } from './apiCore';

export interface MarketTakeawayNews {
    title?: string;
    url?: string;
    source?: string;
    publish_date?: string;
    symbol?: string;
}

export interface MarketTakeawayMover {
    symbol: string;
    company_name: string;
    price: number;
    change_pct: number;
    value: number;
    exchange: string;
    direction: 'up' | 'down';
    news: MarketTakeawayNews[];
}

export interface MarketTakeawayWatchItem {
    symbol: string;
    takeaway: string;
    takeaway_vi?: string;
    direction: 'up' | 'down' | 'neutral';
}

export interface MarketTakeawaysData {
    available: boolean;
    headline: string;
    headline_vi?: string;
    summary: string[];
    summary_vi?: string[];
    market_summary?: string[];
    market_summary_vi?: string[];
    news_summary?: string[];
    news_summary_vi?: string[];
    watchlist?: MarketTakeawayWatchItem[];
    movers: MarketTakeawayMover[];
    recent_news?: MarketTakeawayNews[];
    model: string;
    generated_at: string;
}

export interface AiAnalysisData {
    available: boolean;
    ticker?: string;
    quarter?: string;
    analysis_vi?: string;
    analysis_json?: string;
    news_json?: string;
    model?: string;
    generated_at?: string;
}

export async function fetchAiAnalysis(symbol: string): Promise<AiAnalysisData> {
    try {
        return await fetchAPI<AiAnalysisData>(API.STOCK_AI_ANALYSIS(symbol));
    } catch {
        return { available: false };
    }
}

export async function fetchMarketTakeaways(): Promise<MarketTakeawaysData | null> {
    try {
        // The server snapshot is already persisted; bypass browser/proxy caches
        // so a successful AI refresh immediately replaces an earlier fallback.
        return await fetchAPI<MarketTakeawaysData>(`${API.AI_TAKEAWAYS}?cache=no-store`);
    } catch {
        return null;
    }
}
