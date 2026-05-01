'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { API_BASE, isTradingHours, PRICE_SYNC_INTERVAL_MS } from '@/lib/api';

//  Types
interface Stock { ticker: string; cap: number; change: number; price: number; name: string; sector: string }
interface Sector { name: string; shortName: string; totalCap: number; avgChange: number; stocks: Stock[] }
interface HeatmapData { sectors: Sector[] }
interface TileRect { x: number; y: number; w: number; h: number }
interface TileItem<T> { item: T; rect: TileRect }

interface HeatmapVN30Props {
  externalData?: HeatmapData | null;
  useExternalOnly?: boolean;
}

type HeatmapExchange = 'HSX' | 'HNX' | 'UPCOM';

const HEATMAP_EXCHANGES: { value: HeatmapExchange; label: string }[] = [
  { value: 'HSX', label: 'HOSE' },
  { value: 'HNX', label: 'HNX' },
  { value: 'UPCOM', label: 'UPCOM' },
];

//  Squarify Treemap
function worstAspect(rowAreas: number[], longSide: number): number {
  if (!rowAreas.length || longSide === 0) return Infinity;
  const s = rowAreas.reduce((a, b) => a + b, 0);
  const rmax = Math.max(...rowAreas);
  const rmin = Math.min(...rowAreas);
  const l2 = longSide * longSide;
  const s2 = s * s;
  return Math.max((rmax * l2) / s2, s2 / (rmin * l2));
}

function squarifyTile<T>(
  items: T[],
  getValue: (d: T) => number,
  x0: number, y0: number, x1: number, y1: number,
): TileItem<T>[] {
  const filtered = items.filter(d => getValue(d) > 0);
  if (!filtered.length) return [];
  const sorted = [...filtered].sort((a, b) => getValue(b) - getValue(a));
  const totalValue = sorted.reduce((s, d) => s + getValue(d), 0);
  const totalArea = (x1 - x0) * (y1 - y0);
  const nodes = sorted.map(d => ({ item: d, area: (getValue(d) / totalValue) * totalArea }));
  const result: TileItem<T>[] = [];
  function place(ns: typeof nodes, rx0: number, ry0: number, rx1: number, ry1: number) {
    const rw = rx1 - rx0, rh = ry1 - ry0;
    if (!ns.length || rw <= 0 || rh <= 0) return;
    if (ns.length === 1) { result.push({ item: ns[0].item, rect: { x: rx0, y: ry0, w: rw, h: rh } }); return; }
    const horiz = rw >= rh;
    const longSide = horiz ? rw : rh;
    const row = [ns[0]]; let i = 1;
    while (i < ns.length) {
      const cand = [...row, ns[i]].map(n => n.area);
      if (worstAspect(cand, longSide) <= worstAspect(row.map(n => n.area), longSide)) { row.push(ns[i++]); } else break;
    }
    const rowArea = row.reduce((s, n) => s + n.area, 0);
    const stripThick = rowArea / longSide;
    let offset = horiz ? rx0 : ry0;
    for (const n of row) {
      const cellLen = (n.area / rowArea) * longSide;
      result.push({
        item: n.item, rect: horiz
          ? { x: offset, y: ry0, w: cellLen, h: stripThick }
          : { x: rx0, y: offset, w: stripThick, h: cellLen }
      });
      offset += cellLen;
    }
    const rem = ns.slice(row.length);
    if (rem.length) {
      if (horiz) place(rem, rx0, ry0 + stripThick, rx1, ry1);
      else place(rem, rx0 + stripThick, ry0, rx1, ry1);
    }
  }
  place(nodes, x0, y0, x1, y1);
  return result;
}

//  Color Scale
function changeColor(pct: number): string {
  if (pct === undefined || pct === null) return '#ffffff';
  if (pct <= -5) return '#f4889a';
  if (pct <= -2) return '#f8a9b4';
  if (pct < 0) return '#fce0e3';
  if (pct === 0) return '#f3f4f6';
  if (pct < 2) return '#e0f3d8';
  if (pct < 5) return '#bceaa8';
  return '#8bd071';
}

function textColor(_pct: number): string {
  return '#0f172a';
}

function sectorTextColor(pct: number): string {
  if (pct > 0) return '#065f46';
  if (pct < 0) return '#991b1b';
  return '#64748b';
}

const SECTOR_PAD = 4;
const STOCK_GAP = 1.5;
const LABEL_H = 20;

//  Component
export default function HeatmapVN30({ externalData = null, useExternalOnly = false }: HeatmapVN30Props) {
  const [data, setData] = useState<HeatmapData | null>(null);
  const [exchange, setExchange] = useState<HeatmapExchange>('HSX');
  const [cw, setCw] = useState(800);
  const [ch, setCh] = useState(600);
  const [isDark, setIsDark] = useState(false);
  const [hover, setHover] = useState<{
    ticker: string; change: number; price: number; cap: number;
    name: string; sector: string;
    mx: number; my: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Derive loading from data being null — polling updates never trigger a spinner flash
  const loading = data === null;

  // Responsive sizing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const w = el.clientWidth || 800;
      setCw(w);
      setCh(w < 640 ? 450 : 600);
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Dark mode detection
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const check = () => setIsDark(document.documentElement.classList.contains('dark') || mq.matches);
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  // Reset data (shows spinner) when exchange changes
  useEffect(() => {
    setData(null);
    setHover(null);
  }, [exchange]);

  const load = useCallback(async () => {
    try {
      setHover(null);
      const r = await fetch(`${API_BASE}/market/heatmap?exchange=${exchange}&limit=200`);
      if (!r.ok) return;
      const d: HeatmapData = await r.json();
      setData(d);
    } catch { /* silent */ }
  }, [exchange]);

  useEffect(() => {
    if (!externalData) return;
    setData(externalData);
  }, [externalData]);

  useEffect(() => {
    if (useExternalOnly) return;
    load();
    if (!isTradingHours()) return;
    // Poll every 15s — no setLoading(true) so no spinner flicker on updates
    const timer = setInterval(load, PRICE_SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load, useExternalOnly]);

  const svgBg = isDark ? '#0f1117' : '#ffffff';
  const labelBg = isDark ? '#0f1117' : '#ffffff';
  const labelText = isDark ? '#94a3b8' : '#64748b';

  const sectorTiles = squarifyTile(data?.sectors ?? [], s => s.totalCap, 0, 0, cw, ch);

  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1117] p-0.5 shadow-sm overflow-hidden">
      {!useExternalOnly && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Market Heatmap</h3>
          <div className="grid grid-cols-3 rounded-md border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-900">
            {HEATMAP_EXCHANGES.map(item => (
              <button
                key={item.value}
                type="button"
                onClick={() => setExchange(item.value)}
                className={`min-w-14 rounded px-2 py-1 text-xs font-semibold transition-colors ${
                  exchange === item.value
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div ref={containerRef} className="relative w-full" style={{ height: ch }}>
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <svg
            width={cw} height={ch}
            style={{
              display: 'block',
              fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif',
              userSelect: 'none'
            }}
            onMouseLeave={() => setHover(null)}
          >
            <rect x={0} y={0} width={cw} height={ch} fill={svgBg} />

            {sectorTiles.map(({ item: sector, rect: sRaw }) => {
              const sx = sRaw.x + SECTOR_PAD;
              const sy = sRaw.y + SECTOR_PAD;
              const sw = Math.max(0, sRaw.w - SECTOR_PAD * 2);
              const sh = Math.max(0, sRaw.h - SECTOR_PAD * 2);
              if (sw < 4 || sh < 4) return null;

              const hasLabel = sw >= 50 && sh >= LABEL_H + 4;
              const labelH = hasLabel ? LABEL_H : 0;

              const stockTiles = squarifyTile(
                sector.stocks, s => s.cap,
                sx, sy + labelH, sx + sw, sy + sh,
              );

              const sign = sector.avgChange >= 0 ? '+' : '';
              const pct = `${sign}${sector.avgChange.toFixed(2)}%`;

              return (
                <g key={sector.name}>
                  <rect x={sx} y={sy} width={sw} height={sh} fill={labelBg} rx={0} />

                  {hasLabel && (
                    <g transform={`translate(${sx}, ${sy})`} style={{ pointerEvents: 'none' }}>
                      <text x={0} y={15} fontSize={11} fontWeight="700" fill={labelText}>
                        {sector.shortName}
                        <tspan dx={6} fill={sectorTextColor(sector.avgChange)} fontSize={10} fontWeight="600">{pct}</tspan>
                      </text>
                    </g>
                  )}

                  {stockTiles.map(({ item: stock, rect: r }) => {
                    const ix = r.x + STOCK_GAP;
                    const iy = r.y + STOCK_GAP;
                    const iw = Math.max(0, r.w - STOCK_GAP * 2);
                    const ih = Math.max(0, r.h - STOCK_GAP * 2);
                    if (iw < 2 || ih < 2) return null;

                    const bg = changeColor(stock.change);
                    const fg = textColor(stock.change);
                    const cx = ix + iw / 2;
                    const cy = iy + ih / 2;
                    const fs = Math.min(14, Math.max(8, Math.min(iw / 4.2, ih / 3.0)));
                    const sortedSectorStocks = [...sector.stocks].sort((a, b) => b.cap - a.cap);
                    const topCapTickers = sortedSectorStocks.slice(0, 3).map(s => s.ticker);
                    const showTicker = iw >= 18 && ih >= 12;
                    const isImportant = topCapTickers.includes(stock.ticker) || Math.abs(stock.change) >= 5;
                    const showPct = isImportant && iw >= 32 && ih >= 30;

                    return (
                      <g
                        key={stock.ticker}
                        style={{ cursor: 'pointer' }}
                        onClick={() => window.open(`/stock/${stock.ticker}`, '_blank')}
                        onMouseMove={e => {
                          const svg = (e.currentTarget as SVGGElement).closest('svg');
                          const br = svg?.getBoundingClientRect();
                          if (!br) return;
                          setHover({
                            ticker: stock.ticker, change: stock.change, price: stock.price,
                            cap: stock.cap, name: stock.name ?? '', sector: stock.sector ?? '',
                            mx: e.clientX - br.left, my: e.clientY - br.top,
                          });
                        }}
                      >
                        <rect x={ix} y={iy} width={iw} height={ih} fill={bg} rx={0} />
                        {showTicker && (
                          <text x={cx} y={cy - (showPct ? fs * 0.75 : 0)} fill={fg} fontSize={fs} fontWeight="800"
                            textAnchor="middle" dominantBaseline="middle" style={{ pointerEvents: 'none', letterSpacing: '-0.02em' }}>
                            {stock.ticker}
                          </text>
                        )}
                        {showPct && (
                          <text x={cx} y={cy + fs * 1.15} fill={fg} fontSize={Math.max(7, fs * 0.85)} fontWeight="600"
                            textAnchor="middle" dominantBaseline="middle" opacity={0.9} style={{ pointerEvents: 'none' }}>
                            {stock.change >= 0 ? '+' : ''}{stock.change.toFixed(2)}%
                          </text>
                        )}
                      </g>
                    );
                  })}

                  <rect x={sx} y={sy} width={sw} height={sh} fill="none"
                    stroke={isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'} strokeWidth={1} rx={0}
                    style={{ pointerEvents: 'none' }} />
                </g>
              );
            })}

            {hover && (() => {
              const TW = 200; const TH = 80;
              let tx = hover.mx + 15; let ty = hover.my + 15;
              if (tx + TW > cw) tx = hover.mx - TW - 15;
              if (ty + TH > ch) ty = hover.my - TH - 15;
              if (tx < 5) tx = 5; if (ty < 5) ty = 5;
              const isUp = hover.change > 0; const isDown = hover.change < 0;
              const color = isUp ? '#065f46' : (isDown ? '#991b1b' : '#64748b');
              const bgSubtle = isUp ? '#f0fdf4' : (isDown ? '#fef2f2' : '#f8fafc');
              const tBg = isDark ? '#1e2230' : '#ffffff';
              const tStroke = isDark ? '#334155' : '#e2e8f0';
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <rect x={tx} y={ty} width={TW} height={TH} fill={tBg} rx={10} stroke={tStroke} strokeWidth={1} filter="drop-shadow(0 4px 8px rgba(0,0,0,0.08))" />
                  <text x={tx + 12} y={ty + 20} fill="#94a3b8" fontSize={10} fontWeight="600">{hover.sector}</text>
                  <text x={tx + 12} y={ty + 42} fill={isDark ? '#f8fafc' : '#0f172a'} fontSize={15} fontWeight="800">{hover.ticker}</text>
                  <text x={tx + 12} y={ty + 58} fill={isDark ? '#f1f5f9' : '#0f172a'} fontSize={13} fontWeight="700">
                    {hover.price > 0 ? hover.price.toLocaleString('vi-VN') : '--'}
                  </text>
                  <g transform={`translate(${tx + 105}, ${ty + 44})`}>
                    <rect x={0} y={0} width={80} height={18} rx={6} fill={bgSubtle} />
                    <text x={6} y={13} fill={color} fontSize={11} fontWeight="800">
                      {isUp ? '▲' : (isDown ? '▼' : '—')} {Math.abs(hover.change).toFixed(2)}%
                    </text>
                  </g>
                </g>
              );
            })()}
          </svg>
        )}
      </div>
    </div>
  );
}
