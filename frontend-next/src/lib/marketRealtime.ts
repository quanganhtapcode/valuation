import { API, fetchAPI } from './apiCore';
import type { IndicesStreamStatus, MarketIndexData, VciIndexItem } from './marketTypes';

/**
 * True when Vietnam stock markets are open: weekdays 09:00-15:05 ICT (UTC+7).
 * Calculated from UTC so client timezone doesn't matter.
 */
export function isTradingHours(): boolean {
    if (typeof window === 'undefined') return false;
    const now = new Date();
    const vnMs = now.getTime() + now.getTimezoneOffset() * 60_000 + 7 * 3_600_000;
    const vn = new Date(vnMs);
    const day = vn.getDay();
    if (day === 0 || day === 6) return false;
    const minutes = vn.getHours() * 60 + vn.getMinutes();
    return minutes >= 9 * 60 && minutes <= 15 * 60 + 5;
}

interface IndicesStreamPayload {
    type?: string;
    source?: string;
    serverTs?: number;
    data?: Record<string, MarketIndexData>;
}

/**
 * Fetch all indices data with realtime prices.
 */
export async function fetchAllIndices(): Promise<Record<string, MarketIndexData>> {
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

// All streams share one explicit backend base. REST /api is never a WS target.
export function getWsUrl(path: string): string {
    const base = (
        process.env.NEXT_PUBLIC_BACKEND_WS_URL ||
        (process.env.NODE_ENV === 'development'
            ? 'ws://127.0.0.1:8000'
            : 'wss://api.quanganh.org/v1/valuation')
    ).trim().replace(/\/+$/, '').replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
    return `${base}/${path.replace(/^\/+/, '')}`;
}

function getIndicesWsUrl(): string {
    return getWsUrl('/ws/market/indices');
}

export function subscribeIndicesStream(options: {
    onData: (data: Record<string, MarketIndexData>, source?: string) => void;
    onStatus?: (status: IndicesStreamStatus) => void;
}): () => void {
    const { onData, onStatus } = options;
    if (typeof window === 'undefined') {
        return () => {};
    }

    let ws: WebSocket | null = null;
    let destroyed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 2000;

    const connect = () => {
        if (destroyed) return;
        ws = new WebSocket(getIndicesWsUrl());

        ws.onopen = () => {
            retryDelay = 2000;
            onStatus?.('open');
        };
        ws.onerror = () => { onStatus?.('error'); };
        ws.onclose = () => {
            if (destroyed) return;
            onStatus?.('closed');
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
        if (ws) {
            ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
            try { ws.close(); } catch {}
            ws = null;
        }
    };
}

export function getPricesWsUrl(): string {
    return getWsUrl('/ws/market/prices');
}

export function subscribePricesStream(options: {
    onData: (data: any, type: string) => void;
    onStatus?: (status: IndicesStreamStatus) => void;
}): () => void {
    const { onData, onStatus } = options;
    let ws: WebSocket | null = null;
    let destroyed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;

    const connect = () => {
        if (destroyed) return;
        ws = new WebSocket(getPricesWsUrl());

        ws.onopen = () => {
            retryDelay = 1000;
            onStatus?.('open');
        };
        ws.onerror = () => onStatus?.('error');
        ws.onclose = () => {
            if (destroyed) return;
            onStatus?.('closed');
            retryTimer = setTimeout(() => {
                retryDelay = Math.min(retryDelay * 2, 30_000);
                connect();
            }, retryDelay);
        };

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
    };

    connect();

    return () => {
        destroyed = true;
        if (retryTimer) clearTimeout(retryTimer);
        if (ws) {
            ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
            try { ws.close(); } catch {}
            ws = null;
        }
    };
}
