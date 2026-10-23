'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { API_BASE } from '@/lib/api';
import { DownloadIcon, StockTabDropdown, StockTabIconButton } from './StockTabControls';

type HolderView = 'institutional' | 'individuals';

interface InstitutionalHolder {
    manager: string;
    name_vi?: string | null;
    position?: string | null;
    name_en?: string | null;
    position_vi?: string | null;
    position_en?: string | null;
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
    const { lang } = useLanguage();
    const vi = lang === 'vi';
    const labels = {
        institutional: vi ? 'Cổ đông tổ chức' : 'Institutional',
        individuals: vi ? 'Cổ đông cá nhân' : 'Regular Shareholders',
        loading: vi ? 'Đang tải cổ đông...' : 'Loading holders...',
        error: vi ? 'Không thể tải dữ liệu cổ đông' : 'Unable to load holders data',
    };
    const holderName = (row: InstitutionalHolder) =>
        (vi ? row.name_vi : row.name_en) || row.manager || row.name_vi || '-';
    const holderPosition = (row: InstitutionalHolder) =>
        (vi ? row.position_vi : row.position_en) || row.position;
    const [chosenView, setActiveView] = useState<HolderView | null>(null);
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<HoldersPayload | null>(null);

    useEffect(() => {
        if (!symbol) return;

        const controller = new AbortController();
        queueMicrotask(() => {
            if (controller.signal.aborted) return;
            setLoading(true);
            setData(null);
            setActiveView(null);
            setQuery('');
            setError(null);
        });

        fetch(`${API_BASE}/stocks/${symbol}/shareholders`, {
            cache: 'no-store',
            signal: controller.signal,
        })
            .then(async (res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((payload: HoldersPayload) => {
                if (!payload?.success) throw new Error(payload ? 'holders data unavailable' : 'empty response');
                if (!controller.signal.aborted) setData(payload);
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

    const institutional = useMemo(() => data?.institutional || [], [data]);
    const individuals = useMemo(() => data?.individuals || [], [data]);

    const activeView = chosenView ?? (institutional.length >= individuals.length ? 'institutional' : 'individuals');

    const rows = useMemo(() => {
        const q = query.trim().toLowerCase();
        const base: InstitutionalHolder[] = activeView === 'individuals' ? individuals : institutional;

        if (!q) return base;

        return base.filter((item) => {
            const name = [item.manager, item.name_vi, item.name_en].filter(Boolean).join(' ').toLowerCase();
            return name.includes(q);
        });
    }, [activeView, institutional, individuals, query]);

    const allRowsForDownload = (() => {
        const institutionalRows = institutional.map((r) => ({
            group: labels.institutional,
            name: holderName(r),
            position: holderPosition(r) || '',
            shares: Number(r.shares || 0),
            value: Number(r.value || 0),
            ownership_percent: r.ownership_percent,
            update_date: r.update_date || '',
        }));

        const regularRows = individuals.map((r) => ({
            group: labels.individuals,
            name: holderName(r),
            position: holderPosition(r) || '',
            shares: Number(r.shares || 0),
            value: Number(r.value || 0),
            ownership_percent: r.ownership_percent,
            update_date: r.update_date || '',
        }));

        return [...institutionalRows, ...regularRows];
    })();

    const downloadCsv = () => {
        if (!allRowsForDownload.length) return;

        const headers = vi
            ? ['Nhóm', 'Tên', 'Chức danh', 'Số cổ phiếu', 'Giá trị (VND)', 'Sở hữu (%)', 'Ngày cập nhật']
            : ['Group', 'Name', 'Position', 'SharesOwned', 'CurrentValueVND', 'OwnershipPercent', 'UpdateDate'];
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
        <div className="space-y-3">
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
                <h3 className="text-tremor-title font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">{vi ? 'Cổ đông' : 'Holders'}</h3>
                <div className="ml-auto flex w-full min-w-0 items-center justify-end gap-2 sm:w-auto [&>div]:shrink-0 [&>button]:shrink-0">
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={vi ? 'Tìm cổ đông' : 'Find shareholders'}
                        aria-label={vi ? 'Tìm cổ đông' : 'Find shareholders'}
                        className="h-8 min-w-0 w-0 flex-1 rounded-full border border-gray-200 bg-white px-3 text-[13px] text-gray-700 shadow-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 sm:w-48 sm:flex-none"
                    />
                    {loading ? <span className="text-sm text-gray-500">{labels.loading}</span> : <StockTabDropdown
                        label={`${labels[activeView]} (${activeView === 'institutional' ? institutional.length : individuals.length})`}
                        value={activeView}
                        onChange={(view) => setActiveView(view as HolderView)}
                        options={[
                            { id: 'institutional', label: `${labels.institutional} (${institutional.length})` },
                            { id: 'individuals', label: `${labels.individuals} (${individuals.length})` },
                        ]}
                        ariaLabel={vi ? 'Loại cổ đông' : 'Shareholder type'}
                    />}
                    <StockTabIconButton onClick={downloadCsv} title={vi ? 'Tải danh sách cổ đông' : 'Download all shareholders'} disabled={allRowsForDownload.length === 0}>
                        <DownloadIcon />
                    </StockTabIconButton>
                </div>
            </div>

            <div className="rounded-tremor-default border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-100 text-left text-gray-600 dark:border-gray-800 dark:text-gray-300">
                                <th className="px-4 py-3 font-medium">{vi ? 'Cổ đông' : 'Manager'}</th>
                                <th className="px-4 py-3 text-right font-medium">{vi ? 'Số cổ phiếu' : 'Shares Owned'}</th>
                                <th className="px-4 py-3 text-right font-medium">{vi ? 'Giá trị hiện tại' : 'Current Value'}</th>
                                <th className="px-4 py-3 text-right font-medium">{vi ? 'Sở hữu (%)' : 'Ownership (%)'}</th>
                                <th className="px-4 py-3 text-right font-medium">{vi ? 'Ngày cập nhật' : 'Updated At'}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">{labels.loading}</td>
                                </tr>
                            ) : error ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-red-500">{labels.error}</td>
                                </tr>
                            ) : rows.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">{vi ? 'Chưa có dữ liệu.' : 'No data for this section.'}</td>
                                </tr>
                            ) : rows.map((row, idx) => (
                                <tr key={`${row.manager || 'row'}-${idx}`} className="border-b border-gray-100 last:border-b-0 dark:border-gray-800">
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-gray-900 dark:text-gray-100">{holderName(row)}</div>
                                        {holderPosition(row) ? <div className="text-xs text-gray-500">{holderPosition(row)}</div> : null}
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
