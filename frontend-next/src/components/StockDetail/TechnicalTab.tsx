'use client';

import { useEffect, useState } from 'react';
import { formatNumber } from '@/lib/api';

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

function formatDateTime(value?: string | null): string {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString('vi-VN', { dateStyle: 'medium', timeStyle: 'short' });
}

function GaugeCard({ title, data }: { title: string; data?: { rating?: TechnicalRating; values?: Record<string, number> } }) {
    const entries = Object.entries(data?.values || {});
    return (
        <div className="rounded-tremor-default border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</p>
                    <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">{ratingLabel(data?.rating)}</p>
                </div>
                <span className={`rounded-tremor-small px-2.5 py-1 text-[11px] font-semibold ${ratingBadgeClass(data?.rating)}`}>
                    {data?.rating ? data.rating.replaceAll('_', ' ') : '—'}
                </span>
            </div>
            {entries.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                    {entries.map(([key, value]) => (
                        <span key={key} className="inline-flex items-center gap-1 rounded-tremor-small bg-gray-50 px-2.5 py-1 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                            <span className="font-medium">{key}</span>
                            <span className="font-semibold tabular-nums">{value}</span>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function SignalTable({ title, rows }: { title: string; rows: TechnicalSignal[] }) {
    return (
        <div className="rounded-tremor-default border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h4>
                <span className="text-xs text-gray-500 dark:text-gray-400">{rows.length} tín hiệu</span>
            </div>
            <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500 dark:bg-gray-800/70 dark:text-gray-400">
                    <tr>
                        <th className="px-4 py-2">Chỉ báo</th>
                        <th className="px-4 py-2 text-right">Giá trị</th>
                        <th className="px-4 py-2 text-right">Đánh giá</th>
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
                            <td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">Chưa có dữ liệu</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

function PivotGrid({ pivot }: { pivot?: TechnicalPivot }) {
    const rows: Array<{ label: string; value?: number | null; cls: string }> = [
        { label: 'Pivot', value: pivot?.pivotPoint, cls: 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-400' },
        { label: 'R1', value: pivot?.resistance1, cls: 'bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-400' },
        { label: 'R2', value: pivot?.resistance2, cls: 'bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-400' },
        { label: 'R3', value: pivot?.resistance3, cls: 'bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-400' },
        { label: 'S1', value: pivot?.support1, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400' },
        { label: 'S2', value: pivot?.support2, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400' },
        { label: 'S3', value: pivot?.support3, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400' },
        { label: 'Fib R1', value: pivot?.fibResistance1, cls: 'bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-400' },
        { label: 'Fib R2', value: pivot?.fibResistance2, cls: 'bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-400' },
        { label: 'Fib R3', value: pivot?.fibResistance3, cls: 'bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-400' },
        { label: 'Fib S1', value: pivot?.fibSupport1, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400' },
        { label: 'Fib S2', value: pivot?.fibSupport2, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400' },
        { label: 'Fib S3', value: pivot?.fibSupport3, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400' },
    ];

    return (
        <div className="rounded-tremor-default border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Pivot levels</h4>
            </div>
            <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
                {rows.map((row) => (
                    <div key={row.label} className={`rounded-tremor-small px-3 py-2 ${row.cls}`}>
                        <div className="text-[11px] font-medium uppercase tracking-wide opacity-75">{row.label}</div>
                        <div className="mt-0.5 font-semibold tabular-nums">{valueText(row.value)}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function TechnicalTab({ symbol }: TechnicalTabProps) {
    const [activeFrame, setActiveFrame] = useState<TechnicalTimeframe>('ONE_DAY');
    const [snapshots, setSnapshots] = useState<SnapshotState>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!symbol) return;

        setLoading(true);
        setError(null);

        const controller = new AbortController();
        let cancelled = false;

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
                if (!hasData) setError('Chưa có dữ liệu kỹ thuật cho mã này');
            })
            .catch((err) => {
                if (err?.name === 'AbortError') return;
                setLoading(false);
                setError('Không thể tải dữ liệu kỹ thuật');
            });

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [symbol]);

    const current = snapshots[activeFrame];
    const data = current?.data;
    const movingAverages = data?.movingAverages || [];
    const oscillators = data?.oscillators || [];

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="rounded-tremor-default border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Kĩ thuật</h3>
                        {current?.fetched_at_utc && (
                            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                                Cập nhật: {formatDateTime(current.fetched_at_utc)}
                            </p>
                        )}
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
                                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                                        isActive
                                            ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                                    }`}
                                >
                                    {TIMEFRAME_LABELS[frame]}
                                    {snapshot?.data?.gaugeSummary?.rating ? (
                                        <span className="ml-1.5 text-[10px] font-medium opacity-70">
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
                    <div className="grid gap-4 lg:grid-cols-3">
                        <GaugeCard title="Tổng hợp" data={data.gaugeSummary} />
                        <GaugeCard title="Moving Averages" data={data.gaugeMovingAverage} />
                        <GaugeCard title="Oscillators" data={data.gaugeOscillator} />
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                        <SignalTable title="Moving Averages" rows={movingAverages} />
                        <SignalTable title="Oscillators" rows={oscillators} />
                    </div>

                    <PivotGrid pivot={data.pivot} />
                </div>
            )}
        </div>
    );
}
