'use client';

import MarketChange from './MarketChange';
import Image from 'next/image';

import SidebarCard from './SidebarCard';
import { useEffect, useState } from 'react';
import { getFFWS, FFPrice } from '@/lib/ffWS';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/translations';

const ITEMS = [
    { channel: 'SPX/USD',    label: 'S&P 500',    fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
    { channel: 'NDX/USD',    label: 'Nasdaq 100', fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
    { channel: 'Dow/USD',    label: 'Dow Jones',  fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
    { channel: 'DXY/USD',    label: 'USD Index',  fmt: (p: number) => p.toFixed(2) },
    { channel: 'Gold/USD',   label: 'Gold',       fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
    { channel: 'WTI/USD',    label: 'WTI Oil',    fmt: (p: number) => p.toFixed(2) },
    { channel: 'Nikkei/JPY', label: 'Nikkei 225', fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) },
    { channel: 'KOSPI/USD',  label: 'KOSPI',      fmt: (p: number) => p.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
];

const MARKET_LOGOS: Record<string, string> = {
    'SPX/USD': 'https://commons.wikimedia.org/wiki/Special:FilePath/S%26P%20Global%20logo.svg',
    'NDX/USD': 'https://commons.wikimedia.org/wiki/Special:FilePath/NASDAQ%20Logo.svg',
    'Dow/USD': 'https://commons.wikimedia.org/wiki/Special:FilePath/Dow%20Jones%20Logo.svg',
    'Nikkei/JPY': 'https://commons.wikimedia.org/wiki/Special:FilePath/Nikkei%20Logo.svg',
    'KOSPI/USD': 'https://commons.wikimedia.org/wiki/Special:FilePath/Korea%20Exchange%20Logo.svg',
};

function MarketLogo({ channel, label }: { channel: string; label: string }) {
    const [errored, setErrored] = useState(false);
    const src = MARKET_LOGOS[channel];
    const symbol = channel === 'DXY/USD' ? '$' : channel === 'Gold/USD' ? 'Au' : channel === 'WTI/USD' ? '●' : label.slice(0, 2);

    return (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-tremor-border bg-white dark:border-dark-tremor-border">
            {src && !errored ? (
                <Image src={src} alt="" width={36} height={36} unoptimized
                    className="h-full w-full object-contain p-1" onError={() => setErrored(true)} />
            ) : (
                <span className={`font-bold ${channel === 'Gold/USD' ? 'text-amber-600' : channel === 'WTI/USD' ? 'text-slate-700' : 'text-tremor-content'} ${symbol.length === 1 ? 'text-lg' : 'text-xs'}`}>
                    {channel === 'WTI/USD' ? (
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                            <path d="M12 2C9.8 5.3 5.5 10.1 5.5 14.6a6.5 6.5 0 0 0 13 0C18.5 10.1 14.2 5.3 12 2Z" />
                        </svg>
                    ) : symbol}
                </span>
            )}
        </span>
    );
}

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
        <SidebarCard title={t.worldMarkets}>
            <div className="px-4 pb-2">
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
                                    <div className="flex min-w-0 items-center gap-2">
                                        <MarketLogo channel={item.channel} label={item.label} />
                                        <span className="min-w-0 text-sm font-medium text-gray-700 dark:text-gray-300">
                                            {item.label}
                                        </span>
                                    </div>
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
