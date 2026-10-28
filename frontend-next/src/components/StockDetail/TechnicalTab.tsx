'use client';

import { apiFetch } from '@/lib/apiFetch';

import { API } from '@/lib/apiCore';

import { useEffect, useState } from 'react';
import { formatNumber } from '@/lib/api';
import { useLanguage } from '@/contexts/LanguageContext';
import { fetchCurrentPrice } from '@/lib/stockApi';
import { translations } from '@/lib/translations';
import { StockTabDropdown } from './StockTabControls';

type TechnicalTimeframe = 'ONE_HOUR' | 'ONE_DAY' | 'ONE_WEEK';

const TIMEFRAMES: TechnicalTimeframe[] = ['ONE_HOUR', 'ONE_DAY', 'ONE_WEEK'];

const TIMEFRAME_LABELS: Record<TechnicalTimeframe, string> = {
    ONE_HOUR: '1H',
    ONE_DAY: '1D',
    ONE_WEEK: '1W',
};

type TechnicalRating = string | null | undefined;

interface TechnicalSignal {
    name?: string;
    value?: number | null;
    rating?: TechnicalRating;
}

interface TechnicalPivot {
    pivotPoint?: number | null;
    resistance1?: number | null;
    resistance2?: number | null;
    resistance3?: number | null;
    support1?: number | null;
    support2?: number | null;
    support3?: number | null;
    fibResistance1?: number | null;
    fibResistance2?: number | null;
    fibResistance3?: number | null;
    fibSupport1?: number | null;
    fibSupport2?: number | null;
    fibSupport3?: number | null;
}

interface TechnicalFrameData {
    timeFrame?: string;
    movingAverages?: TechnicalSignal[];
    oscillators?: TechnicalSignal[];
    gaugeMovingAverage?: { rating?: TechnicalRating; values?: Record<string, number> };
    gaugeOscillator?: { rating?: TechnicalRating; values?: Record<string, number> };
    gaugeSummary?: { rating?: TechnicalRating; values?: Record<string, number> };
    pivot?: TechnicalPivot;
    price?: number | null;
    matchTime?: string | null;
}

interface TechnicalApiResponse {
    success?: boolean;
    symbol?: string;
    timeframe?: string;
    fetched_at_utc?: string;
    serverDateTime?: string;
    data?: TechnicalFrameData;
}

interface TechnicalTabProps {
    symbol: string;
}

type SnapshotState = Partial<Record<TechnicalTimeframe, TechnicalApiResponse>>;

function valueText(value: number | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '-';
    return formatNumber(value, { maximumFractionDigits: value >= 1000 ? 0 : 2 });
}

function ratingBadgeClass(rating?: TechnicalRating): string {
    const n = (rating || '').toString().toUpperCase();
    if (n.includes('BUY') || n.includes('GOOD') || n.includes('BULL') || n.includes('VERY_GOOD'))
        return 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-emerald-400/20';
    if (n.includes('SELL') || n.includes('BAD') || n.includes('BEAR') || n.includes('VERY_BAD'))
        return 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20 dark:bg-red-400/10 dark:text-red-400 dark:ring-red-400/20';
    if (n.includes('NEUTRAL'))
        return 'bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-600/20 dark:bg-gray-400/10 dark:text-gray-400 dark:ring-gray-400/20';
    return 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-400/10 dark:text-amber-400 dark:ring-amber-400/20';
}

function ratingLabel(rating: TechnicalRating, lang: 'vi' | 'en'): string {
    if (!rating) return '—';
    const n = rating.toUpperCase();
    const strong = n.includes('STRONG') || n.includes('VERY');
    const tone = ratingTone(rating);
    if (tone === 'bull') return lang === 'vi' ? (strong ? 'Mua mạnh' : 'Mua') : (strong ? 'Strong buy' : 'Buy');
    if (tone === 'bear') return lang === 'vi' ? (strong ? 'Bán mạnh' : 'Bán') : (strong ? 'Strong sell' : 'Sell');
    if (n.includes('NEUTRAL')) return lang === 'vi' ? 'Trung lập' : 'Neutral';
    return rating.replaceAll('_', ' ');
}

function formatDateTime(value: string | null | undefined, lang: 'vi' | 'en'): string {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString(translations[lang].overview.locale, { dateStyle: 'medium', timeStyle: 'short' });
}

function ratingTone(rating?: TechnicalRating): 'bull' | 'bear' | 'neutral' {
    const n = (rating || '').toString().toUpperCase();
    if (n.includes('BUY') || n.includes('GOOD') || n.includes('BULL') || n.includes('VERY_GOOD')) return 'bull';
    if (n.includes('SELL') || n.includes('BAD') || n.includes('BEAR') || n.includes('VERY_BAD')) return 'bear';
    return 'neutral';
}

function bucketType(label: string): 'buy' | 'sell' | 'neutral' {
    const n = label.toUpperCase();
    if (n.includes('BUY') || n.includes('GOOD') || n.includes('BULL')) return 'buy';
    if (n.includes('SELL') || n.includes('BAD') || n.includes('BEAR')) return 'sell';
    return 'neutral';
}

function DistributionBar({ buy, neutral, sell }: { buy: number; neutral: number; sell: number }) {
    const total = buy + neutral + sell || 1;
    const buyWidth = (buy / total) * 100;
    const neutralWidth = (neutral / total) * 100;
    const sellWidth = (sell / total) * 100;

    return (
        <div className="overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 h-2.5">
            <div className="flex h-full w-full">
                <div className="bg-emerald-500" style={{ width: `${buyWidth}%` }} />
                <div className="bg-slate-400 dark:bg-slate-500" style={{ width: `${neutralWidth}%` }} />
                <div className="bg-rose-500" style={{ width: `${sellWidth}%` }} />
            </div>
        </div>
    );
}

function GaugeCard({ title, data, lang }: { title: string; data?: { rating?: TechnicalRating; values?: Record<string, number> }; lang: 'vi' | 'en' }) {
    const copy = translations[lang].detail.technical;
    const entries = Object.entries(data?.values || {});
    const ratingText = ratingLabel(data?.rating, lang);
    const buy = entries.reduce((acc, [key, value]) => acc + (bucketType(key) === 'buy' ? Number(value || 0) : 0), 0);
    const sell = entries.reduce((acc, [key, value]) => acc + (bucketType(key) === 'sell' ? Number(value || 0) : 0), 0);
    const neutral = entries.reduce((acc, [key, value]) => acc + (bucketType(key) === 'neutral' ? Number(value || 0) : 0), 0);
    const totalSignals = buy + sell + neutral;
    const hasOnlyBucketEntries = entries.length > 0 && entries.every(([key]) => {
        const n = key.toUpperCase();
        return n.includes('BUY') || n.includes('SELL') || n.includes('NEUTRAL') || n.includes('GOOD') || n.includes('BAD') || n.includes('BULL') || n.includes('BEAR');
    });

    return (
        <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</p>
                </div>
                <span className={`rounded-md px-3 py-1 text-sm font-semibold ${ratingBadgeClass(data?.rating)}`}>
                    {ratingText}
                </span>
            </div>

            <div className="mt-3 space-y-2.5">
                <DistributionBar buy={buy} neutral={neutral} sell={sell} />
                <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{copy.buy}: {buy}</span>
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{copy.neutral}: {neutral}</span>
                    <span className="rounded-md bg-rose-50 px-2 py-1 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{copy.sell}: {sell}</span>
                    {totalSignals > 0 && (
                        <span className="ml-auto text-slate-500 dark:text-slate-400">{totalSignals} {copy.signals}</span>
                    )}
                </div>
                {entries.length > 0 && !hasOnlyBucketEntries && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                        {entries.map(([key, value]) => (
                            <span key={key} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                <span className="font-medium">{key}</span>
                                <span className="font-semibold tabular-nums">{value}</span>
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function SignalTable({ title, rows, lang }: { title: string; rows: TechnicalSignal[]; lang: 'vi' | 'en' }) {
    const copy = translations[lang].detail.technical;
    return (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <div className="flex items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h4>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{rows.length} {copy.signals}</span>
                </div>
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500 dark:bg-gray-800/70 dark:text-gray-400">
                    <tr>
                        <th className="px-4 py-2">{copy.indicator}</th>
                        <th className="px-4 py-2 text-right">{copy.value}</th>
                        <th className="px-4 py-2 text-right">{copy.assessment}</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.length > 0 ? rows.map((row, index) => (
                        <tr key={`${row.name || 'signal'}-${index}`} className="border-t border-gray-100 dark:border-gray-800">
                            <td className="px-4 py-3 font-medium text-gray-700 dark:text-gray-200">{row.name || '-'}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-gray-900 dark:text-gray-100">{valueText(row.value)}</td>
                            <td className="whitespace-nowrap px-4 py-3 text-right">
                                <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ${ratingBadgeClass(row.rating)}`}>
                                    {ratingLabel(row.rating, lang)}
                                </span>
                            </td>
                        </tr>
                    )) : (
                        <tr>
                            <td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">{copy.noData}</td>
                        </tr>
                    )}
                </tbody>
            </table>
            </div>
        </div>
    );
}

function PivotGrid({ pivot, lang }: { pivot?: TechnicalPivot; lang: 'vi' | 'en' }) {
    const copy = translations[lang].detail.technical;
    const classicRows: Array<{ label: string; value?: number | null; cls: string }> = [
        { label: 'R3', value: pivot?.resistance3, cls: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300' },
        { label: 'R2', value: pivot?.resistance2, cls: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300' },
        { label: 'R1', value: pivot?.resistance1, cls: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300' },
        { label: 'Pivot', value: pivot?.pivotPoint, cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300' },
        { label: 'S1', value: pivot?.support1, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' },
        { label: 'S2', value: pivot?.support2, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' },
        { label: 'S3', value: pivot?.support3, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' },
    ];

    const fibonacciRows: Array<{ label: string; value?: number | null; cls: string }> = [
        { label: 'Fib R1', value: pivot?.fibResistance1, cls: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300' },
        { label: 'Fib R2', value: pivot?.fibResistance2, cls: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300' },
        { label: 'Fib R3', value: pivot?.fibResistance3, cls: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300' },
        { label: 'Fib S1', value: pivot?.fibSupport1, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' },
        { label: 'Fib S2', value: pivot?.fibSupport2, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' },
        { label: 'Fib S3', value: pivot?.fibSupport3, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' },
    ];

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{copy.pivotLevels}</h4>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{copy.pivotSubtitle}</p>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="border-y border-slate-100 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300">
                        <tr><th className="px-3 py-3 text-left font-medium">{lang === 'vi' ? 'Mức giá' : 'Level'}</th><th className="px-3 py-3 text-right font-medium">Classic</th><th className="px-3 py-3 text-right font-medium">Fibonacci</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {classicRows.map(row => (
                            <tr key={row.label} className={row.label === 'Pivot' ? 'bg-slate-50 dark:bg-slate-800' : ''}>
                                <th scope="row" className={`px-3 py-3 text-left font-semibold ${row.label.startsWith('R') ? 'text-rose-700 dark:text-rose-400' : row.label.startsWith('S') ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'}`}>{row.label}</th>
                                <td className="px-3 py-3 text-right tabular-nums text-slate-900 dark:text-slate-100">{valueText(row.value)}</td>
                                <td className="px-3 py-3 text-right tabular-nums text-slate-900 dark:text-slate-100">{valueText(fibonacciRows.find(fib => fib.label === `Fib ${row.label}`)?.value)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{lang === 'vi' ? 'R: Kháng cự · S: Hỗ trợ · Pivot: Điểm xoay' : 'R: Resistance · S: Support · Pivot: Pivot point'}</p>
            </div>
        </div>
    );
}

export default function TechnicalTab({ symbol }: TechnicalTabProps) {
    const { lang } = useLanguage();
    const copy = translations[lang].detail.technical;
    const [activeFrame, setActiveFrame] = useState<TechnicalTimeframe>('ONE_DAY');
    const [snapshots, setSnapshots] = useState<SnapshotState>({});
    const [livePrice, setLivePrice] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!symbol) return;

        const controller = new AbortController();
        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled || controller.signal.aborted) return;
            setLoading(true);
            setError(null);
        });

        Promise.allSettled(
            TIMEFRAMES.map(async (frame) => {
                const response = await apiFetch(API.STOCK_TECHNICAL(symbol, TIMEFRAME_LABELS[frame].toLowerCase()), { signal: controller.signal });
                const json = response.ok ? await response.json() : null;
                return [frame, json] as const;
            }),
        )
            .then((results) => {
                if (cancelled) return;
                const next: SnapshotState = {};
                let hasData = false;
                results.forEach((result) => {
                    if (result.status !== 'fulfilled') return;
                    const [frame, json] = result.value;
                    if (json?.success && json.data) {
                        next[frame] = json;
                        hasData = true;
                    }
                });
                setSnapshots(next);
                setLoading(false);
                if (!hasData) setError(copy.noTickerData);
            })
            .catch((err) => {
                if (err?.name === 'AbortError') return;
                setLoading(false);
                setError(copy.loadFailed);
            });

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [copy.loadFailed, copy.noTickerData, symbol]);

    useEffect(() => {
        let cancelled = false;
        const loadLivePrice = async () => {
            const quote = await fetchCurrentPrice(symbol);
            if (!cancelled && quote?.price != null && quote.price > 0) setLivePrice(quote.price);
        };
        void loadLivePrice();
        const timer = window.setInterval(loadLivePrice, 60_000);
        return () => { cancelled = true; window.clearInterval(timer); };
    }, [symbol]);

    const current = snapshots[activeFrame];
    const data = current?.data;
    const movingAverages = data?.movingAverages || [];
    const oscillators = data?.oscillators || [];
    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex w-full items-center justify-between gap-3">
                <div>
                    <h3 className="text-tremor-title font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">{copy.title}</h3>
                </div>
                <div className="flex shrink-0 gap-2">
                    <StockTabDropdown
                        align="right"
                        label={TIMEFRAME_LABELS[activeFrame]}
                        value={activeFrame}
                        onChange={(frame) => setActiveFrame(frame as TechnicalTimeframe)}
                        options={TIMEFRAMES.map((frame) => {
                            const rating = snapshots[frame]?.data?.gaugeSummary?.rating;
                            return {
                                id: frame,
                                label: (
                                    <span className="flex items-center justify-between gap-3">
                                        {TIMEFRAME_LABELS[frame]}
                                        {rating ? <span className="text-[10px] capitalize opacity-70">{ratingLabel(rating, lang)}</span> : null}
                                    </span>
                                ),
                            };
                        })}
                        ariaLabel="Technical analysis timeframe"
                    />
                </div>
            </div>

            {/* Loading */}
            {loading && (
                <div className="grid gap-4 lg:grid-cols-3">
                    <div className="h-28 animate-pulse rounded-tremor-default bg-gray-100 dark:bg-gray-800" />
                    <div className="h-28 animate-pulse rounded-tremor-default bg-gray-100 dark:bg-gray-800" />
                    <div className="h-28 animate-pulse rounded-tremor-default bg-gray-100 dark:bg-gray-800" />
                </div>
            )}

            {/* Error */}
            {!loading && error && (
                <div className="rounded-tremor-default border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                    <p className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">{error}</p>
                </div>
            )}

            {/* Data */}
            {!loading && data && (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900">
                        <p className="text-slate-500 dark:text-slate-400">{copy.currentPrice}<strong className="ml-2 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{valueText(data.price && data.price > 0 ? data.price : livePrice)}</strong></p>
                        <p className="text-slate-500 dark:text-slate-400">{copy.updated}: {formatDateTime(data.matchTime || current?.fetched_at_utc || current?.serverDateTime, lang)}</p>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-3">
                        <GaugeCard title={copy.summary} data={data.gaugeSummary} lang={lang} />
                        <GaugeCard title={copy.movingAverages} data={data.gaugeMovingAverage} lang={lang} />
                        <GaugeCard title={copy.oscillators} data={data.gaugeOscillator} lang={lang} />
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                        <SignalTable title={copy.movingAverages} rows={movingAverages} lang={lang} />
                        <SignalTable title={copy.oscillators} rows={oscillators} lang={lang} />
                    </div>

                    <PivotGrid pivot={data.pivot} lang={lang} />
                </div>
            )}
        </div>
    );
}
