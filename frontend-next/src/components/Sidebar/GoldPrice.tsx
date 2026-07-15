'use client';

import {
    Card,
} from '@tremor/react';
import { GoldPriceItem, formatRelativeTime } from '@/lib/api';
import { useLanguage } from '@/lib/languageContext';
import { translations } from '@/lib/translations';

interface GoldPriceProps {
    prices: GoldPriceItem[];
    isLoading?: boolean;
    updatedAt?: string;
    source?: string;
}

export default function GoldPrice({ prices, isLoading, updatedAt, source }: GoldPriceProps) {
    const { lang } = useLanguage();
    const t = translations[lang].dashboard;
    // Show 3 gold classes + silver bar if available
    const displayPrices = prices?.filter(p =>
        ['Vàng SJC (Miếng)', 'Nhẫn Vàng 9999', 'Vàng PQ 9999 (Miếng)', 'Bạc Thỏi Phú Quý 999'].includes(p.TypeName)
    ) || [];

    // Order: SJC, ring 9999, PQ bar 9999, silver bar
    const order = ['Vàng SJC (Miếng)', 'Nhẫn Vàng 9999', 'Vàng PQ 9999 (Miếng)', 'Bạc Thỏi Phú Quý 999'];
    displayPrices.sort((a, b) => order.indexOf(a.TypeName) - order.indexOf(b.TypeName));

    const sourceLabel = source === 'BTMC' ? 'BTMC' : 'Phú Quý';

    return (
        <Card className="p-0 overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm rounded-2xl">
            {/* Header */}
            <div className="flex items-center gap-2 px-5 py-5">
                <span className="text-2xl">🏆</span>
                <span className="text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                    {t.goldSilver}
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
                            const isSilver = item.TypeName.toLowerCase().includes('bạc');
                            const badgeText = isSilver ? 'Ag' : 'Au';

                            return (
                            <div key={item.Id} className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-800/50 last:border-0 group">
                                    {/* Left: Badge + Name */}
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold text-sm ${
                                            isSilver
                                                ? 'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300'
                                                : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30'
                                        }`}>
                                            {badgeText}
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">
                                                {item.TypeName}
                                            </span>
                                            <span className="text-[11px] text-gray-600 dark:text-gray-400 font-medium">
                                                {item.BranchName || sourceLabel}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Right: Prices */}
                                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">{t.buy}:</span>
                                            <span className="text-sm font-semibold text-emerald-600 tabular-nums">
                                                {item.Buy}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium">{t.sell}:</span>
                                            <span className="text-sm font-semibold text-rose-500/90 dark:text-rose-400 tabular-nums">
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
                    {t.updated}: {(() => {
                        try {
                            if (!updatedAt) return '';

                            const relative = formatRelativeTime(updatedAt, lang === 'en' ? 'en-US' : 'vi-VN');
                            if (relative) return relative;

                            if (updatedAt.includes('/') && updatedAt.includes(':')) return updatedAt;
                            const date = new Date(updatedAt);
                            if (isNaN(date.getTime())) return updatedAt;
                            return date.toLocaleString(lang === 'en' ? 'en-US' : 'vi-VN', {
                                hour: '2-digit',
                                minute: '2-digit',
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                timeZone: 'Asia/Ho_Chi_Minh'
                            });
                        } catch {
                            return updatedAt;
                        }
                    })()} ({sourceLabel})
                </span>
            </div>
        </Card>
    );
}
