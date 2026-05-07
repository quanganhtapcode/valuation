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
    gaugeMovingAverage?: {
        rating?: TechnicalRating;
        values?: Record<string, number>;
    };
    gaugeOscillator?: {
        rating?: TechnicalRating;
        values?: Record<string, number>;
    };
    gaugeSummary?: {
        rating?: TechnicalRating;
        values?: Record<string, number>;
    };
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
    code?: number;
    status?: number;
    msg?: string;
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

function ratingTone(rating?: TechnicalRating): string {
    const normalized = (rating || '').toString().toUpperCase();
    if (normalized.includes('BUY') || normalized.includes('GOOD') || normalized.includes('BULL') || normalized.includes('VERY_GOOD')) {
        return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/40';
    }
    if (normalized.includes('SELL') || normalized.includes('BAD') || normalized.includes('BEAR') || normalized.includes('VERY_BAD')) {
        return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900/40';
    }
    if (normalized.includes('NEUTRAL')) {
        return 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
    }
    return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900/40';
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

function GaugeCard({
    title,
    data,
}: {
    title: string;
    data?: { rating?: TechnicalRating; values?: Record<string, number> };
}) {
    const entries = Object.entries(data?.values || {});
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{ratingLabel(data?.rating)}</p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${ratingTone(data?.rating)}`}>
                    {data?.rating ? data.rating.replaceAll('_', ' ') : 'Chưa có'}
                </span>
            </div>
            {entries.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                    {entries.map(([key, value]) => (
                        <span
                            key={key}
                            className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        >
                            <span className="font-medium">{key}</span>
                            <span className="font-semibold tabular-nums">{value}</span>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function SignalTable({
    title,
    rows,
}: {
    title: string;
    rows: TechnicalSignal[];
}) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h4>
                <span className="text-xs text-slate-500 dark:text-slate-400">{rows.length} tín hiệu</span>
            </div>
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/70 dark:text-slate-400">
                        <tr>
                            <th className="px-3 py-2 font-medium">Chỉ báo</th>
                            <th className="px-3 py-2 font-medium">Giá trị</th>
                            <th className="px-3 py-2 font-medium">Đánh giá</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length > 0 ? rows.map((row, index) => (
                            <tr key={`${row.name || 'signal'}-${index}`} className="border-t border-slate-100 dark:border-slate-800">
                                <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{row.name || '-'}</td>
                                <td className="px-3 py-2 tabular-nums text-slate-900 dark:text-white">{valueText(row.value)}</td>
                                <td className="px-3 py-2">
                                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ratingTone(row.rating)}`}>
                                        {ratingLabel(row.rating)}
                                    </span>
                                </td>
                            </tr>
                        )) : (
                            <tr>
                                <td colSpan={3} className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                                    Chưa có dữ liệu
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function PivotGrid({ pivot }: { pivot?: TechnicalPivot }) {
    const rows: Array<{ label: string; value?: number | null; tone?: 'emerald' | 'rose' | 'amber' | 'slate' }> = [
        { label: 'Pivot', value: pivot?.pivotPoint, tone: 'amber' },
        { label: 'Kháng cự 1', value: pivot?.resistance1, tone: 'rose' },
        { label: 'Kháng cự 2', value: pivot?.resistance2, tone: 'rose' },
        { label: 'Kháng cự 3', value: pivot?.resistance3, tone: 'rose' },
        { label: 'Hỗ trợ 1', value: pivot?.support1, tone: 'emerald' },
        { label: 'Hỗ trợ 2', value: pivot?.support2, tone: 'emerald' },
        { label: 'Hỗ trợ 3', value: pivot?.support3, tone: 'emerald' },
        { label: 'Fib R1', value: pivot?.fibResistance1, tone: 'rose' },
        { label: 'Fib R2', value: pivot?.fibResistance2, tone: 'rose' },
        { label: 'Fib R3', value: pivot?.fibResistance3, tone: 'rose' },
        { label: 'Fib S1', value: pivot?.fibSupport1, tone: 'emerald' },
        { label: 'Fib S2', value: pivot?.fibSupport2, tone: 'emerald' },
        { label: 'Fib S3', value: pivot?.fibSupport3, tone: 'emerald' },
    ];

    const toneClass = (tone?: string) => {
        if (tone === 'emerald') return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300';
        if (tone === 'rose') return 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300';
        if (tone === 'amber') return 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300';
        return 'bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
    };

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Pivot levels</h4>
                <span className="text-xs text-slate-500 dark:text-slate-400">Hỗ trợ / kháng cự</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {rows.map((row) => (
                    <div key={row.label} className={`rounded-xl px-3 py-2 ${toneClass(row.tone)}`}>
                        <div className="text-[11px] font-medium uppercase tracking-wide opacity-75">{row.label}</div>
                        <div className="mt-1 font-semibold tabular-nums">{valueText(row.value)}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function TechnicalTab({ symbol }: TechnicalTabProps) {
    const [activeFrame, setActiveFrame] = useState<TechnicalTimeframe>('ONE_DAY');
    const [snapshots, setSnapshots] = useState<SnapshotState>({});
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!symbol) return;

        const controller = new AbortController();
        let cancelled = false;
        const clearErrorTimer = window.setTimeout(() => {
            if (!cancelled) {
                setError(null);
            }
        }, 0);

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
                if (!hasData) {
                    setError('Không có dữ liệu kỹ thuật từ SQLite');
                }
            })
            .catch((err) => {
                if (err?.name === 'AbortError') return;
                setError('Không thể tải dữ liệu kỹ thuật');
            });

        return () => {
            cancelled = true;
            controller.abort();
            window.clearTimeout(clearErrorTimer);
        };
    }, [symbol]);

    const current = snapshots[activeFrame];
    const data = current?.data;
    const movingAverages = data?.movingAverages || [];
    const oscillators = data?.oscillators || [];
    const isLoading = Object.keys(snapshots).length === 0 && !error;

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm dark:border-slate-800 dark:from-slate-950 dark:to-slate-900">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Kĩ thuật</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            Nguồn Vietcap IQ, đọc từ SQLite mỗi 5 phút
                        </p>
                    </div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                        Cập nhật: <span className="font-medium text-slate-700 dark:text-slate-200">{formatDateTime(current?.fetched_at_utc || current?.serverDateTime)}</span>
                    </div>
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
                                className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                                    isActive
                                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-400 dark:bg-emerald-950/30 dark:text-emerald-300'
                                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:text-white'
                                }`}
                            >
                                {TIMEFRAME_LABELS[frame]}
                                {snapshot?.data?.gaugeSummary?.rating ? (
                                    <span className="ml-2 text-[11px] font-medium opacity-75">
                                        {snapshot.data.gaugeSummary.rating.replaceAll('_', ' ')}
                                    </span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
            </div>

            {isLoading && !data && (
                <div className="grid gap-4 lg:grid-cols-2">
                    <div className="h-40 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
                    <div className="h-40 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
                    <div className="h-56 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800 lg:col-span-2" />
                </div>
            )}

            {error && !data && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
                    {error}
                </div>
            )}

            {data && (
                <div className="space-y-4">
                    <div className="grid gap-4 lg:grid-cols-3">
                        <GaugeCard title="Tổng hợp" data={data.gaugeSummary} />
                        <GaugeCard title="Moving Averages" data={data.gaugeMovingAverage} />
                        <GaugeCard title="Oscillators" data={data.gaugeOscillator} />
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Giá và trạng thái</h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">Khung {TIMEFRAME_LABELS[activeFrame]}</p>
                                </div>
                                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${ratingTone(data.gaugeSummary?.rating)}`}>
                                    {data.gaugeSummary?.rating ? data.gaugeSummary.rating.replaceAll('_', ' ') : 'N/A'}
                                </span>
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
                                    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Giá</div>
                                    <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white tabular-nums">{valueText(data.price)}</div>
                                </div>
                                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
                                    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Match time</div>
                                    <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{formatDateTime(data.matchTime)}</div>
                                </div>
                                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
                                    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Timeframe</div>
                                    <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{TIMEFRAME_LABELS[activeFrame]}</div>
                                </div>
                            </div>
                        </div>

                        <PivotGrid pivot={data.pivot} />
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                        <SignalTable title="Moving averages" rows={movingAverages} />
                        <SignalTable title="Oscillators" rows={oscillators} />
                    </div>
                </div>
            )}
        </div>
    );
}
