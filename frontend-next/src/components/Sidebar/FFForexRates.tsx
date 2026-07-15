'use client';

import { Card } from '@tremor/react';
import { useEffect, useState } from 'react';
import { getFFWS, FFPrice } from '@/lib/ffWS';
import { useLanguage } from '@/lib/languageContext';
import { translations } from '@/lib/translations';

const ITEMS = [
    { channel: 'EUR/USD', label: 'EUR/USD', fmt: (p: number) => p.toFixed(4) },
    { channel: 'GBP/USD', label: 'GBP/USD', fmt: (p: number) => p.toFixed(4) },
    { channel: 'USD/JPY', label: 'USD/JPY', fmt: (p: number) => p.toFixed(2) },
    { channel: 'AUD/USD', label: 'AUD/USD', fmt: (p: number) => p.toFixed(4) },
    { channel: 'USD/CHF', label: 'USD/CHF', fmt: (p: number) => p.toFixed(4) },
];

export default function FFForexRates() {
    const { lang } = useLanguage();
    const t = translations[lang].dashboard;
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
        <Card className="p-0 overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm rounded-2xl">
            <div className="flex items-center gap-2 px-5 py-5">
                <div className="flex items-center gap-2">
                    <span className="text-2xl">💱</span>
                    <span className="text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">{t.forex}</span>
                </div>
            </div>

            <div className="px-5 pb-2">
                {loaded.length === 0 ? (
                    <div className="space-y-3 pb-3">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="flex justify-between items-center">
                                <div className="h-3 w-16 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
                                <div className="h-3 w-20 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
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
                                    className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-800/50 last:border-0">
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                        {item.label}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                                            {item.fmt(snap.price)}
                                        </span>
                                        <span className={`text-xs font-semibold tabular-nums ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
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
