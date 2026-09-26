import { API, fetchAPI } from './apiCore';

// ============ Market Data Types ============

export interface NewsItem {
    // PascalCase fields (VCI / CafeF API)
    Title: string;
    Link?: string;
    NewsUrl?: string;
    ImageThumb?: string;
    Avatar?: string;
    PostDate?: string;
    PublishDate?: string;
    Symbol?: string;
    Source?: string;
    Price?: number;
    ChangePrice?: number;
    // camelCase / snake_case aliases (other news sources)
    title?: string;
    url?: string;
    source?: string;
    publish_date?: string;
    image_url?: string;
    symbol?: string;
    Sentiment?: 'Positive' | 'Negative' | 'Neutral' | string;
    Score?: number;
    sentiment?: 'Positive' | 'Negative' | 'Neutral' | string;
    score?: number;
}

/**
 * Fetch market news
 */
export async function fetchNews(page: number = 1, size: number = 100): Promise<NewsItem[]> {
    interface NewsResponse {
        data?: NewsItem[];
        Data?: NewsItem[];
    }
    const response = await fetchAPI<NewsResponse | NewsItem[]>(
        `${API.NEWS}?page=${page}&size=${size}&compact=1`
    );

    if (Array.isArray(response)) {
        return response;
    }
    return response.data || response.Data || [];
}
