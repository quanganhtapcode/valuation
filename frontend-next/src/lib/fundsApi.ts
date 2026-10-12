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
    inception_date: string;
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

export interface FundDetail {
    success: boolean;
    fund: FundPrice;
    history: { date: string; nav: number }[];
    yearly_returns: { year: number; start_date: string; end_date: string; start_nav: number; end_nav: number; return_pct: number; partial: boolean; ytd: boolean }[];
    history_available: boolean;
    history_stale: boolean;
    history_updated_at: string | null;
    conflicting_dates: number;
}
