'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@tremor/react';
import { fetchPolymarketEvents, PolymarketEvent } from '@/lib/api';
import { useLanguage } from '@/lib/languageContext';

function formatVolume(volume?: number): string {
    if (!volume) return '—';
    if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(volume >= 10_000_000 ? 0 : 1)}M`;
    if (volume >= 1_000) return `$${(volume / 1_000).toFixed(0)}K`;
    return `$${volume.toFixed(0)}`;
}

export default function PolymarketEvents() {
    const { lang } = useLanguage();
    const [events, setEvents] = useState<PolymarketEvent[]>([]);
    const [loading, setLoading] = useState(true);

    const loadEvents = useCallback(async () => {
        try {
            const result = await fetchPolymarketEvents();
            setEvents(result);
        } catch (error) {
            console.error('Error loading Polymarket events:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadEvents();
        const timer = window.setInterval(loadEvents, 5 * 60 * 1000);
        return () => window.clearInterval(timer);
    }, [loadEvents]);

    return (
        <Card className="p-0 overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm rounded-2xl">
            <div className="flex items-center gap-2 px-5 py-5">
                <span className="text-2xl" aria-hidden="true">📊</span>
                <span className="text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                    Polymarket Events
                </span>
            </div>
            <div className="px-4 pb-4">
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
                                        const isUp = (outcome.change || 0) >= 0;
                                        return (
                                            <div key={`${event.id}-${index}`} className="grid grid-cols-[minmax(0,1fr)_50px_88px] items-center gap-2 text-sm">
                                                <span className="truncate text-gray-700 dark:text-gray-300">{outcome.label}</span>
                                                <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">
                                                    {outcome.probability !== undefined ? `${outcome.probability.toFixed(1)}%` : '—'}
                                                </span>
                                                <span className={`rounded-md px-2 py-1 text-right text-xs font-medium tabular-nums ${
                                                    isUp
                                                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                                                        : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                                                }`}>
                                                    {isUp ? '↗' : '↘'} {Math.abs(outcome.change || 0).toFixed(1)}%
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="mt-3 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                                    <span>{formatVolume(event.volume)} vol.</span>
                                    <span>+{event.marketCount || 0} on Polymarket</span>
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
        </Card>
    );
}
