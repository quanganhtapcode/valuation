'use client';

interface OrderBookEntry {
    price: number;
    volume: number;
}

interface OrderBookProps {
    orderbook?: {
        bid: Array<OrderBookEntry>;
        ask: Array<OrderBookEntry>;
    };
    refPrice: number;
    ceiling: number;
    floor: number;
}

function fmtVol(v: number): string {
    if (!v) return '—';
    return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtPrice(v: number): string {
    if (!v) return '—';
    // Vietnamese stocks quote in thousands — display as-is with 2dp
    return v.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type PriceLevel = 'ceiling' | 'floor' | 'up' | 'down' | 'ref' | 'empty';

function priceLevel(price: number, ref: number, ceiling: number, floor: number): PriceLevel {
    if (!price) return 'empty';
    if (ceiling > 0 && price >= ceiling) return 'ceiling';
    if (floor > 0 && price <= floor)     return 'floor';
    if (ref > 0 && price > ref)          return 'up';
    if (ref > 0 && price < ref)          return 'down';
    return 'ref';
}

const PRICE_COLOR: Record<PriceLevel, string> = {
    ceiling: 'text-violet-500 dark:text-violet-400',
    floor:   'text-cyan-500 dark:text-cyan-400',
    up:      'text-emerald-600 dark:text-emerald-400',
    down:    'text-red-500 dark:text-red-400',
    ref:     'text-amber-500 dark:text-amber-400',
    empty:   'text-slate-300 dark:text-slate-600',
};

export default function OrderBook({ orderbook, refPrice, ceiling, floor }: OrderBookProps) {
    const bids = [...(orderbook?.bid ?? [])].slice(0, 3);
    const asks = [...(orderbook?.ask ?? [])].slice(0, 3);

    while (bids.length < 3) bids.push({ price: 0, volume: 0 });
    while (asks.length < 3) asks.push({ price: 0, volume: 0 });

    const hasData = bids.some(b => b.volume > 0) || asks.some(a => a.volume > 0);

    const totalBid = bids.reduce((s, b) => s + b.volume, 0);
    const totalAsk = asks.reduce((s, a) => s + a.volume, 0);
    const maxVol = Math.max(1, ...bids.map(b => b.volume), ...asks.map(a => a.volume));

    // Spread between best ask and best bid
    const bestBid = bids[0]?.price ?? 0;
    const bestAsk = asks[0]?.price ?? 0;
    const spread = (bestAsk > 0 && bestBid > 0) ? bestAsk - bestBid : 0;
    const spreadPct = spread > 0 && refPrice > 0 ? (spread / refPrice) * 100 : 0;

    // Imbalance ratio (0–1, 0.5 = balanced)
    const totalVol = totalBid + totalAsk;
    const bidRatio = totalVol > 0 ? totalBid / totalVol : 0.5;

    return (
        <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-900/80">

            {/* ── Header ─────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 select-none">
                    Bảng giá
                </span>
                {hasData && (
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-500 dark:text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
                        Live
                    </span>
                )}
            </div>

            {!hasData ? (
                <div className="py-8 text-center text-[12px] text-slate-300 dark:text-slate-600 select-none">
                    Ngoài giờ giao dịch
                </div>
            ) : (
                <>
                    {/* ── Column labels ──────────────────────────────────── */}
                    <div className="grid grid-cols-[1fr_auto_12px_auto_1fr] items-center px-2 py-1.5 bg-slate-50 dark:bg-slate-800/60 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 select-none">
                        <span className="text-right pr-1.5">KL mua</span>
                        <span className="text-right">Giá mua</span>
                        <span />
                        <span className="text-left">Giá bán</span>
                        <span className="text-left pl-1.5">KL bán</span>
                    </div>

                    {/* ── Rows ───────────────────────────────────────────── */}
                    {Array.from({ length: 3 }, (_, i) => {
                        const bid = bids[i];
                        const ask = asks[i];
                        const bidPct = bid.volume ? (bid.volume / maxVol) * 88 : 0;
                        const askPct = ask.volume ? (ask.volume / maxVol) * 88 : 0;
                        const bidLevel = priceLevel(bid.price, refPrice, ceiling, floor);
                        const askLevel = priceLevel(ask.price, refPrice, ceiling, floor);

                        return (
                            <div
                                key={i}
                                className="grid grid-cols-[1fr_auto_12px_auto_1fr] items-center border-t border-slate-50 dark:border-slate-800/70 group"
                            >
                                {/* Bid volume — depth bar fills from right */}
                                <div className="relative overflow-hidden py-[9px] pr-1.5 text-right">
                                    {bidPct > 0 && (
                                        <span
                                            className="absolute right-0 top-0 bottom-0 bg-emerald-500/[0.09] dark:bg-emerald-400/[0.12]"
                                            style={{ width: `${bidPct}%` }}
                                        />
                                    )}
                                    <span className="relative text-[12px] font-medium tabular-nums text-slate-600 dark:text-slate-300">
                                        {fmtVol(bid.volume)}
                                    </span>
                                </div>

                                {/* Bid price */}
                                <div className="py-[9px] px-2">
                                    <span className={`text-[13px] font-bold tabular-nums ${PRICE_COLOR[bidLevel]}`}>
                                        {fmtPrice(bid.price)}
                                    </span>
                                </div>

                                {/* Center divider */}
                                <div className="flex items-center justify-center h-full">
                                    <span className="w-px h-4 bg-slate-200 dark:bg-slate-700 rounded-full" />
                                </div>

                                {/* Ask price */}
                                <div className="py-[9px] px-2">
                                    <span className={`text-[13px] font-bold tabular-nums ${PRICE_COLOR[askLevel]}`}>
                                        {fmtPrice(ask.price)}
                                    </span>
                                </div>

                                {/* Ask volume — depth bar fills from left */}
                                <div className="relative overflow-hidden py-[9px] pl-1.5 text-left">
                                    {askPct > 0 && (
                                        <span
                                            className="absolute left-0 top-0 bottom-0 bg-red-500/[0.09] dark:bg-red-400/[0.12]"
                                            style={{ width: `${askPct}%` }}
                                        />
                                    )}
                                    <span className="relative text-[12px] font-medium tabular-nums text-slate-600 dark:text-slate-300">
                                        {fmtVol(ask.volume)}
                                    </span>
                                </div>
                            </div>
                        );
                    })}

                    {/* ── Totals row ─────────────────────────────────────── */}
                    <div className="grid grid-cols-[1fr_auto_12px_auto_1fr] items-center px-2 py-1.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
                        <span className="text-right pr-1.5 text-[11px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                            {fmtVol(totalBid)}
                        </span>
                        <span className="text-right text-[9px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2">
                            Tổng
                        </span>
                        <span />
                        <span className="text-left text-[9px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-2">
                            Tổng
                        </span>
                        <span className="text-left pl-1.5 text-[11px] font-semibold tabular-nums text-red-500 dark:text-red-400">
                            {fmtVol(totalAsk)}
                        </span>
                    </div>

                    {/* ── Imbalance bar ───────────────────────────────────── */}
                    <div className="px-3.5 pb-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                        {/* Bid/Ask pressure bar */}
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 w-8 text-right tabular-nums">
                                {(bidRatio * 100).toFixed(0)}%
                            </span>
                            <div className="flex-1 flex h-1.5 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800">
                                <div
                                    className="bg-emerald-500 dark:bg-emerald-400 transition-all duration-500"
                                    style={{ width: `${bidRatio * 100}%` }}
                                />
                                <div
                                    className="bg-red-500 dark:bg-red-400 flex-1 transition-all duration-500"
                                />
                            </div>
                            <span className="text-[10px] font-semibold text-red-500 dark:text-red-400 w-8 tabular-nums">
                                {((1 - bidRatio) * 100).toFixed(0)}%
                            </span>
                        </div>

                        {/* Spread */}
                        {spread > 0 && (
                            <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
                                <span>Spread</span>
                                <span className="font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                                    {fmtPrice(spread)}
                                </span>
                                <span className="text-slate-300 dark:text-slate-600">·</span>
                                <span className="tabular-nums">{spreadPct.toFixed(2)}%</span>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
