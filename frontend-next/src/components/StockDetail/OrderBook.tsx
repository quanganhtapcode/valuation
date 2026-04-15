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
    return v.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function priceColor(price: number, ref: number, ceiling: number, floor: number): string {
    if (!price) return 'text-slate-400 dark:text-slate-500';
    if (ceiling > 0 && price >= ceiling) return 'text-violet-500 dark:text-violet-400';
    if (floor > 0 && price <= floor)     return 'text-cyan-500 dark:text-cyan-400';
    if (ref > 0 && price > ref)          return 'text-emerald-600 dark:text-emerald-400';
    if (ref > 0 && price < ref)          return 'text-red-500 dark:text-red-400';
    return 'text-amber-500 dark:text-amber-400';
}

export default function OrderBook({ orderbook, refPrice, ceiling, floor }: OrderBookProps) {
    const bids = (orderbook?.bid ?? []).slice(0, 3);
    const asks = (orderbook?.ask ?? []).slice(0, 3);

    // Pad to 3 rows
    while (bids.length < 3) bids.push({ price: 0, volume: 0 });
    while (asks.length < 3) asks.push({ price: 0, volume: 0 });

    const isEmpty = bids.every(b => !b.volume) && asks.every(a => !a.volume);

    // Max volume for depth bars
    const maxVol = Math.max(1, ...bids.map(b => b.volume), ...asks.map(a => a.volume));

    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700/60 overflow-hidden bg-white dark:bg-slate-900">
            {/* Title */}
            <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                    Bảng giá
                </span>
                {!isEmpty && (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-500 dark:text-emerald-400 font-medium">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Live
                    </span>
                )}
            </div>

            {isEmpty ? (
                <div className="py-6 text-center text-[12px] text-slate-400 dark:text-slate-600">
                    Chưa có dữ liệu khớp lệnh
                </div>
            ) : (
                <>
                    {/* Header row */}
                    <div className="grid grid-cols-4 px-3 py-1.5 bg-slate-50 dark:bg-slate-800/50">
                        <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 text-right pr-2">KL mua</span>
                        <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 text-right">Giá mua</span>
                        <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 text-left pl-2">Giá bán</span>
                        <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 text-left pl-2">KL bán</span>
                    </div>

                    {/* Order rows */}
                    {Array.from({ length: 3 }, (_, i) => {
                        const bid = bids[i];
                        const ask = asks[i];
                        const bidDepth = bid.volume ? (bid.volume / maxVol) * 100 : 0;
                        const askDepth = ask.volume ? (ask.volume / maxVol) * 100 : 0;

                        return (
                            <div key={i} className="grid grid-cols-4 border-t border-slate-50 dark:border-slate-800/80">
                                {/* Bid volume (with green depth bar on right) */}
                                <div className="relative overflow-hidden text-right pr-2 py-2">
                                    {bidDepth > 0 && (
                                        <span
                                            className="absolute right-0 top-0 bottom-0 bg-emerald-500/10 dark:bg-emerald-400/10"
                                            style={{ width: `${bidDepth}%` }}
                                        />
                                    )}
                                    <span className="relative text-[12px] font-medium text-slate-600 dark:text-slate-300 tabular-nums">
                                        {fmtVol(bid.volume)}
                                    </span>
                                </div>

                                {/* Bid price */}
                                <div className="text-right py-2">
                                    <span className={`text-[13px] font-semibold tabular-nums ${priceColor(bid.price, refPrice, ceiling, floor)}`}>
                                        {fmtPrice(bid.price)}
                                    </span>
                                </div>

                                {/* Ask price */}
                                <div className="text-left pl-2 py-2">
                                    <span className={`text-[13px] font-semibold tabular-nums ${priceColor(ask.price, refPrice, ceiling, floor)}`}>
                                        {fmtPrice(ask.price)}
                                    </span>
                                </div>

                                {/* Ask volume (with red depth bar on left) */}
                                <div className="relative overflow-hidden text-left pl-2 py-2">
                                    {askDepth > 0 && (
                                        <span
                                            className="absolute left-0 top-0 bottom-0 bg-red-500/10 dark:bg-red-400/10"
                                            style={{ width: `${askDepth}%` }}
                                        />
                                    )}
                                    <span className="relative text-[12px] font-medium text-slate-600 dark:text-slate-300 tabular-nums">
                                        {fmtVol(ask.volume)}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </>
            )}
        </div>
    );
}
