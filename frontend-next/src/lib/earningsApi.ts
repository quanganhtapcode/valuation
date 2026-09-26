import { API, fetchAPI } from './apiCore';

export interface EarningsGrower {
    ticker: string;
    name: string;
    growth_pct: number;
    base_value: number;
    current_value: number;
}

export interface EarningsSeasonData {
    quarter: string;
    year: number;
    q: number;
    reported_count: number;
    total_count: number;
    reported_pct: number;
    market_cap_pct: number;
    top_revenue_yoy: EarningsGrower[];
    top_revenue_qoq: EarningsGrower[];
    top_profit_yoy: EarningsGrower[];
    top_profit_qoq: EarningsGrower[];
    updated_at: string;
}

export async function fetchEarningsSeason(): Promise<EarningsSeasonData | null> {
    try {
        return await fetchAPI<EarningsSeasonData>(API.EARNINGS_SEASON);
    } catch {
        return null;
    }
}
