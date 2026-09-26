'use client';

import { useCallback, useState } from 'react';
import SidebarCard from './SidebarCard';
import { fetchPolymarketEvents, PolymarketEvent } from '@/lib/polymarketApi';
import MarketChange from './MarketChange';
import { useVisiblePolling } from '@/lib/useVisiblePolling';
import { useLanguage } from '@/lib/languageContext';

const getRefreshDelay = () => 5 * 60 * 1000;

function formatVolume(volume?: number): string {
    if (volume === undefined || !Number.isFinite(volume)) return '—';
    if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(volume >= 10_000_000 ? 0 : 1)}M`;
    if (volume >= 1_000) return `$${(volume / 1_000).toFixed(0)}K`;
    return `$${volume.toFixed(0)}`;
}

export default function PolymarketEvents() {
    const { lang } = useLanguage();
    const [events, setEvents] = useState<PolymarketEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    const loadEvents = useCallback(async () => {
        try {
            const result = await fetchPolymarketEvents();
            setEvents(result);
            setFailed(false);
        } catch (error) {
            setFailed(true);
            console.error('Error loading Polymarket events:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useVisiblePolling(loadEvents, getRefreshDelay);

    return (
        <SidebarCard title={lang === 'vi' ? 'Sự kiện Polymarket' : 'Polymarket Events'} icon="📊">
            <div className="px-5 pb-4">
                {failed && (
                    <p role="status" className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                        {lang === 'vi' ? 'Không thể cập nhật Polymarket. Sẽ tự động thử lại.' : 'Unable to refresh Polymarket. Retrying automatically.'}
                    </p>
                )}
                {loading ? (
                    <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-2 border-indigo-500 border-t-transparent" /></div>
                ) : events.length ? (
                    <div className="flex flex-col gap-3">
                        {events.map((event) => (
                            <a
                                key={event.id}
                                href={event.url || '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block rounded-2xl border border-gray-200 px-4 py-3.5 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/40"
                            >
                                <h3 className="pr-1 text-[15px] font-medium leading-snug text-gray-800 dark:text-gray-100">{event.title}</h3>
                                <div className="mt-3 space-y-2">
                                    {event.outcomes.map((outcome, index) => {
                                        return (
                                            <div key={`${event.id}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-sm">
                                                <span title={outcome.label} className="min-w-0 break-words text-gray-700 dark:text-gray-300">{outcome.label}</span>
                                                <span className="text-right font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                                                    {outcome.probability !== undefined ? `${outcome.probability.toFixed(1)}%` : '—'}
                                                </span>
                                                <MarketChange
                                                    value={outcome.change}
                                                    title={lang === 'vi' ? 'Thay đổi xác suất trong 24 giờ (điểm phần trăm)' : '24-hour probability change (percentage points)'}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="mt-3 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                                    <span>{formatVolume(event.volume)} vol.</span>
                                    <span>{event.marketCount || 0} {lang === 'vi' ? 'thị trường' : 'markets'}</span>
                                </div>
                            </a>
                        ))}
                    </div>
                ) : (
                    <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                        {lang === 'vi' ? 'Chưa có sự kiện.' : 'No events available.'}
                    </p>
                )}
            </div>
        </SidebarCard>
    );
}
