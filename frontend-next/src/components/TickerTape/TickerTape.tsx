'use client';

import { useEffect, useState, useRef } from 'react';
import { API_BASE } from '@/lib/api';

interface WorldIndex {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

function formatPrice(price: number): string {
  if (price >= 10000) return price.toLocaleString('en', { maximumFractionDigits: 0 });
  if (price >= 1000) return price.toLocaleString('en', { maximumFractionDigits: 2 });
  return price.toLocaleString('en', { maximumFractionDigits: 2 });
}

export default function TickerTape() {
  const [indices, setIndices] = useState<WorldIndex[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const load = async () => {
    try {
      const r = await fetch(`${API_BASE}/market/world-indices`);
      if (!r.ok) return;
      const data: WorldIndex[] = await r.json();
      if (Array.isArray(data) && data.length > 0) {
        setIndices(prev => {
          // Merge logic: preserve existing WS updates if any
          const merged = data.map(newItem => {
            const existing = prev.find(p => p.symbol === newItem.symbol);
            if (existing && (newItem.symbol === 'BTC-USD' || newItem.symbol === 'ETH-USD' || newItem.symbol === 'SOL-USD' || newItem.symbol === 'XRP-USD')) {
              // Only merge if we don't have WS data yet or keep WS one
              return { ...newItem, ...existing };
            }
            return newItem;
          });
          return merged;
        });
      }
    } catch { /* silently fail */ }
  };

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, 30_000); // Poll indices every 30s

    // OKX WebSocket for live Crypto on Tape
    const WS_URL = 'wss://ws.okx.com:8443/ws/v5/public';
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        op: 'subscribe',
        args: [
          { channel: 'tickers', instId: 'BTC-USDT' },
          { channel: 'tickers', instId: 'ETH-USDT' },
          { channel: 'tickers', instId: 'SOL-USDT' },
          { channel: 'tickers', instId: 'XRP-USDT' },
        ],
      }));
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.arg?.channel === 'tickers' && msg.data?.[0]) {
          const t = msg.data[0];
          const symMap: Record<string, string> = {
            'BTC-USDT': 'BTC-USD',
            'ETH-USDT': 'ETH-USD',
            'SOL-USDT': 'SOL-USD',
            'XRP-USDT': 'XRP-USD',
          };
          const targetSym = symMap[t.instId];
          const last = parseFloat(t.last);
          const open = parseFloat(t.open24h);
          if (targetSym && !isNaN(last) && !isNaN(open)) {
            setIndices(current => current.map(idx =>
              idx.symbol === targetSym
                ? { ...idx, price: last, changePercent: ((last - open) / open) * 100 }
                : idx
            ));
          }
        }
      } catch { /* ignore */ }
    };

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  if (indices.length === 0) return null;

  // Duplicate items for seamless loop
  const items = [...indices, ...indices];

  const duration = Math.max(30, indices.length * 8);

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
          {items.map((idx, i) => {
            const up = idx.changePercent > 0;
            const down = idx.changePercent < 0;
            const colorCls = up
              ? 'text-emerald-600 dark:text-emerald-400'
              : down
                ? 'text-rose-500 dark:text-rose-400'
                : 'text-yellow-600 dark:text-yellow-400';
            return (
              <span key={i} className="inline-flex items-center gap-2 px-4 text-[11px] font-medium">
                {(idx.symbol === 'BTC-USD' || idx.symbol === 'ETH-USD' || idx.symbol === 'SOL-USD' || idx.symbol === 'XRP-USD') && (
                  <img
                    src={`https://img.logo.dev/crypto/${idx.symbol.replace('-', '')}?token=pk_NNp9abu9TMm9II6Z0666YA&format=png&fallback=404&size=50`}
                    alt="" className="w-4 h-4 rounded-sm shadow-sm"
                  />
                )}
                <span className="text-gray-500 dark:text-gray-400 font-semibold">{idx.name}</span>
                <span className="text-gray-900 dark:text-gray-100 font-semibold tabular-nums">
                  {formatPrice(idx.price)}
                </span>
                <span className={`tabular-nums font-bold ${colorCls}`}>
                  {idx.changePercent > 0 ? '+' : ''}{idx.changePercent.toFixed(2)}%
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
