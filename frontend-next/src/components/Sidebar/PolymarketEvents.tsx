'use client';

import { useState, useEffect } from 'react';
import { Card } from '@tremor/react';
import { RiExternalLinkLine } from '@remixicon/react';

interface PolyEvent {
    id: string;
    question: string;
    slug: string;
    yesPrice: number;
    volume: number;
    url: string;
}

async function fetchEconomicEvents(): Promise<PolyEvent[]> {
    const res = await fetch('/api/polymarket/events', { cache: 'no-store' });
    if (!res.ok) throw new Error('Polymarket proxy fetch failed');

    const data: Array<{ id: string; question: string; slug: string; yesPrice: number; volume: number }> = await res.json();
    if (!Array.isArray(data)) return [];

    return data.map((item) => ({
        id: item.id,
        question: item.question,
        slug: item.slug,
        yesPrice: item.yesPrice,
        volume: item.volume,
        url: `https://polymarket.com/event/${item.slug || item.id}`,
    }));
}

function formatVolume(vol: number): string {
    if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`;
    if (vol >= 1_000) return `$${(vol / 1_000).toFixed(0)}K`;
    return `$${vol.toFixed(0)}`;
}

export default function PolymarketEvents() {
    const [events, setEvents] = useState<PolyEvent[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        fetchEconomicEvents()
            .then((ev) => { setEvents(ev); setError(false); })
            .catch(() => setError(true))
            .finally(() => setIsLoading(false));

        const id = setInterval(() => {
            fetchEconomicEvents()
                .then((ev) => { setEvents(ev); setError(false); })
                .catch(() => {});
        }, 5 * 60 * 1000);

        return () => clearInterval(id);
    }, []);

    return (
        <Card className="mt-4 p-0 overflow-hidden bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-2">
                    <span className="text-xl">📊</span>
                    <span className="text-base font-bold text-gray-900 dark:text-gray-100">Dự báo Kinh tế</span>
                </div>
                <a
                    href="https://polymarket.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-gray-400 hover:text-blue-500 transition-colors font-medium"
                >
                    Polymarket
                </a>
            </div>

            {/* Content */}
            <div className="px-5 pb-2">
                {isLoading ? (
                    <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-200 border-t-blue-500" />
                    </div>
                ) : error || events.length === 0 ? (
                    <div className="py-6 text-center text-[12px] text-gray-400 italic">
                        Không tải được sự kiện
                    </div>
                ) : (
                    <div className="flex flex-col">
                        {events.map((ev) => {
                            const yesPct = Math.round(ev.yesPrice * 100);
                            const isHigh = yesPct >= 60;
                            const isLow = yesPct <= 40;
                            const badgeBg = isHigh
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                                : isLow
                                    ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400'
                                    : 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400';
                            const barColor = isHigh ? 'bg-emerald-500' : isLow ? 'bg-rose-500' : 'bg-amber-400';

                            return (
                                <a
                                    key={ev.id}
                                    href={ev.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-3 py-3.5 border-b border-gray-50 dark:border-gray-800/50 last:border-0 group"
                                >
                                    {/* Yes% badge */}
                                    <div className={`w-10 h-10 rounded-full flex flex-col items-center justify-center shrink-0 font-bold ${badgeBg}`}>
                                        <span className="text-[13px] leading-none">{yesPct}</span>
                                        <span className="text-[8px] leading-none mt-0.5 opacity-70">%</span>
                                    </div>

                                    {/* Question + bar */}
                                    <div className="flex flex-col flex-1 min-w-0 gap-1.5">
                                        <p className="text-[12px] font-semibold text-gray-700 dark:text-gray-200 line-clamp-2 leading-snug">
                                            {ev.question}
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <div className="flex-1 h-1 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full ${barColor} rounded-full transition-all duration-500`}
                                                    style={{ width: `${yesPct}%` }}
                                                />
                                            </div>
                                            <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 tabular-nums">{formatVolume(ev.volume)}</span>
                                        </div>
                                    </div>

                                    {/* Link icon */}
                                    <RiExternalLinkLine className="w-3.5 h-3.5 shrink-0 text-gray-300 dark:text-gray-600 group-hover:text-blue-400 transition-colors" />
                                </a>
                            );
                        })}
                    </div>
                )}
            </div>
        </Card>
    );
}
