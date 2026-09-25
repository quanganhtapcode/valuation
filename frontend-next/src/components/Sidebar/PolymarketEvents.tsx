'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@tremor/react';
import { fetchPolymarketEvents, PolymarketEvent } from '@/lib/api';
import { useLanguage } from '@/lib/languageContext';

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
            <div className="px-5 pb-4">
                {loading ? (
                    <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-2 border-indigo-500 border-t-transparent" /></div>
                ) : events.length ? (
                    <div className="flex flex-col">
                        {events.map((event) => {
                            const content = (
                                <>
                                    <span className="text-sm font-medium leading-snug text-gray-700 dark:text-gray-300">{event.title}</span>
                                    {event.probability !== undefined && (
                                        <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                                            {event.outcome ? `${event.outcome} ` : ''}{event.probability.toFixed(0)}%
                                        </span>
                                    )}
                                </>
                            );
                            return event.url ? (
                                <a key={event.id} href={event.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 border-b border-gray-100 py-3 last:border-0 dark:border-gray-800/50">
                                    {content}
                                </a>
                            ) : (
                                <div key={event.id} className="flex items-center justify-between gap-3 border-b border-gray-100 py-3 last:border-0 dark:border-gray-800/50">
                                    {content}
                                </div>
                            );
                        })}
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
