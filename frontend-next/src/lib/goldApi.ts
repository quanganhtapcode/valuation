import { API, fetchAPI } from './apiCore';

export interface GoldPriceItem {
    Id: number;
    TypeName: string;
    BranchName: string;
    Buy: string;
    Sell: string;
    UpdateTime: string;
}

/**
 * Fetch gold prices (primary source: Phú Quý via backend service, fallback BTMC).
 */
export async function fetchGoldPrices(): Promise<{ data: GoldPriceItem[]; updated_at?: string; source?: string }> {
    interface GoldResponse {
        success: boolean;
        data: GoldPriceItem[];
        updated_at?: string;
        source?: string;
    }
    const response = await fetchAPI<GoldResponse>(API.GOLD);
    return {
        data: response.data || [],
        updated_at: response.updated_at,
        source: response.source,
    };
}
