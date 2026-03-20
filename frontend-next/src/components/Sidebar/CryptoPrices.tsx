'use client';

import { Card } from '@tremor/react';
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

const INSTRUMENTS: { instId: string; label: string }[] = [
    { instId: 'BTC-USDT', label: 'BTC' },
    { instId: 'ETH-USDT', label: 'ETH' },
    { instId: 'SOL-USDT', label: 'SOL' },
    { instId: 'XRP-USDT', label: 'XRP' },
];

type Direction = 'up' | 'unchanged' | 'down';

function vietcapArrowUrls(direction: Direction): { light: string; dark: string } {
    const base = 'https://trading.vietcap.com.vn/vietcap-priceboard/images';
    if (direction === 'up') {
        return {
            light: `${base}/light/arrow-top-right.svg`,
            dark: `${base}/dark/arrow-top-right.svg`,
        };
    }
    if (direction === 'down') {
        return {
            light: `${base}/light/arrow-bottom-left.svg`,
            dark: `${base}/dark/arrow-bottom-left.svg`,
        };
    }
    return {
        light: `${base}/light/unchanged.svg`,
        dark: `${base}/dark/unchanged.svg`,
    };
}

function TrendIcon({ direction, alt }: { direction: Direction; alt: string }) {
    const icon = vietcapArrowUrls(direction);
    return (
        <span className="inline-flex items-center mr-0.5">
            <img src={icon.light} alt={alt} className="block dark:hidden size-3" loading="lazy" decoding="async" />
            <img src={icon.dark} alt={alt} className="hidden dark:block size-3" loading="lazy" decoding="async" />
        </span>
    );
}

function toNumber(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function formatPrice(symbol: string, price: number): string {
    const decimals = symbol === 'BTC' ? 2 : 4;
    return price.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
    });
}

export default function CryptoPrices() {
    const [data, setData] = useState<Record<string, TickerState>>({});
    const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimer = useRef<number | null>(null);
    const backoffRef = useRef(1000);
    const mountedRef = useRef(true);

    const subscribePayload = useMemo(
        () => ({
            op: 'subscribe',
            args: INSTRUMENTS.map((i) => ({ channel: CHANNEL, instId: i.instId })),
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
            if (wsRef.current) {
                try {
                    wsRef.current.close();
                } catch {
                    // ignore
                }
                wsRef.current = null;
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

    return (
        <Card className="mt-4 p-0 overflow-hidden bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl">
            <div className="flex items-center justify-between gap-2 px-5 py-4">
                <div className="flex items-center gap-2">
                    <span className="text-xl">🪙</span>
                    <span className="text-base font-bold text-gray-900 dark:text-gray-100">Crypto (OKX)</span>
                </div>
                <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                    {status === 'connected' ? 'Live' : status === 'connecting' ? '...' : 'Reconnecting'}
                </span>
            </div>

            <div className="px-5 pb-2">
                <div className="flex flex-col">
                    {INSTRUMENTS.map((it) => {
                        const st = data[it.instId];
                        const last = st?.last;
                        const pct = st?.changePct24h;
                        const isUp = (pct ?? 0) >= 0;
                        const isDown = (pct ?? 0) < 0;
                        return (
                            <div
                                key={it.instId}
                                className="flex items-center justify-between py-3 border-b border-gray-50 dark:border-gray-800/50 last:border-0"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold text-sm bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                        {it.label}
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className="text-[13px] font-bold text-gray-700 dark:text-gray-200 truncate">
                                            {it.label}/USDT
                                        </span>
                                        <span className="text-[11px] text-gray-600 dark:text-gray-400 font-medium">{it.instId}</span>
                                    </div>
                                </div>

                                <div className="flex flex-col items-end gap-0.5 shrink-0">
                                    <span className="text-[13px] font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                                        {typeof last === 'number' ? formatPrice(it.label, last) : '—'}
                                    </span>
                                    <span
                                        className={
                                            'inline-flex items-center text-[11px] font-bold tabular-nums ' +
                                            (pct == null
                                                ? 'text-gray-500 dark:text-gray-400'
                                                : isUp
                                                  ? 'text-emerald-600'
                                                  : 'text-rose-500')
                                        }
                                    >
                                        {pct == null ? (
                                            ''
                                        ) : (
                                            <>
                                                <TrendIcon
                                                    direction={isDown ? 'down' : pct === 0 ? 'unchanged' : 'up'}
                                                    alt={isDown ? 'Giảm' : pct === 0 ? 'Đứng giá' : 'Tăng'}
                                                />
                                                {`${isUp ? '+' : ''}${pct.toFixed(2)}%`}
                                            </>
                                        )}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </Card>
    );
}
