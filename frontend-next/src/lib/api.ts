/**
 * API Configuration and Helper Functions
 * Connects to the existing Python backend (server.py)
 */

// Re-export types and stock-specific API functions
export * from './types';
export * from './stockApi';


// API Base URL - prefer same-origin proxy (/api) for consistent caching/CORS
// Can be overridden via NEXT_PUBLIC_API_URL environment variable
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

// Sync price refresh cadence with backend VCI polling loop (3 seconds).
export const PRICE_SYNC_INTERVAL_MS = 3000;
export const IDLE_REFRESH_INTERVAL_MS = 60000;

// API Endpoints
export const API = {
    // Market Data
    PE_CHART: `${API_BASE}/market/pe-chart`,
    EMA50_BREADTH: `${API_BASE}/market/ema50-breadth`,
    VCI_INDICES: `${API_BASE}/market/vci-indices`,
    NEWS: `${API_BASE}/market/news`,
    TOP_MOVERS: `${API_BASE}/market/top-movers`,
    FOREIGN_FLOW: `${API_BASE}/market/foreign-flow`,
    FOREIGN_NET_VALUE: `${API_BASE}/market/foreign-net-value`,
    FOREIGN_VOLUME_CHART: `${API_BASE}/market/foreign-volume-chart`,
    GOLD: `${API_BASE}/market/gold`,
    LOTTERY: `${API_BASE}/market/lottery`,

    // Stock Data (VCI Source via vnstock)
    STOCK: (symbol: string) => `${API_BASE}/stock/${symbol}?fetch_price=true`,
    APP_DATA: (symbol: string) => `${API_BASE}/app-data/${symbol}?fetch_price=true`,
    CURRENT_PRICE: (symbol: string) => `${API_BASE}/current-price/${symbol}`,
    PRICE: (symbol: string) => `${API_BASE}/price/${symbol}`,
    HISTORICAL_CHART: (symbol: string) => `${API_BASE}/historical-chart-data/${symbol}`,
    STOCK_HISTORY: (symbol: string) => `${API_BASE}/stock/history/${symbol}`,
    COMPANY_PROFILE: (symbol: string) => `${API_BASE}/company/profile/${symbol}`,
    NEWS_STOCK: (symbol: string) => `${API_BASE}/news/${symbol}`,
    EVENTS: (symbol: string) => `${API_BASE}/events/${symbol}`,

    // Valuation
    VALUATION: (symbol: string) => `${API_BASE}/valuation/${symbol}`,

    // Utilities
    TICKERS: `${API_BASE}/tickers`,
    HEALTH: `${API_BASE}/health`,
} as const;

// Index mapping from CafeF
export const INDEX_MAP: Record<string, { id: string; name: string; vciSymbol: string }> = {
    '1': { id: 'vnindex', name: 'VN-Index', vciSymbol: 'VNINDEX' },
    '2': { id: 'hnx', name: 'HNX-Index', vciSymbol: 'HNXIndex' },
    '9': { id: 'upcom', name: 'UPCOM', vciSymbol: 'HNXUpcomIndex' },
    '11': { id: 'vn30', name: 'VN30', vciSymbol: 'VN30' },
};

// ============ API Fetching Functions ============

/**
 * Generic fetch wrapper with error handling
 */
async function fetchAPI<T>(url: string, options?: RequestInit): Promise<T> {
    try {
        const resolvedUrl =
            typeof window === 'undefined' && url.startsWith('/')
                ? new URL(
                      url,
                      process.env.NEXT_PUBLIC_SITE_URL ||
                          (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'),
                  ).toString()
                : url;

        const response = await fetch(resolvedUrl, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options?.headers,
            },
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        return response.json();
    } catch (error) {
        console.error(`Fetch error for ${url}:`, error);
        throw error;
    }
}

// ============ Market Data Types ============

export interface MarketIndexData {
    CurrentIndex: number;
    PrevIndex: number;
    Volume?: number;
    Value?: number;
    Advances?: number;
    Declines?: number;
    NoChanges?: number;
    Ceilings?: number;
    Floors?: number;
}

export interface VciIndexItem {
    symbol: string;
    price: number;
    refPrice: number;
    change?: number;
    changePercent?: number;
    time?: string;
    sendingTime?: string;
    totalShares?: number;
    totalValue?: number;
    totalStockIncrease?: number;
    totalStockDecline?: number;
    totalStockNoChange?: number;
    totalStockCeiling?: number;
    totalStockFloor?: number;
}

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

export type IndicesStreamStatus = 'open' | 'closed' | 'error';

/**
 * True when Vietnam stock markets are open: weekdays 09:00–15:05 ICT (UTC+7).
 * Calculated from UTC so client timezone doesn't matter.
 */
export function isTradingHours(): boolean {
    if (typeof window === 'undefined') return false; // SSR: no streaming
    const now = new Date();
    // Shift to Vietnam time (UTC+7) without relying on client TZ
    const vnMs = now.getTime() + now.getTimezoneOffset() * 60_000 + 7 * 3_600_000;
    const vn = new Date(vnMs);
    const day = vn.getDay(); // 0 = Sunday, 6 = Saturday
    if (day === 0 || day === 6) return false;
    const minutes = vn.getHours() * 60 + vn.getMinutes();
    return minutes >= 9 * 60 && minutes <= 15 * 60 + 5; // 09:00 – 15:05
}

interface IndicesStreamPayload {
    type?: string;
    source?: string;
    serverTs?: number;
    data?: Record<string, MarketIndexData>;
}

// ============ Market Data Fetchers ============

/**
 * Fetch all indices data with realtime prices
 */
export async function fetchAllIndices(): Promise<Record<string, MarketIndexData>> {
    // Single call: VCI indices already includes VNINDEX/HNX/UPCOM/VN30
    const items = await fetchAPI<VciIndexItem[]>(API.VCI_INDICES);
    const bySymbol = new Map<string, VciIndexItem>();
    for (const it of items || []) {
        if (it?.symbol) bySymbol.set(String(it.symbol).toUpperCase(), it);
    }

    const symbolMap: Record<string, string> = {
        '1': 'VNINDEX',
        '2': 'HNXINDEX',
        '9': 'HNXUPCOMINDEX',
        '11': 'VN30',
    };

    const result: Record<string, MarketIndexData> = {};
    for (const [indexId, vciSymbol] of Object.entries(symbolMap)) {
        const it = bySymbol.get(vciSymbol);
        if (!it) continue;
        result[indexId] = {
            CurrentIndex: Number(it.price) || 0,
            PrevIndex: Number(it.refPrice) || 0,
            Volume: Number(it.totalShares) || 0,
            Value: Number(it.totalValue) || 0,
            Advances: Number(it.totalStockIncrease) || 0,
            Declines: Number(it.totalStockDecline) || 0,
            NoChanges: Number(it.totalStockNoChange) || 0,
            Ceilings: Number(it.totalStockCeiling) || 0,
            Floors: Number(it.totalStockFloor) || 0,
        };
    }
    return result;
}

function getIndicesWsUrl(): string {
    const fromEnv = process.env.NEXT_PUBLIC_BACKEND_WS_URL;
    if (fromEnv) {
        const normalized = fromEnv.replace(/\/$/, '');
        if (/^wss?:\/\//i.test(normalized)) {
            return `${normalized}/ws/market/indices`;
        }
        if (/^https?:\/\//i.test(normalized)) {
            try {
                const parsed = new URL(normalized);
                const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
                return `${wsProtocol}//${parsed.host}${parsed.pathname.replace(/\/$/, '')}/ws/market/indices`;
            } catch {
                // fall through to NEXT_PUBLIC_API_URL and runtime-based defaults
            }
        }
    }

    const fromApiEnv = process.env.NEXT_PUBLIC_API_URL;
    if (fromApiEnv) {
        if (/^https?:\/\//i.test(fromApiEnv)) {
            try {
                const parsed = new URL(fromApiEnv);
                const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
                let basePath = parsed.pathname.replace(/\/$/, '');
                if (basePath.endsWith('/api')) {
                    basePath = basePath.slice(0, -4);
                }
                return `${wsProtocol}//${parsed.host}${basePath}/ws/market/indices`;
            } catch {
                // fall through to other API URL formats and runtime defaults
            }
        }

        if (fromApiEnv.startsWith('/') && typeof window !== 'undefined') {
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            let basePath = fromApiEnv.replace(/\/$/, '');
            if (basePath.endsWith('/api')) {
                basePath = basePath.slice(0, -4);
            }
            return `${wsProtocol}//${window.location.host}${basePath}/ws/market/indices`;
        }
    }

    if (typeof window !== 'undefined') {
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        if (isLocal) {
            return 'ws://127.0.0.1:5000/ws/market/indices';
        }

        // Safety net: NEXT_PUBLIC_BACKEND_WS_URL should be set on Vercel; Vercel
        // cannot proxy WebSocket connections so the browser must hit the API gateway
        // directly. If the env var is missing this fallback handles stock.quanganh.org.
        // Preferred: set NEXT_PUBLIC_BACKEND_WS_URL=wss://api.quanganh.org/v1/valuation
        if (/(^|\.)stock\.quanganh\.org$/i.test(window.location.hostname)) {
            return 'wss://api.quanganh.org/v1/valuation/ws/market/indices';
        }

        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${window.location.host}/ws/market/indices`;
    }

    return 'ws://127.0.0.1:5000/ws/market/indices';
}

export function subscribeIndicesStream(options: {
    onData: (data: Record<string, MarketIndexData>, source?: string) => void;
    onStatus?: (status: IndicesStreamStatus) => void;
}): () => void {
    const { onData, onStatus } = options;

    // No trading-hours gate here: the backend keeps the socket alive with 30s
    // keepalive pings regardless of session, and the VCI client manages its own
    // poll rate. Blocking the WS on the client side just causes it to appear
    // gone outside market hours.
    if (typeof window === 'undefined') {
        return () => {};
    }

    let ws: WebSocket | null = null;
    let destroyed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 2000; // ms, doubles with each failed attempt

    const connect = () => {
        if (destroyed) return;
        ws = new WebSocket(getIndicesWsUrl());

        ws.onopen = () => {
            retryDelay = 2000; // reset backoff on successful connect
            onStatus?.('open');
        };
        ws.onerror = () => { onStatus?.('error'); };
        ws.onclose = () => {
            if (destroyed) return;
            onStatus?.('closed');
            // Auto-reconnect with exponential backoff capped at 30 s
            retryTimer = setTimeout(() => {
                retryDelay = Math.min(retryDelay * 2, 30_000);
                connect();
            }, retryDelay);
        };
        ws.onmessage = (event) => {
            try {
                const payload = JSON.parse(String(event.data)) as IndicesStreamPayload;
                if (payload?.type !== 'indices' || !payload?.data) return;
                onData(payload.data, payload.source);
            } catch {
                // ignore malformed payloads
            }
        };
    };

    connect();

    return () => {
        destroyed = true;
        if (retryTimer) clearTimeout(retryTimer);
        try { ws?.close(); } catch {}
    };
}

export function getPricesWsUrl(): string {
    const override = process.env.NEXT_PUBLIC_BACKEND_WS_URL;
    if (typeof window !== 'undefined') {
        if (override) {
            return `${override}${override.endsWith('/') ? '' : '/'}ws/market/prices`;
        }
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return 'ws://127.0.0.1:5000/ws/market/prices';
        }
        if (/(^|\.)stock\.quanganh\.org$/i.test(window.location.hostname)) {
            return 'wss://api.quanganh.org/v1/valuation/ws/market/prices';
        }
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${window.location.host}/ws/market/prices`;
    }
    return 'ws://127.0.0.1:5000/ws/market/prices';
}

export function subscribePricesStream(options: {
    onData: (data: any, type: string) => void;
    onStatus?: (status: IndicesStreamStatus) => void;
}): () => void {
    const { onData, onStatus } = options;
    if (!isTradingHours()) {
        // Outside trading hours: prices don't change, skip the socket
        onStatus?.('closed');
        return () => {};
    }
    const ws = new WebSocket(getPricesWsUrl());

    ws.onopen = () => onStatus?.('open');
    ws.onerror = () => onStatus?.('error');
    ws.onclose = () => onStatus?.('closed');

    ws.onmessage = (event) => {
        try {
            const payload = JSON.parse(String(event.data));
            if (payload?.type?.startsWith('prices_') && payload?.data) {
                onData(payload.data, payload.type);
            }
        } catch {
            // ignore malformed payloads
        }
    };

    return () => {
        try { ws.close(); } catch {}
    };
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
        `${API.NEWS}?page=${page}&size=${size}`
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

function parsePEChartPayload(response: any): PEChartData[] {
    // VCI payload (new):
    // { series: { pe:[{date,value}], pb:[{date,value}] } }
    const vciSeries = response?.series;
    if (vciSeries && (Array.isArray(vciSeries.pe) || Array.isArray(vciSeries.pb))) {
        const byDate = new Map<string, { pe: number | null; pb: number | null; vnindex: number | null }>();

        const appendSeries = (items: any[], key: 'pe' | 'pb' | 'vnindex') => {
            for (const item of items || []) {
                const dateStr = String(item?.date || '').trim();
                const rawValue = item?.value;
                if (!dateStr || rawValue == null) continue;
                const value = Number(rawValue);
                if (!Number.isFinite(value)) continue;
                const prev = byDate.get(dateStr) || { pe: null, pb: null, vnindex: null, ema50: null, volume: null };
                prev[key] = value;
                if (key === 'vnindex') {
                    if (item.volume != null) {
                        (prev as any).volume = Number(item.volume) || null;
                    }
                    if (item.ema50 != null) {
                        (prev as any).ema50 = Number(item.ema50) || null;
                    }
                }
                byDate.set(dateStr, prev);
            }
        };

        appendSeries(vciSeries.pe || [], 'pe');
        appendSeries(vciSeries.pb || [], 'pb');
        appendSeries(vciSeries.vnindex || [], 'vnindex');

        return Array.from(byDate.entries())
            .map(([dateStr, ratios]: [string, any]) => {
                const date = parseDateInput(dateStr);
                return date
                    ? {
                        date,
                        pe: ratios.pe,
                        pb: ratios.pb,
                        vnindex: ratios.vnindex,
                        ema50: ratios.ema50 ?? null,
                        volume: ratios.volume ?? null,
                    }
                    : null;
            })
            .filter((row): row is PEChartData => row !== null)
            .sort((a, b) => a.date.getTime() - b.date.getTime());
    }

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
    })).reverse();

    if (data.length > 1 && data[0].date > data[1].date) {
        data.reverse();
    }

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
