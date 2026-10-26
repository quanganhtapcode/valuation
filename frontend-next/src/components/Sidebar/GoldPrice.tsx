'use client';

import SidebarCard from './SidebarCard';
import type { GoldPriceItem } from '@/lib/goldApi';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/translations';

interface GoldPriceProps {
    prices: GoldPriceItem[];
    isLoading?: boolean;
    source?: string;
    stale?: boolean;
}

export default function GoldPrice({ prices, isLoading, source }: GoldPriceProps) {
    const { lang } = useLanguage();
    const t = translations[lang].dashboard;
    const labels = {
        vi: { updated: 'Nguồn cập nhật: ', empty: 'Đang tải giá vàng, hệ thống sẽ tự thử lại.', locale: 'vi-VN' },
        en: { updated: 'Source updated: ', empty: 'Loading gold quotes. Retrying automatically.', locale: 'en-US' },
    }[lang];
    // Show 3 gold classes + silver bar if available
    const displayPrices = prices?.filter(p =>
        ['Vàng SJC (Miếng)', 'Nhẫn Vàng 9999', 'Vàng PQ 9999 (Miếng)', 'Vàng Phú Quý (Miếng)', 'Bạc Thỏi Phú Quý 999'].includes(p.TypeName)
    ) || [];

    // Order: SJC, ring 9999, PQ bar 9999, silver bar
    const order = ['Vàng SJC (Miếng)', 'Nhẫn Vàng 9999', 'Vàng PQ 9999 (Miếng)', 'Vàng Phú Quý (Miếng)', 'Bạc Thỏi Phú Quý 999'];
    displayPrices.sort((a, b) => order.indexOf(a.TypeName) - order.indexOf(b.TypeName));

    const sourceLabel = source === 'BTMC' ? 'BTMC' : 'Phú Quý';

    return (
        <SidebarCard title={t.goldSilver}>
            <div className="px-5 pb-2">
                {!isLoading && !displayPrices.length && <p role="status" className="py-4 text-sm text-gray-500">{labels.empty}</p>}
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-10">
                        <div className="animate-spin rounded-full h-6 w-6 border-2 border-amber-500 border-t-transparent" />
                    </div>
                ) : (
                    <div className="flex flex-col">
                        {displayPrices.map((item) => {
                            const isSilver = item.TypeName.toLowerCase().includes('bạc');
                            const badgeText = isSilver ? 'Ag' : 'Au';
                            const englishNames: Record<number, string> = {
                                1: 'SJC gold bar', 2: '9999 gold ring',
                                3: 'Phu Quy 9999 gold bar', 4: 'Phu Quy 999 silver bar',
                            };
                            const displayName = lang === 'en' ? (englishNames[item.Id] || item.TypeName) : item.TypeName === 'Vàng PQ 9999 (Miếng)'
                                ? 'Vàng PQ 9999'
                                : item.TypeName;

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
                                                {displayName}
                                            </span>
                                            <span className="text-[11px] text-gray-600 dark:text-gray-400 font-medium">
                                                {item.BranchName || sourceLabel}
                                                {item.Unit ? ` · ${item.Unit}` : ''}
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
                {displayPrices[0]?.UpdateTime && <p className="py-2 text-[11px] text-gray-500">{labels.updated}{new Date(displayPrices[0].UpdateTime).toLocaleString(labels.locale, { timeZone: 'Asia/Ho_Chi_Minh' })}</p>}
            </div>
        </SidebarCard>
    );
}
