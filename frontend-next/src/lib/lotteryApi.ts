import { API, fetchAPI } from './apiCore';

/**
 * Fetch lottery results
 */
export interface LotteryResult {
    title?: string;
    pubDate?: string;
    results: {
        DB?: string[];
        G1?: string[];
        G2?: string[];
        G3?: string[];
        G4?: string[];
        G5?: string[];
        G6?: string[];
        G7?: string[];
        G8?: string[];
        provinces?: Array<{
            name: string;
            prizes: Record<string, string[]>;
        }>;
    };
}

export async function fetchLottery(region: 'mb' | 'mn' | 'mt'): Promise<LotteryResult> {
    const response = await fetchAPI<LotteryResult>(`${API.LOTTERY}?region=${region}`);
    return response;
}
