'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type OkxTicker = {
    instId?: string;
    last?: string;
    open24h?: string;
    ts?: string;
};

type TickerState = {
    last: number | null;
    changePct24h: number | null;
    ts: number | null;
};

const WS_URL = 'wss://ws.okx.com:8443/ws/v5/public';
const CHANNEL = 'tickers';

export const OKX_INSTRUMENTS: { instId: string; label: string }[] = [
    { instId: 'BTC-USDT', label: 'BTC' },
    { instId: 'ETH-USDT', label: 'ETH' },
    { instId: 'SOL-USDT', label: 'SOL' },
    { instId: 'XRP-USDT', label: 'XRP' },
];

function toNumber(value: unknown): number | null {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

export function useOkxTickers() {
    const [data, setData] = useState<Record<string, TickerState>>({});
    const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimer = useRef<number | null>(null);
    const backoffRef = useRef(1000);
    const mountedRef = useRef(true);

    const subscribePayload = useMemo(
        () => ({
            op: 'subscribe',
            args: OKX_INSTRUMENTS.map((i) => ({ channel: CHANNEL, instId: i.instId })),
        }),
        [],
    );

    useEffect(() => {
        mountedRef.current = true;

        function cleanup() {
            if (reconnectTimer.current) {
                window.clearTimeout(reconnectTimer.current);
                reconnectTimer.current = null;
            }
            const ws = wsRef.current;
            if (ws) {
                ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
                wsRef.current = null;

                // Calling close() while CONNECTING makes Chromium emit
                // "closed before the connection is established". Let the
                // handshake settle, then close without updating stale state.
                if (ws.readyState === WebSocket.CONNECTING) {
                    ws.onopen = () => {
                        try { ws.close(); } catch {}
                    };
                } else if (ws.readyState === WebSocket.OPEN) {
                    try { ws.close(); } catch {}
                }
            }
        }

        function connect() {
            cleanup();
            setStatus('connecting');

            const ws = new WebSocket(WS_URL);
            wsRef.current = ws;

            ws.onopen = () => {
                backoffRef.current = 1000;
                setStatus('connected');
                ws.send(JSON.stringify(subscribePayload));
            };

            ws.onmessage = (evt) => {
                let msg: any;
                try {
                    msg = JSON.parse(String(evt.data));
                } catch {
                    return;
                }

                if (msg?.arg?.channel !== CHANNEL) return;
                const tickers: OkxTicker[] = msg?.data || [];
                if (!Array.isArray(tickers) || tickers.length === 0) return;

                setData((prev) => {
                    const next = { ...prev };
                    for (const t of tickers) {
                        const instId = String(t.instId || '');
                        if (!instId) continue;
                        const last = toNumber(t.last);
                        const open24h = toNumber(t.open24h);
                        const ts = toNumber(t.ts);
                        const changePct24h =
                            last !== null && open24h !== null && open24h > 0
                                ? ((last - open24h) / open24h) * 100
                                : null;
                        next[instId] = {
                            last,
                            changePct24h,
                            ts,
                        };
                    }
                    return next;
                });
            };

            ws.onerror = () => {
                // Let onclose handle reconnect
            };

            ws.onclose = () => {
                if (!mountedRef.current) return;
                setStatus('disconnected');
                const wait = backoffRef.current;
                backoffRef.current = Math.min(backoffRef.current * 2, 30000);
                reconnectTimer.current = window.setTimeout(connect, wait);
            };
        }

        connect();
        return () => {
            mountedRef.current = false;
            cleanup();
        };
    }, [subscribePayload]);

    return { data, status };
}
