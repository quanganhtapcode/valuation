'use client';

import MarketChange from './MarketChange';

import SidebarCard from './SidebarCard';
import { useEffect, useState } from 'react';
import { getFFWS, FFPrice } from '@/lib/ffWS';
import { useLanguage } from '@/lib/languageContext';
import { translations } from '@/lib/translations';

const ITEMS = [
    { channel: 'SPX/USD',    label: 'S&P 500',    fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
    { channel: 'NDX/USD',    label: 'Nasdaq 100', fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
    { channel: 'Dow/USD',    label: 'Dow Jones',  fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
    { channel: 'VIX/USD',    label: 'VIX',        fmt: (p: number) => p.toFixed(2) },
    { channel: 'DXY/USD',    label: 'USD Index',  fmt: (p: number) => p.toFixed(2) },
    { channel: 'Gold/USD',   label: 'Gold',       fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
    { channel: 'WTI/USD',    label: 'WTI Oil',    fmt: (p: number) => p.toFixed(2) },
    { channel: 'Nikkei/JPY', label: 'Nikkei 225', fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) },
    { channel: 'KOSPI/USD',  label: 'KOSPI',      fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
];

export default function FFWorldMarkets() {
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
        <SidebarCard title={t.worldMarkets} icon="🌍">
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
                            return (
                                <div key={item.channel}
                                    className="flex min-w-0 items-center justify-between gap-2 py-3 border-b border-gray-100 dark:border-gray-800/50 last:border-0">
                                    <span className="min-w-0 text-sm font-medium text-gray-700 dark:text-gray-300">
                                        {item.label}
                                    </span>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                                            {item.fmt(snap.price)}
                                        </span>
                                        <MarketChange value={snap.changePercent} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </SidebarCard>
    );
}
