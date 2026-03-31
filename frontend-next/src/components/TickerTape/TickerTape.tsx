'use client';

import { useEffect, useState } from 'react';
import { getFFWS, FFPrice } from '@/lib/ffWS';

interface TapeItem {
  channel: string;
  label: string;
  formatPrice: (p: number) => string;
}

const TAPE_ITEMS: TapeItem[] = [
  { channel: 'EUR/USD',  label: 'EUR/USD',  formatPrice: (p) => p.toFixed(4) },
  { channel: 'GBP/USD',  label: 'GBP/USD',  formatPrice: (p) => p.toFixed(4) },
  { channel: 'USD/JPY',  label: 'USD/JPY',  formatPrice: (p) => p.toFixed(2) },
  { channel: 'AUD/USD',  label: 'AUD/USD',  formatPrice: (p) => p.toFixed(4) },
  { channel: 'USD/CHF',  label: 'USD/CHF',  formatPrice: (p) => p.toFixed(4) },
  { channel: 'USD/CAD',  label: 'USD/CAD',  formatPrice: (p) => p.toFixed(4) },
  { channel: 'NZD/USD',  label: 'NZD/USD',  formatPrice: (p) => p.toFixed(4) },
  { channel: 'SPX/USD',  label: 'S&P 500',  formatPrice: (p) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
  { channel: 'NAS/USD',  label: 'Nasdaq',   formatPrice: (p) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
  { channel: 'DJIA/USD', label: 'DJIA',     formatPrice: (p) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
  { channel: 'DAX/EUR',  label: 'DAX',      formatPrice: (p) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
  { channel: 'FTSE/GBP', label: 'FTSE',    formatPrice: (p) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
  { channel: 'NIK/JPY',  label: 'Nikkei',   formatPrice: (p) => p.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) },
  { channel: 'GOLD/USD', label: 'XAU/USD',  formatPrice: (p) => p.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
  { channel: 'WTIC/USD', label: 'WTI Oil',  formatPrice: (p) => p.toFixed(2) },
  { channel: 'BTC/USD',  label: 'Bitcoin',  formatPrice: (p) => p.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) },
  { channel: 'ETH/USD',  label: 'Ethereum', formatPrice: (p) => p.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) },
];

export default function TickerTape() {
  const [prices, setPrices] = useState<Map<string, FFPrice>>(new Map());

  useEffect(() => {
    const ws = getFFWS();
    const unsubs = TAPE_ITEMS.map(item =>
      ws.subscribe(item.channel, (snap: FFPrice) => {
        setPrices(prev => new Map(prev).set(item.channel, snap));
      })
    );
    return () => unsubs.forEach(fn => fn());
  }, []);

  const activeItems = TAPE_ITEMS.filter(it => prices.has(it.channel));

  // Skeleton while connecting
  if (activeItems.length === 0) {
    return (
      <div className="fixed z-40 h-6 overflow-hidden bg-white/80 backdrop-blur-md border border-gray-200/50 dark:border-gray-800/50 dark:bg-gray-950/80 top-[72px] md:top-[92px] left-1/2 -translate-x-1/2 w-[calc(100%-16px)] max-w-7xl shadow-sm rounded-full">
        <div className="h-full flex items-center px-6 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-2.5 rounded-full bg-gray-200 dark:bg-gray-800 animate-pulse" style={{ width: `${48 + (i % 3) * 16}px` }} />
          ))}
        </div>
      </div>
    );
  }

  const items = [...activeItems, ...activeItems];
  const duration = Math.max(30, activeItems.length * 6);

  return (
    <div className="fixed z-40 h-6 overflow-hidden bg-white/80 backdrop-blur-md border border-gray-200/50 dark:border-gray-800/50 dark:bg-gray-950/80 top-[72px] md:top-[92px] left-1/2 -translate-x-1/2 w-[calc(100%-16px)] max-w-7xl shadow-sm rounded-full">
      <div className="h-full flex items-center px-4">
        <style dangerouslySetInnerHTML={{
          __html: `
          @keyframes ticker-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
          .ticker-track { animation: ticker-scroll linear infinite; width: max-content; }
          .ticker-track:hover { animation-play-state: paused; }
        `}} />
        <div className="ticker-track flex items-center h-full whitespace-nowrap" style={{ animationDuration: `${duration}s` }}>
          {items.map((item, i) => {
            const snap = prices.get(item.channel)!;
            const up   = snap.changePercent > 0;
            const down = snap.changePercent < 0;
            const colorCls = up
              ? 'text-emerald-600 dark:text-emerald-400'
              : down
                ? 'text-rose-500 dark:text-rose-400'
                : 'text-yellow-600 dark:text-yellow-400';
            return (
              <span key={`${item.channel}-${i}`} className="inline-flex items-center gap-2 px-4 text-[11px] font-medium">
                <span className="text-gray-500 dark:text-gray-400 font-semibold">{item.label}</span>
                <span className="text-gray-900 dark:text-gray-100 font-semibold tabular-nums">
                  {item.formatPrice(snap.price)}
                </span>
                <span className={`tabular-nums font-bold ${colorCls}`}>
                  {snap.changePercent > 0 ? '+' : ''}{snap.changePercent.toFixed(2)}%
                </span>
                <span className="text-gray-200 dark:text-gray-700 select-none">|</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
