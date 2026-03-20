'use client';

import { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '@/lib/api';

type HolderView = 'institutional' | 'individuals';

interface InstitutionalHolder {
    manager: string;
    name_vi?: string | null;
    position?: string | null;
    shares: number;
    ownership_percent?: number;
    value: number;
    change_percent?: number | null;
    update_date?: string;
}

interface HoldersPayload {
    success: boolean;
    symbol: string;
    current_price: number;
    updated_at?: string;
    as_of_shareholders?: string;
    as_of_officers?: string;
    sources?: {
        shareholders?: string;
        officers?: string;
    };
    summary?: {
        institutional_count?: number;
        individual_count?: number;
        institutional_total_shares?: number;
        institutional_total_value?: number;
        individual_total_shares?: number;
        individual_total_value?: number;
    };
    institutional?: InstitutionalHolder[];
    individuals?: InstitutionalHolder[];
}

interface HoldersTabProps {
    symbol: string;
}

function formatCompactShares(value: number): string {
    const n = Number(value || 0);
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toFixed(0);
}

function formatCompactCurrencyVnd(value: number): string {
    const n = Number(value || 0);
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1)}T`;
    if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    return n.toFixed(0);
}

function formatOwnershipPct(value?: number | null): string {
    if (value == null || !Number.isFinite(value)) return '-';
    const pct = Number(value) * 100;
    const abs = Math.abs(pct);
    if (abs >= 1) return `${pct.toFixed(2)}%`;
    if (abs >= 0.01) return `${pct.toFixed(4)}%`;
    return `${pct.toFixed(6)}%`;
}

export default function HoldersTab({ symbol }: HoldersTabProps) {
    const [activeView, setActiveView] = useState<HolderView>('institutional');
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<HoldersPayload | null>(null);

    useEffect(() => {
        if (!symbol) return;

        const controller = new AbortController();
        setLoading(true);
        setError(null);

        fetch(`${API_BASE}/stock/holders/${symbol}`, {
            cache: 'no-store',
            signal: controller.signal,
        })
            .then(async (res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((payload: HoldersPayload) => {
                if (!payload?.success) throw new Error(payload ? 'holders data unavailable' : 'empty response');
                setData(payload);
            })
            .catch((err) => {
                if (controller.signal.aborted) return;
                console.error('holders fetch error', err);
                setError('Unable to load holders data');
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });

        return () => controller.abort();
    }, [symbol]);

    const institutional = data?.institutional || [];
    const individuals = data?.individuals || [];

    useEffect(() => {
        if (institutional.length >= individuals.length && institutional.length > 0) {
            setActiveView('institutional');
        } else if (individuals.length > 0) {
            setActiveView('individuals');
        }
    }, [institutional.length, individuals.length]);

    const rows = useMemo(() => {
        const q = query.trim().toLowerCase();
        const base: InstitutionalHolder[] = activeView === 'individuals' ? individuals : institutional;

        if (!q) return base;

        return base.filter((item) => {
            const name = String(item?.manager || '').toLowerCase();
            return name.includes(q);
        });
    }, [activeView, institutional, individuals, query]);

    const allRowsForDownload = useMemo(() => {
        const institutionalRows = institutional.map((r) => ({
            group: 'Institutional',
            name: r.manager || '',
            position: '',
            shares: Number(r.shares || 0),
            value: Number(r.value || 0),
            ownership_percent: r.ownership_percent,
            update_date: r.update_date || '',
        }));

        const regularRows = individuals.map((r) => ({
            group: 'Regular Shareholders',
            name: r.manager || '',
            position: '',
            shares: Number(r.shares || 0),
            value: Number(r.value || 0),
            ownership_percent: r.ownership_percent,
            update_date: r.update_date || '',
        }));

        return [...institutionalRows, ...regularRows];
    }, [institutional, individuals]);

    const downloadCsv = () => {
        if (!allRowsForDownload.length) return;

        const headers = ['Group', 'Name', 'Position', 'SharesOwned', 'CurrentValueVND', 'OwnershipPercent', 'UpdateDate'];
        const body = allRowsForDownload.map((r) => [
            JSON.stringify(r.group || ''),
            JSON.stringify(r.name || ''),
            JSON.stringify(r.position || ''),
            String(Number(r.shares || 0)),
            String(Number(r.value || 0)),
            r.ownership_percent == null ? '' : String(Number(r.ownership_percent) * 100),
            r.update_date || '',
        ].join(','));

        const csv = [headers.join(','), ...body].join('\n');
        const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${symbol}_all_shareholders.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-4">
            <div className="rounded-tremor-default border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setActiveView('institutional')}
                            className={`rounded-full px-3 py-1 text-sm ${activeView === 'institutional' ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
                        >
                            Institutional ({institutional.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveView('individuals')}
                            className={`rounded-full px-3 py-1 text-sm ${activeView === 'individuals' ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
                        >
                            Regular Shareholders ({individuals.length})
                        </button>
                    </div>

                    <div className="mt-3">
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={activeView === 'individuals' ? 'Find regular shareholders' : 'Find institutional holders'}
                            className="w-full rounded-tremor-default border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-950"
                        />
                    </div>

                    <div className="mt-3 flex justify-end">
                        <button
                            type="button"
                            onClick={downloadCsv}
                            disabled={allRowsForDownload.length === 0}
                            className="rounded-tremor-default border border-gray-200 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-800"
                        >
                            Download All Shareholders
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-100 text-left text-gray-600 dark:border-gray-800 dark:text-gray-300">
                                <th className="px-4 py-3 font-medium">Manager</th>
                                <th className="px-4 py-3 text-right font-medium">Shares Owned</th>
                                <th className="px-4 py-3 text-right font-medium">Current Value</th>
                                <th className="px-4 py-3 text-right font-medium">Ownership (%)</th>
                                <th className="px-4 py-3 text-right font-medium">Updated At</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">Loading holders...</td>
                                </tr>
                            ) : error ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-red-500">{error}</td>
                                </tr>
                            ) : rows.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">No data for this section.</td>
                                </tr>
                            ) : rows.map((row: any, idx) => (
                                <tr key={`${row.manager || row.name || 'row'}-${idx}`} className="border-b border-gray-100 last:border-b-0 dark:border-gray-800">
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-gray-900 dark:text-gray-100">{row.manager || row.name || '-'}</div>
                                        {row.name_vi && row.name_vi !== row.manager ? <div className="text-xs text-gray-400 dark:text-gray-500">{row.name_vi}</div> : null}
                                        {row.position ? <div className="text-xs text-gray-500">{row.position}</div> : null}
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200">{formatCompactShares(Number(row.shares || 0))}</td>
                                    <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200">{formatCompactCurrencyVnd(Number(row.value || 0))}</td>
                                    <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200">
                                        {formatOwnershipPct(row.ownership_percent)}
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-200">
                                        {row.update_date || '-'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
