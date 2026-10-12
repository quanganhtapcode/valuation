import { fetchAPI } from './apiCore';

export interface FundPrice {
    short_name: string;
    name: string;
    fund_type: string;
    fund_owner_name: string;
    nav: number;
    nav_update_at: string;
    nav_change_previous: number | null;
    nav_change_1m: number | null;
    nav_change_12m: number | null;
    nav_change_36m_annualized: number | null;
    management_fee: number | null;
}

export interface FundSnapshot {
    success: boolean;
    data: FundPrice[];
    count: number;
    fetched_at: string;
    stale?: boolean;
    source: string;
}

export function fetchFundPrices(): Promise<FundSnapshot> {
    return fetchAPI<FundSnapshot>('/api/market/funds');
}
