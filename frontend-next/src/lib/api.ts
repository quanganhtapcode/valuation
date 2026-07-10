/**
 * API Configuration and Helper Functions
 * Connects to the existing Python backend (server.py)
 */

// Re-export types and stock-specific API functions
export * from './types';
export * from './stockApi';
export { API, API_BASE, REALTIME_API_BASE, fetchAPI } from './apiCore';
export { INDEX_MAP } from './marketTypes';
export type { IndicesStreamStatus, MarketIndexData, VciIndexItem } from './marketTypes';
export {
    fetchAllIndices,
    getPricesWsUrl,
    getWsUrl,
    isTradingHours,
    subscribeIndicesStream,
    subscribePricesStream,
} from './marketRealtime';

import { API, API_BASE, fetchAPI } from './apiCore';

// Sync price refresh cadence with backend VCI polling loop (3 seconds).
export const PRICE_SYNC_INTERVAL_MS = 15000;
export const IDLE_REFRESH_INTERVAL_MS = 60000;

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

export interface TopMoverItem {
    Symbol: string;
    CompanyName: string;
    CurrentPrice: number;
    ChangePricePercent: number;
    Exchange?: string;
    Value?: number;
}

export interface ForeignNetItem {
    Symbol: string;
    CompanyName: string;
    CurrentPrice: number;
    ChangePricePercent: number;
    Exchange: string;
    Value: number;  // net buy value (always positive — context determines buy vs sell)
}

/** One minute-bar from ForeignVolumeChart/getAll */
export interface ForeignVolumePoint {
    time: string;          // "HH:MM" e.g. "09:15"
    buyVolume: number;
    sellVolume: number;
    buyValue: number;
    sellValue: number;
    /** cumulative buy volume from 09:00 to this minute */
    cumBuyVolume?: number;
    /** cumulative sell volume from 09:00 to this minute */
    cumSellVolume?: number;
    /** cumulative buy value */
    cumBuyValue?: number;
    /** cumulative sell value */
    cumSellValue?: number;
}

export interface GoldPriceItem {
    Id: number;
    TypeName: string;
    BranchName: string;
    Buy: string;
    Sell: string;
    UpdateTime: string;
}

export interface ValuationStats {
    average: number;
    plusOneSD: number;
    plusTwoSD: number;
    minusOneSD: number;
    minusTwoSD: number;
}

export interface PEChartData {
    date: Date;
    pe: number | null;
    pb: number | null;
    vnindex: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    ema50: number | null;
    volume: number | null;
}

export interface PEChartResult {
    series: PEChartData[];
    stats: { pe?: ValuationStats; pb?: ValuationStats };
}

export interface EmaBreadthPoint {
    date: Date;
    aboveEma50: number;
    belowEma50: number;
    total: number;
    abovePercent: number;
}

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

/**
 * Fetch foreign investor flow
 */
export async function fetchForeignFlow(type: 'buy' | 'sell'): Promise<TopMoverItem[]> {
    interface ForeignFlowResponse {
        Data?: TopMoverItem[];
    }
    const response = await fetchAPI<ForeignFlowResponse>(
        `${API.FOREIGN_FLOW}?type=${type}`
    );
    return response.Data || [];
}

/**
 * Fetch full foreign net-value lists (for /foreign page)
 */
export async function fetchForeignNetValue(): Promise<{
    buyList: ForeignNetItem[];
    sellList: ForeignNetItem[];
}> {
    interface Resp { buyList?: ForeignNetItem[]; sellList?: ForeignNetItem[] }
    const r = await fetchAPI<Resp>(API.FOREIGN_NET_VALUE);
    return { buyList: r.buyList || [], sellList: r.sellList || [] };
}

/**
 * Fetch intraday foreign volume chart (minute bars, 09:00–15:00).
 * Adds cumulative sums so the chart can render both bar and area views.
 */
export async function fetchForeignVolumeChart(): Promise<ForeignVolumePoint[]> {
    interface Resp { data?: any[] }
    const r = await fetchAPI<Resp>(API.FOREIGN_VOLUME_CHART);
    const raw = r.data || [];

    // Normalize unknown VCI field names → ForeignVolumePoint
    const points: ForeignVolumePoint[] = raw.map((item: any) => {
        // time: VCI may give unix timestamp (ms or s), or "HH:MM" string
        let time = '';
        const t = item.time ?? item.t ?? item.timestamp ?? item.tradingTime ?? '';
        if (typeof t === 'number') {
            const ms = t > 1e10 ? t : t * 1000;
            const d = new Date(ms);
            time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        } else {
            // "09:15" or "091500" or ISO string
            const s = String(t);
            if (s.includes(':')) time = s.slice(0, 5);
            else if (s.length >= 4) time = `${s.slice(0, 2)}:${s.slice(2, 4)}`;
            else time = s;
        }
        return {
            time,
            buyVolume:  Number(item.buyVolume  ?? item.foreignBuyVolume  ?? item.fBuyVol  ?? 0),
            sellVolume: Number(item.sellVolume  ?? item.foreignSellVolume ?? item.fSellVol ?? 0),
            buyValue:   Number(item.buyValue    ?? item.foreignBuyValue   ?? item.fBuyVal  ?? 0),
            sellValue:  Number(item.sellValue   ?? item.foreignSellValue  ?? item.fSellVal ?? 0),
        };
    });

    // Filter to trading session 09:00–15:00 and sort
    const session = points
        .filter(p => p.time >= '09:00' && p.time <= '15:00')
        .sort((a, b) => a.time.localeCompare(b.time));

    // Build cumulative sums
    let cumBuyVol = 0, cumSellVol = 0, cumBuyVal = 0, cumSellVal = 0;
    return session.map(p => {
        cumBuyVol  += p.buyVolume;
        cumSellVol += p.sellVolume;
        cumBuyVal  += p.buyValue;
        cumSellVal += p.sellValue;
        return { ...p, cumBuyVolume: cumBuyVol, cumSellVolume: cumSellVol, cumBuyValue: cumBuyVal, cumSellValue: cumSellVal };
    });
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

/**
 * Fetch P/E chart historical data
 */
export type ValuationMetric = 'pe' | 'pb' | 'both';

export async function fetchPEChart(
    metric: ValuationMetric = 'both',
    options?: RequestInit,
): Promise<PEChartResult> {
    const response = await fetchAPI<any>(`${API.PE_CHART}?metric=${metric}`, options);
    const series = parsePEChartPayload(response);
    const stats = (response?.stats ?? {}) as { pe?: ValuationStats; pb?: ValuationStats };
    return { series, stats };
}

export async function fetchPEChartByRange(
    timeFrame: '6M' | 'YTD' | '1Y' | '2Y' | '5Y' | 'ALL',
    metric: ValuationMetric = 'both',
    options?: RequestInit,
): Promise<PEChartResult> {
    const response = await fetchAPI<any>(`${API.PE_CHART}?metric=${metric}&timeFrame=${timeFrame}`, options);
    const series = parsePEChartPayload(response);
    const stats = (response?.stats ?? {}) as { pe?: ValuationStats; pb?: ValuationStats };
    return { series, stats };
}

export async function fetchEma50Breadth(days = 260): Promise<EmaBreadthPoint[]> {
    const response = await fetchAPI<any>(`${API.EMA50_BREADTH}?days=${days}`);
    const rows = Array.isArray(response?.data) ? response.data : [];
    return rows
        .map((row: any) => {
            const d = parseDateInput(row?.date);
            if (!d) return null;
            const above = Number(row?.aboveEma50);
            const below = Number(row?.belowEma50);
            const total = Number(row?.total);
            const pct = Number(row?.abovePercent);
            if (![above, below, total, pct].every(Number.isFinite)) return null;
            return {
                date: d,
                aboveEma50: above,
                belowEma50: below,
                total,
                abovePercent: pct,
            } as EmaBreadthPoint;
        })
        .filter((row: EmaBreadthPoint | null): row is EmaBreadthPoint => row !== null)
        .sort((a, b) => a.date.getTime() - b.date.getTime());
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

function parsePEChartPayload(response: any): PEChartData[] {
    // New unified format: { data: [{date, vnindex, ema50, pe, pb, volume}] }
    if (Array.isArray(response?.data) && response.data.length > 0) {
        return response.data
            .map((item: any) => {
                const date = parseDateInput(item?.date);
                if (!date) return null;
                return {
                    date,
                    vnindex: item.vnindex != null ? Number(item.vnindex) : null,
                    open:    item.open    != null ? Number(item.open)    : null,
                    high:    item.high    != null ? Number(item.high)    : null,
                    low:     item.low     != null ? Number(item.low)     : null,
                    close:   item.close   != null ? Number(item.close)   : null,
                    ema50:   item.ema50   != null ? Number(item.ema50)   : null,
                    pe:      item.pe      != null ? Number(item.pe)      : null,
                    pb:      item.pb      != null ? Number(item.pb)      : null,
                    volume:  item.volume  != null ? Number(item.volume)  : null,
                } as PEChartData;
            })
            .filter((row: PEChartData | null): row is PEChartData => row !== null);
    }

    // Legacy CafeF fallback
    if (!response?.Data?.DataChart || !Array.isArray(response.Data.DataChart)) {
        return [];
    }
    const data = response.Data.DataChart.map((p: { TimeStamp: number; Index: number; Pe: number }) => ({
        date: new Date(p.TimeStamp * 1000),
        vnindex: p.Index,
        pe: p.Pe,
        pb: null,
        ema50: null,
        volume: null,
    }));
    if (data.length > 1 && data[0].date > data[1].date) data.reverse();
    return data;
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

// ============ Utility Functions ============

function parseDateInput(input: string | number | Date | undefined | null): Date | null {
    if (input == null) return null;
    if (input instanceof Date) {
        return isNaN(input.getTime()) ? null : input;
    }

    if (typeof input === 'number') {
        const d = new Date(input);
        return isNaN(d.getTime()) ? null : d;
    }

    let value = String(input).trim();
    if (!value) return null;

    // CafeF style: \/Date(1700000000000)\/
    if (value.includes('/Date(')) {
        const ms = parseInt(value.match(/\d+/)?.[0] || '0', 10);
        const d = new Date(ms);
        return isNaN(d.getTime()) ? null : d;
    }

    // Some sources append timezone like: "Feb 21, 2026, 06:09 PM | +03:02"
    if (value.includes('|')) {
        value = value.split('|')[0]?.trim() || value;
    }

    // Try native parsing first (ISO, RFC2822, etc.)
    let d = new Date(value);
    if (!isNaN(d.getTime())) return d;

    // Try dd/mm/yyyy[ hh:mm[:ss]] (common Vietnamese format)
    const m = value.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
    );
    if (m) {
        const day = parseInt(m[1], 10);
        const month = parseInt(m[2], 10) - 1;
        const year = parseInt(m[3], 10);
        const hour = m[4] ? parseInt(m[4], 10) : 0;
        const minute = m[5] ? parseInt(m[5], 10) : 0;
        const second = m[6] ? parseInt(m[6], 10) : 0;
        d = new Date(year, month, day, hour, minute, second);
        return isNaN(d.getTime()) ? null : d;
    }

    return null;
}

/**
 * Format date from various formats (including CafeF /Date()/ format)
 */
export function formatDate(dateStr: string | number | undefined): string {
    if (!dateStr) return '';

    try {
        let date: Date;

        if (typeof dateStr === 'string' && dateStr.includes('/Date(')) {
            const ms = parseInt(dateStr.match(/\d+/)?.[0] || '0');
            date = new Date(ms);
        } else {
            date = new Date(dateStr);
        }

        return date.toLocaleString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return '';
    }
}

/**
 * Format time as relative text (e.g. "3 giờ trước", "2 ngày trước").
 */
export function formatRelativeTime(
    input: string | number | Date | undefined,
    locale: string = 'vi-VN'
): string {
    const date = parseDateInput(input);
    if (!date) return '';

    const now = new Date();
    const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
    const abs = Math.abs(diffSeconds);

    if (abs < 5) return locale.startsWith('vi') ? 'vừa xong' : 'just now';

    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
        ['year', 60 * 60 * 24 * 365],
        ['month', 60 * 60 * 24 * 30],
        ['week', 60 * 60 * 24 * 7],
        ['day', 60 * 60 * 24],
        ['hour', 60 * 60],
        ['minute', 60],
        ['second', 1],
    ];

    for (const [unit, secondsInUnit] of units) {
        if (abs >= secondsInUnit || unit === 'second') {
            const value = Math.round(diffSeconds / secondsInUnit);
            return rtf.format(value, unit);
        }
    }

    return rtf.format(diffSeconds, 'second');
}

/**
 * Format number with Vietnamese locale
 */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return value.toLocaleString('en-US', {
        maximumFractionDigits: 2,
        ...options
    });
}

/**
 * Format currency (VND)
 */
export function formatCurrency(value: number): string {
    return formatNumber(value, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/**
 * Format percentage change with sign
 */
export function formatPercentChange(value: number): string {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
}

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
    direction: 'up' | 'down';
}

export interface MarketTakeawaysData {
    available: boolean;
    headline: string;
    summary: string[];
    watchlist?: MarketTakeawayWatchItem[];
    movers: MarketTakeawayMover[];
    earnings: EarningsSeasonData;
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

export async function fetchEarningsSeason(): Promise<EarningsSeasonData | null> {
    try {
        return await fetchAPI<EarningsSeasonData>(API.EARNINGS_SEASON);
    } catch {
        return null;
    }
}

export async function fetchMarketTakeaways(): Promise<MarketTakeawaysData | null> {
    try {
        return await fetchAPI<MarketTakeawaysData>(API.AI_TAKEAWAYS);
    } catch {
        return null;
    }
}
