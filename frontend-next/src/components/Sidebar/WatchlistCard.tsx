'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Card } from '@tremor/react';
import { RiEqualizerLine, RiCloseLine, RiArrowRightSLine, RiSearchLine } from '@remixicon/react';
import { useWatchlist } from '@/lib/watchlistContext';
import { formatNumber, isTradingHours, PRICE_SYNC_INTERVAL_MS, IDLE_REFRESH_INTERVAL_MS } from '@/lib/api';
import { getTickerData } from '@/lib/tickerCache';
import { siteConfig } from '@/app/siteConfig';

interface ExternalWatchlistPrice {
    price: number;
    changePercent: number;
}

interface WatchlistCardProps {
    externalPrices?: Record<string, ExternalWatchlistPrice>;
    useExternalOnly?: boolean;
}

interface WatchItem {
    symbol: string;
    name: string;
    exchange: string;
    price: number;
    changePercent: number;
    loading: boolean;
}

interface TickerEntry {
    symbol: string;
    name: string;
    exchange: string;
}

function StockLogo({ symbol }: { symbol: string }) {
    const [errored, setErrored] = useState(false);
    return (
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-white dark:bg-gray-800 border border-tremor-border dark:border-dark-tremor-border overflow-hidden flex items-center justify-center">
            {!errored ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                    src={siteConfig.stockLogoUrl(symbol)}
                    alt={symbol}
                    className="w-full h-full object-contain p-0.5"
                    onError={() => setErrored(true)}
                />
            ) : (
                <span className="text-[9px] font-bold text-tremor-content dark:text-dark-tremor-content">
                    {symbol.slice(0, 2)}
                </span>
            )}
        </div>
    );
}

export default function WatchlistCard({ externalPrices = {}, useExternalOnly = false }: WatchlistCardProps) {
    const { watchlist, toggle, removeSymbol } = useWatchlist();
    const [items, setItems] = useState<WatchItem[]>([]);
    const [collapsed, setCollapsed] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [allTickers, setAllTickers] = useState<TickerEntry[]>([]);
    const searchRef = useRef<HTMLInputElement>(null);

    const enrichWithMeta = useCallback(async (symbols: string[]) => {
        const td = await getTickerData();
        return symbols.map(sym => {
            const t = td?.tickers?.find((t: TickerEntry) => t.symbol.toUpperCase() === sym);
            return { symbol: sym, name: t?.name || sym, exchange: t?.exchange || '' };
        });
    }, []);

    useEffect(() => {
        if (!modalOpen) return;
        getTickerData().then(td => {
            if (td?.tickers) setAllTickers(td.tickers);
        });
        setTimeout(() => searchRef.current?.focus(), 50);
    }, [modalOpen]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (watchlist.length === 0) { setItems([]); return; }

        enrichWithMeta(watchlist).then(metas => {
            setItems(prev => {
                const map = new Map(prev.map(i => [i.symbol, i]));
                return metas.map(m => ({
                    ...m,
                    price: map.get(m.symbol)?.price ?? 0,
                    changePercent: map.get(m.symbol)?.changePercent ?? 0,
                    loading: map.has(m.symbol) ? map.get(m.symbol)!.loading : true,
                }));
            });
        });

        if (useExternalOnly) {
            return;
        }

        const ctrl = new AbortController();
        const fetchPrices = () => {
            fetch(`/api/market/prices?symbols=${watchlist.join(',')}`, { signal: ctrl.signal })
                .then(r => r.ok ? r.json() : null)
                .then((data: Record<string, { price: number; changePercent: number }> | null) => {
                    if (!data) return;
                    setItems(prev => prev.map(i => {
                        const snap = data[i.symbol];
                        if (!snap) return { ...i, loading: false };
                        return { ...i, price: snap.price, changePercent: snap.changePercent, loading: false };
                    }));
                })
                .catch(() => {});
        };
        fetchPrices();
        const interval = setInterval(fetchPrices, isTradingHours() ? PRICE_SYNC_INTERVAL_MS : IDLE_REFRESH_INTERVAL_MS);
        return () => { ctrl.abort(); clearInterval(interval); };
    }, [watchlist, enrichWithMeta, useExternalOnly]);

    useEffect(() => {
        if (watchlist.length === 0 || Object.keys(externalPrices).length === 0) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setItems(prev => prev.map(item => {
            const snap = externalPrices[item.symbol];
            if (!snap) return item;
            return {
                ...item,
                price: snap.price,
                changePercent: snap.changePercent,
                loading: false,
            };
        }));
    }, [watchlist, externalPrices]);

    const q = searchQuery.trim().toUpperCase();
    const searchResults = q.length >= 1
        ? allTickers.filter(t => t.symbol.toUpperCase().includes(q) || t.name.toUpperCase().includes(q)).slice(0, 8)
        : [];

    const closeModal = () => { setModalOpen(false); setSearchQuery(''); };

    if (watchlist.length === 0 && !modalOpen) return (
        <Card className="p-0 overflow-hidden border-tremor-border dark:border-dark-tremor-border shadow-sm">
            <div className="px-4 py-3">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">Watchlist</span>
                    <button type="button" onClick={() => setModalOpen(true)} className="p-1.5 rounded-md text-tremor-content hover:bg-tremor-background-muted dark:hover:bg-dark-tremor-background-muted transition-colors">
                        <RiEqualizerLine className="h-4 w-4" />
                    </button>
                </div>
                <p className="text-xs text-tremor-content dark:text-dark-tremor-content mt-1">Nhấn icon để thêm cổ phiếu.</p>
            </div>
        </Card>
    );

    return (
        <>
            {watchlist.length > 0 && (
                <Card className="p-0 overflow-hidden border-tremor-border dark:border-dark-tremor-border shadow-sm">
                    <div className="flex items-center gap-1 px-4 py-3">
                        <button type="button" onClick={() => setCollapsed(v => !v)} className="flex items-center gap-1 flex-1 min-w-0 text-left">
                            <span className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">Watchlist</span>
                            <RiArrowRightSLine className={`h-4 w-4 text-tremor-content dark:text-dark-tremor-content transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`} />
                        </button>
                        <button type="button" onClick={() => setModalOpen(true)} title="Chỉnh sửa Watchlist"
                            className="p-1.5 rounded-md text-tremor-content hover:text-tremor-content-strong hover:bg-tremor-background-muted dark:text-dark-tremor-content dark:hover:text-dark-tremor-content-strong dark:hover:bg-dark-tremor-background-muted transition-colors">
                            <RiEqualizerLine className="h-4 w-4" />
                        </button>
                    </div>
                    {!collapsed && (
                        <div className="divide-y divide-tremor-border dark:divide-dark-tremor-border">
                            {items.map(item => (
                                <div key={item.symbol} className="flex items-center gap-2 px-4 py-2.5">
                                    <StockLogo symbol={item.symbol} />
                                    <Link href={`/stock/${item.symbol}`} prefetch={false} className="flex-1 min-w-0 hover:opacity-75 transition-opacity">
                                        <div className="text-sm font-medium text-tremor-content-strong dark:text-dark-tremor-content-strong truncate leading-tight">{item.name}</div>
                                        <div className="text-xs text-tremor-content dark:text-dark-tremor-content">{item.symbol}{item.exchange ? `  ${item.exchange}` : ''}</div>
                                    </Link>
                                    <div className="flex-shrink-0 text-right">
                                        {item.loading ? (
                                            <div className="space-y-1">
                                                <div className="h-3 w-14 bg-tremor-background-muted dark:bg-dark-tremor-background-muted rounded animate-pulse" />
                                                <div className="h-2.5 w-10 bg-tremor-background-muted dark:bg-dark-tremor-background-muted rounded animate-pulse ml-auto" />
                                            </div>
                                        ) : (
                                            <>
                                                <div className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong tabular-nums">
                                                    {item.price > 0 ? formatNumber(item.price) : '--'}
                                                </div>
                                                <div className={`text-xs font-medium tabular-nums ${item.changePercent >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                                                    {item.changePercent > 0 ? '+' : ''}{item.changePercent.toFixed(2)}%
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            )}

            {modalOpen && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
                    <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={closeModal} />
                    <div className="relative w-full sm:w-96 max-h-[80vh] bg-tremor-background dark:bg-dark-tremor-background rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col overflow-hidden">
                        <div className="px-5 pt-5 pb-4 flex-shrink-0">
                            <h2 className="text-base font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">Watchlist</h2>
                            <p className="text-xs text-tremor-content dark:text-dark-tremor-content mt-0.5">Tìm kiếm để thêm  nhấn  để xoá</p>
                            <div className="relative mt-3">
                                <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-tremor-content dark:text-dark-tremor-content pointer-events-none" />
                                <input
                                    ref={searchRef}
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    placeholder="Tìm mã cổ phiếu..."
                                    className="w-full pl-9 pr-3 py-2 rounded-tremor-default border border-tremor-border dark:border-dark-tremor-border bg-tremor-background-muted dark:bg-dark-tremor-background-muted text-sm text-tremor-content-strong dark:text-dark-tremor-content-strong placeholder:text-tremor-content dark:placeholder:text-dark-tremor-content outline-none focus:ring-2 focus:ring-tremor-brand dark:focus:ring-dark-tremor-brand"
                                />
                            </div>
                            {searchResults.length > 0 && (
                                <div className="mt-1 border border-tremor-border dark:border-dark-tremor-border rounded-tremor-default overflow-hidden shadow-sm">
                                    {searchResults.map(t => {
                                        const sym = t.symbol.toUpperCase();
                                        const inList = watchlist.includes(sym);
                                        return (
                                            <button key={sym} type="button"
                                                onClick={() => { toggle(sym); setSearchQuery(''); }}
                                                className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-tremor-background-muted dark:hover:bg-dark-tremor-background-muted transition-colors border-b border-tremor-border dark:border-dark-tremor-border last:border-0">
                                                <StockLogo symbol={sym} />
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">{sym}</div>
                                                    <div className="text-xs text-tremor-content dark:text-dark-tremor-content truncate">{t.name}</div>
                                                </div>
                                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${inList ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' : 'bg-tremor-background-muted dark:bg-dark-tremor-background-muted text-tremor-content dark:text-dark-tremor-content'}`}>
                                                    {inList ? 'Đã thêm' : '+ Thêm'}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-tremor-border dark:divide-dark-tremor-border px-2">
                            {watchlist.length === 0 ? (
                                <p className="text-center text-sm text-tremor-content dark:text-dark-tremor-content py-8">Watchlist trống</p>
                            ) : items.map(item => (
                                <div key={item.symbol} className="flex items-center gap-3 px-3 py-2.5">
                                    <StockLogo symbol={item.symbol} />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">{item.symbol}</div>
                                        <div className="text-xs text-tremor-content dark:text-dark-tremor-content truncate">{item.name}</div>
                                    </div>
                                    <button type="button" onClick={() => removeSymbol(item.symbol)}
                                        className="flex-shrink-0 p-1.5 rounded-full text-tremor-content hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 dark:hover:text-red-400 transition-colors"
                                        title={`Xoá ${item.symbol}`}>
                                        <RiCloseLine className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                        <div className="px-5 py-4 flex-shrink-0 border-t border-tremor-border dark:border-dark-tremor-border">
                            <button type="button" onClick={closeModal}
                                className="w-full py-2.5 rounded-tremor-default bg-tremor-content-strong dark:bg-dark-tremor-content-strong text-white dark:text-gray-950 text-sm font-semibold hover:opacity-90 transition-opacity">
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
