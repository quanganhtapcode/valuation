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
                // fall through
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
                // fall through
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

        if (/(^|\.)stock\.quanganh\.org$/i.test(window.location.hostname)) {
            return 'wss://api.quanganh.org/v1/valuation/ws/market/indices';
        }

        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${window.location.host}/ws/market/indices`;
    }

    return 'ws://127.0.0.1:5000/ws/market/indices';
}

/** Generic helper: build a VPS WebSocket URL for any path. */
export function getWsUrl(path: string): string {
    return getIndicesWsUrl().replace('/ws/market/indices', path);
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
