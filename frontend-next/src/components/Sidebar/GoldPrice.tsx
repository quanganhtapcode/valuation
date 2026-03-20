'use client';

import {
    Card,
} from '@tremor/react';
import { RiCopperCoinLine, RiWaterFlashLine, RiTimeLine } from '@remixicon/react';
import { GoldPriceItem, formatRelativeTime } from '@/lib/api';
import { useEffect, useState } from 'react';

interface GoldPriceProps {
    prices: GoldPriceItem[];
    isLoading?: boolean;
    updatedAt?: string;
}

export default function GoldPrice({ prices, isLoading, updatedAt }: GoldPriceProps) {
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    // Selection criteria
    const displayPrices = prices?.filter(p =>
        ['Vàng SJC (Miếng)', 'Nhẫn Vàng 9999', 'Vàng VRTL (Miếng)', 'Bạc 1kg'].includes(p.TypeName)
    ) || [];

    // Order: SJC, VRTL, 9999 Ring, Silver
    const order = ['Vàng SJC (Miếng)', 'Vàng VRTL (Miếng)', 'Nhẫn Vàng 9999', 'Bạc 1kg'];
    displayPrices.sort((a, b) => order.indexOf(a.TypeName) - order.indexOf(b.TypeName));

    return (
        <Card className="mt-4 p-0 overflow-hidden bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl">
            {/* Header */}
            <div className="flex items-center gap-2 px-5 py-4">
                <span className="text-xl">🏆</span>
                <span className="text-base font-bold text-gray-900 dark:text-gray-100">
                    Giá Vàng & Bạc
                </span>
            </div>

            {/* Content List */}
            <div className="px-5 pb-2">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-10">
                        <div className="animate-spin rounded-full h-6 w-6 border-2 border-amber-500 border-t-transparent" />
                    </div>
                ) : (
                    <div className="flex flex-col">
                        {displayPrices.map((item) => {
                            const isSilver = item.TypeName === 'Bạc 1kg';
                            const badgeText = isSilver ? 'Ag' : 'Au';

                            return (
                                <div key={item.Id} className="flex items-center justify-between py-3 border-b border-gray-50 dark:border-gray-800/50 last:border-0 group">
                                    {/* Left: Badge + Name */}
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold text-sm ${isSilver
                                            ? 'bg-slate-100 text-slate-500 dark:bg-slate-800'
                                            : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30'
                                            }`}>
                                            {badgeText}
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-[13px] font-bold text-gray-700 dark:text-gray-200 truncate">
                                                {item.TypeName}
                                            </span>
                                            <span className="text-[11px] text-gray-600 dark:text-gray-400 font-medium">
                                                BTMC
                                            </span>
                                        </div>
                                    </div>

                                    {/* Right: Prices */}
                                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">Mua:</span>
                                            <span className="text-[13px] font-bold text-emerald-600 tabular-nums">
                                                {item.Buy}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">Bán:</span>
                                            <span className="text-[13px] font-bold text-rose-500/90 dark:text-rose-400 tabular-nums">
                                                {item.Sell}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Footer Update Time */}
            <div className="text-center py-3">
                <span className="text-[11px] text-gray-600 dark:text-gray-400 italic">
                    Cập nhật: {(() => {
                        try {
                            if (!updatedAt) return '';

                            const relative = formatRelativeTime(updatedAt, 'vi-VN');
                            if (relative) return relative;

                            if (updatedAt.includes('/') && updatedAt.includes(':')) return updatedAt;
                            const date = new Date(updatedAt);
                            if (isNaN(date.getTime())) return updatedAt;
                            return date.toLocaleString('vi-VN', {
                                hour: '2-digit',
                                minute: '2-digit',
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                timeZone: 'Asia/Ho_Chi_Minh'
                            });
                        } catch (e) {
                            return updatedAt;
                        }
                    })()} (BTMC)
                </span>
            </div>
        </Card>
    );
}
