'use client';

import { Card } from '@tremor/react';
import { useEffect, useState } from 'react';
import { getFFWS, FFPrice } from '@/lib/ffWS';

const ITEMS = [
    { channel: 'SPX/USD',    label: 'S&P 500',    fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
    { channel: 'NDX/USD',    label: 'Nasdaq 100', fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
    { channel: 'Dow/USD',    label: 'Dow Jones',  fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
    { channel: 'VIX/USD',    label: 'VIX',        fmt: (p: number) => p.toFixed(2) },
    { channel: 'DXY/USD',    label: 'USD Index',  fmt: (p: number) => p.toFixed(2) },
    { channel: 'Gold/USD',   label: 'Gold',       fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
    { channel: 'WTI/USD',    label: 'WTI Oil',    fmt: (p: number) => p.toFixed(2) },
    { channel: 'Nikkei/JPY', label: 'Nikkei 225', fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) },
];

export default function FFWorldMarkets() {
    const [prices, setPrices] = useState<Map<string, FFPrice>>(new Map());

    useEffect(() => {
        const ws = getFFWS();
        const unsubs = ITEMS.map(item =>
            ws.subscribe(item.channel, (snap: FFPrice) =>
                setPrices(prev => new Map(prev).set(item.channel, snap))
            )
        );
        return () => unsubs.forEach(fn => fn());
    }, []);

    const loaded = ITEMS.filter(it => prices.has(it.channel));

    return (
        <Card className="p-0 overflow-hidden bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl">
            <div className="flex items-center justify-between gap-2 px-5 py-4">
                <div className="flex items-center gap-2">
                    <span className="text-xl">🌍</span>
                    <span className="text-base font-bold text-gray-900 dark:text-gray-100">Thị Trường Thế Giới</span>
                </div>
                <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                    {loaded.length > 0 ? 'Live' : '...'}
                </span>
            </div>

            <div className="px-5 pb-2">
                {loaded.length === 0 ? (
                    <div className="space-y-3 pb-3">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="flex justify-between items-center">
                                <div className="h-3 w-20 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
                                <div className="h-3 w-16 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col">
                        {ITEMS.map(item => {
                            const snap = prices.get(item.channel);
                            if (!snap) return null;
                            const up = snap.changePercent >= 0;
                            return (
                                <div key={item.channel}
                                    className="flex items-center justify-between py-2.5 border-b border-gray-50 dark:border-gray-800/50 last:border-0">
                                    <span className="text-[12px] font-semibold text-gray-600 dark:text-gray-400">
                                        {item.label}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[12px] font-bold tabular-nums text-gray-900 dark:text-gray-100">
                                            {item.fmt(snap.price)}
                                        </span>
                                        <span className={`text-[11px] font-bold tabular-nums ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                                            {up ? '+' : ''}{snap.changePercent.toFixed(2)}%
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </Card>
    );
}
