import { API, API_BASE, fetchAPI } from './apiCore';

export type ScreenerSortKey =
    | 'ticker'
    | 'price'
    | 'market_cap'
    | 'pe'
    | 'pb'
    | 'roe'
    | 'net_margin'
    | 'gross_margin'
    | 'net_profit_growth'
    | 'revenue_growth'
    | 'daily_change'
    | 'value'
    | 'volume'
    | 'exchange'
    | 'sector'
    | 'upside_pct';

export interface ScreenerFilters {
    q?: string;
    exchange?: string;
    sector?: string;
    price_min?: number;
    price_max?: number;
    market_cap_min?: number;
    market_cap_max?: number;
    pe_min?: number;
    pe_max?: number;
    pb_min?: number;
    pb_max?: number;
    roe_min?: number;
    roe_max?: number;
    net_margin_min?: number;
    net_margin_max?: number;
    gross_margin_min?: number;
    gross_margin_max?: number;
    net_profit_growth_min?: number;
    net_profit_growth_max?: number;
    revenue_growth_min?: number;
    revenue_growth_max?: number;
    daily_change_min?: number;
    daily_change_max?: number;
    value_min?: number;
    value_max?: number;
    volume_min?: number;
    volume_max?: number;
    upside_pct_min?: number;
    upside_pct_max?: number;
    tickers?: string;
}

export interface ScreenerItem {
    ticker: string;
    name: string;
    exchange: string | null;
    sector: string | null;
    icbName1: string | null;
    icbName2: string | null;
    icbName3: string | null;
    icbName4: string | null;
    icbCode1: string | null;
    icbCode2: string | null;
    icbCode3: string | null;
    icbCode4: string | null;
    marketPrice: number | null;
    marketCap: number | null;
    dailyPriceChangePercent: number | null;
    ttmPe: number | null;
    ttmPb: number | null;
    ttmRoe: number | null;
    netMargin: number | null;
    grossMargin: number | null;
    npatmiGrowthYoyQm1: number | null;
    revenueGrowthYoy: number | null;
    accumulatedValue: number | null;
    accumulatedVolume: number | null;
    intrinsicValue: number | null;
    upsidePct: number | null;
}

export interface IcbSector {
    icb_name1: string;
    icb_name2: string;
    icb_code1: string;
    icb_code2: string;
}

export interface ScreenerResponse {
    success: boolean;
    items: ScreenerItem[];
    total: number;
    page: number;
    pageSize: number;
    sortBy: ScreenerSortKey;
    sortOrder: 'asc' | 'desc';
    hasValuationData?: boolean;
}

export async function fetchScreenerIcbSectors(): Promise<IcbSector[]> {
    const data = await fetchAPI<{ success: boolean; sectors: IcbSector[] }>(
        `${API_BASE}/market/screener/icb-sectors`
    );
    return data.sectors || [];
}

export async function fetchScreener(params: {
    page?: number;
    pageSize?: number;
    sortBy?: ScreenerSortKey;
    sortOrder?: 'asc' | 'desc';
    filters?: ScreenerFilters;
}): Promise<ScreenerResponse> {
    const query = new URLSearchParams();
    query.set('page', String(params.page ?? 1));
    query.set('page_size', String(params.pageSize ?? 50));
    query.set('sort_by', String(params.sortBy ?? 'market_cap'));
    query.set('sort_order', String(params.sortOrder ?? 'desc'));

    const filters = params.filters || {};
    for (const [k, v] of Object.entries(filters)) {
        if (v === undefined || v === null || v === '') continue;
        query.set(k, String(v));
    }

    return fetchAPI<ScreenerResponse>(`${API.SCREENER}?${query.toString()}`);
}
