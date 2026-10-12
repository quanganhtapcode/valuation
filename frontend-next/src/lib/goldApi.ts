import { API, fetchAPI } from './apiCore';

export interface GoldPriceItem {
    Id: number;
    TypeName: string;
    BranchName: string;
    Buy: string;
    Sell: string;
    UpdateTime: string;
    Unit?: string;
}

/**
 * Fetch Phú Quý HTML quotes through the cached NYC backend.
 */
export async function fetchGoldPrices(): Promise<{ data: GoldPriceItem[]; updated_at?: string; source?: string; stale?: boolean }> {
    interface GoldResponse {
        success: boolean;
        data: GoldPriceItem[];
        updated_at?: string;
        source?: string;
        stale?: boolean;
    }
    const response = await fetchAPI<GoldResponse>(API.GOLD);
    if (!response.success) throw new Error('Gold quotes unavailable');
    return {
        data: response.data || [],
        updated_at: response.updated_at,
        source: response.source,
        stale: response.stale,
    };
}
