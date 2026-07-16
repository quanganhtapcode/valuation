'use client';

import { useEffect, useState } from 'react';
import { formatNumber } from '@/lib/api';
import { useLanguage } from '@/lib/languageContext';

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

function ratingLabel(rating?: TechnicalRating): string {
    return rating ? rating.toString().replaceAll('_', ' ') : 'N/A';
}

function formatDateTime(value: string | null | undefined, lang: 'vi' | 'en'): string {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function ratingTone(rating?: TechnicalRating): 'bull' | 'bear' | 'neutral' {
    const n = (rating || '').toString().toUpperCase();
    if (n.includes('BUY') || n.includes('GOOD') || n.includes('BULL') || n.includes('VERY_GOOD')) return 'bull';
    if (n.includes('SELL') || n.includes('BAD') || n.includes('BEAR') || n.includes('VERY_BAD')) return 'bear';
    return 'neutral';
}

function toneRingClass(tone: 'bull' | 'bear' | 'neutral'): string {
    if (tone === 'bull') return 'ring-emerald-500/20';
    if (tone === 'bear') return 'ring-rose-500/20';
    return 'ring-slate-500/20';
}

function bucketType(label: string): 'buy' | 'sell' | 'neutral' {
    const n = label.toUpperCase();
    if (n.includes('BUY') || n.includes('GOOD') || n.includes('BULL')) return 'buy';
    if (n.includes('SELL') || n.includes('BAD') || n.includes('BEAR')) return 'sell';
    return 'neutral';
}

function scoreFromBuckets(buy: number, sell: number): number {
    const total = buy + sell;
    if (!total) return 50;
    return Math.round((buy / total) * 100);
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
    const entries = Object.entries(data?.values || {});
    const ratingText = data?.rating ? data.rating.replaceAll('_', ' ') : '—';
    const buy = entries.reduce((acc, [key, value]) => acc + (bucketType(key) === 'buy' ? Number(value || 0) : 0), 0);
    const sell = entries.reduce((acc, [key, value]) => acc + (bucketType(key) === 'sell' ? Number(value || 0) : 0), 0);
    const neutral = entries.reduce((acc, [key, value]) => acc + (bucketType(key) === 'neutral' ? Number(value || 0) : 0), 0);
    const totalSignals = buy + sell + neutral;
    const tone = ratingTone(data?.rating);
    const score = scoreFromBuckets(buy, sell);
    const hasOnlyBucketEntries = entries.length > 0 && entries.every(([key]) => {
        const n = key.toUpperCase();
        return n.includes('BUY') || n.includes('SELL') || n.includes('NEUTRAL') || n.includes('GOOD') || n.includes('BAD') || n.includes('BULL') || n.includes('BEAR');
    });

    return (
        <div className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ${toneRingClass(tone)} dark:border-slate-800 dark:bg-slate-900`}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{lang === 'vi' ? 'Đánh giá hiện tại' : 'Current assessment'}</p>
                </div>
                <span className={`rounded-tremor-small px-2.5 py-1 text-[11px] font-semibold ${ratingBadgeClass(data?.rating)}`}>
                    {ratingText}
                </span>
            </div>

            <div className="mt-3 space-y-2.5">
                <div className="flex items-end justify-between">
                    <span className="text-xs text-slate-500 dark:text-slate-400">{lang === 'vi' ? 'Sức mạnh tín hiệu' : 'Signal strength'}</span>
                    <span className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{score}</span>
                </div>
                <DistributionBar buy={buy} neutral={neutral} sell={sell} />
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{lang === 'vi' ? 'Mua' : 'Buy'}: {buy}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{lang === 'vi' ? 'Trung lập' : 'Neutral'}: {neutral}</span>
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{lang === 'vi' ? 'Bán' : 'Sell'}: {sell}</span>
                    {totalSignals > 0 && (
                        <span className="ml-auto text-slate-500 dark:text-slate-400">{totalSignals} {lang === 'vi' ? 'tín hiệu' : 'signals'}</span>
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
    const buyCount = rows.filter((row) => bucketType(row.rating || '') === 'buy').length;
    const sellCount = rows.filter((row) => bucketType(row.rating || '') === 'sell').length;
    const neutralCount = Math.max(rows.length - buyCount - sellCount, 0);

    return (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <div className="flex items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h4>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{rows.length} {lang === 'vi' ? 'tín hiệu' : 'signals'}</span>
                </div>
                <div className="mt-3">
                    <DistributionBar buy={buyCount} neutral={neutralCount} sell={sellCount} />
                    <div className="mt-2 flex items-center gap-2 text-[11px]">
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{buyCount} Buy</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{neutralCount} Neutral</span>
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{sellCount} Sell</span>
                    </div>
                </div>
            </div>
            <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500 dark:bg-gray-800/70 dark:text-gray-400">
                    <tr>
                        <th className="px-4 py-2">{lang === 'vi' ? 'Chỉ báo' : 'Indicator'}</th>
                        <th className="px-4 py-2 text-right">{lang === 'vi' ? 'Giá trị' : 'Value'}</th>
                        <th className="px-4 py-2 text-right">{lang === 'vi' ? 'Đánh giá' : 'Assessment'}</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.length > 0 ? rows.map((row, index) => (
                        <tr key={`${row.name || 'signal'}-${index}`} className="border-t border-gray-100 dark:border-gray-800">
                            <td className="px-4 py-2.5 font-medium text-gray-700 dark:text-gray-200">{row.name || '-'}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-900 dark:text-gray-100">{valueText(row.value)}</td>
                            <td className="px-4 py-2.5 text-right">
                                <span className={`inline-flex rounded-tremor-small px-2 py-0.5 text-[11px] font-semibold ${ratingBadgeClass(row.rating)}`}>
                                    {ratingLabel(row.rating)}
                                </span>
                            </td>
                        </tr>
                    )) : (
                        <tr>
                            <td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">{lang === 'vi' ? 'Chưa có dữ liệu' : 'No data available'}</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

function PivotGrid({ pivot, lang }: { pivot?: TechnicalPivot; lang: 'vi' | 'en' }) {
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
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Pivot levels</h4>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{lang === 'vi' ? 'Mức kháng cự và hỗ trợ quan trọng theo Pivot Point.' : 'Key support and resistance levels based on Pivot Points.'}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Classic</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-4">
                        {classicRows.map((row) => (
                            <div key={row.label} className={`rounded-lg px-3 py-2 ${row.cls}`}>
                                <div className="text-[10px] font-medium uppercase tracking-wide opacity-80">{row.label}</div>
                                <div className="mt-0.5 font-semibold tabular-nums">{valueText(row.value)}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Fibonacci</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {fibonacciRows.map((row) => (
                            <div key={row.label} className={`rounded-lg px-3 py-2 ${row.cls}`}>
                                <div className="text-[10px] font-medium uppercase tracking-wide opacity-80">{row.label}</div>
                                <div className="mt-0.5 font-semibold tabular-nums">{valueText(row.value)}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function TechnicalTab({ symbol }: TechnicalTabProps) {
    const { lang } = useLanguage();
    const [activeFrame, setActiveFrame] = useState<TechnicalTimeframe>('ONE_DAY');
    const [snapshots, setSnapshots] = useState<SnapshotState>({});
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
                const response = await fetch(`/api/stock/${symbol}/technical/${frame}`, { signal: controller.signal });
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
                if (!hasData) setError(lang === 'vi' ? 'Chưa có dữ liệu kỹ thuật cho mã này' : 'No technical data is available for this ticker');
            })
            .catch((err) => {
                if (err?.name === 'AbortError') return;
                setLoading(false);
                setError(lang === 'vi' ? 'Không thể load dữ liệu kỹ thuật' : 'Unable to load technical data');
            });

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [symbol, lang]);

    const current = snapshots[activeFrame];
    const data = current?.data;
    const movingAverages = data?.movingAverages || [];
    const oscillators = data?.oscillators || [];
    const summaryTone = ratingTone(data?.gaugeSummary?.rating);
    const summaryToneClass = summaryTone === 'bull'
        ? 'text-emerald-600 dark:text-emerald-400'
        : summaryTone === 'bear'
            ? 'text-rose-600 dark:text-rose-400'
            : 'text-slate-700 dark:text-slate-300';

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex w-full flex-col gap-3 border-b border-slate-200 pb-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h3 className="text-tremor-title font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">{lang === 'vi' ? 'Phân tích kỹ thuật' : 'Technical analysis'}</h3>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {lang === 'vi' ? 'Tín hiệu tổng hợp theo dao động, trung bình động và vùng hỗ trợ/kháng cự.' : 'Combined signals from oscillators, moving averages, and support/resistance levels.'}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {TIMEFRAMES.map((frame) => {
                            const isActive = frame === activeFrame;
                            const snapshot = snapshots[frame];
                            return (
                                <button
                                    key={frame}
                                    type="button"
                                    onClick={() => setActiveFrame(frame)}
                                    className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                                        isActive
                                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-400/50 dark:bg-emerald-500/10 dark:text-emerald-300'
                                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                                    }`}
                                >
                                    {TIMEFRAME_LABELS[frame]}
                                    {snapshot?.data?.gaugeSummary?.rating ? (
                                        <span className="ml-1.5 text-[10px] font-medium opacity-80">
                                            {snapshot.data.gaugeSummary.rating.replaceAll('_', ' ')}
                                        </span>
                                    ) : null}
                                </button>
                            );
                        })}
                    </div>
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
                    <div className="grid gap-4 md:grid-cols-3">
                        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{lang === 'vi' ? 'Đánh giá tổng hợp' : 'Overall assessment'}</p>
                            <p className={`mt-1 text-lg font-semibold ${summaryToneClass}`}>{ratingLabel(data.gaugeSummary?.rating)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{lang === 'vi' ? 'Giá hiện tại' : 'Current price'}</p>
                            <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{valueText(data.price)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{lang === 'vi' ? 'Cập nhật' : 'Updated'}</p>
                            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                                {formatDateTime(data.matchTime || current?.fetched_at_utc || current?.serverDateTime, lang)}
                            </p>
                        </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-3">
                        <GaugeCard title={lang === 'vi' ? 'Tổng hợp' : 'Summary'} data={data.gaugeSummary} lang={lang} />
                        <GaugeCard title="Moving Averages" data={data.gaugeMovingAverage} lang={lang} />
                        <GaugeCard title="Oscillators" data={data.gaugeOscillator} lang={lang} />
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                        <SignalTable title="Moving Averages" rows={movingAverages} lang={lang} />
                        <SignalTable title="Oscillators" rows={oscillators} lang={lang} />
                    </div>

                    <PivotGrid pivot={data.pivot} lang={lang} />
                </div>
            )}
        </div>
    );
}
