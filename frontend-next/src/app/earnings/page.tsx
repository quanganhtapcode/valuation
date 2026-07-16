'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/lib/languageContext';

type Release = {
    ticker: string;
    name: string;
    name_en: string;
    public_date: string;
    revenue: number | null;
    revenue_yoy: number | null;
    revenue_qoq: number | null;
    net_income: number | null;
    net_income_yoy: number | null;
    net_income_qoq: number | null;
};

type EarningsReleases = {
    quarter: string | null;
    releases: Release[];
    updated_at: string;
};

type SortKey = 'public_date' | 'ticker' | 'revenue' | 'revenue_yoy' | 'revenue_qoq' | 'net_income' | 'net_income_yoy' | 'net_income_qoq';
type SortDirection = 'asc' | 'desc';

const fmtBn = (value: number | null, lang: 'vi' | 'en') => value == null
    ? '—'
    : `${(value / 1_000_000_000).toLocaleString(lang === 'en' ? 'en-US' : 'vi-VN', { maximumFractionDigits: 1 })} ${lang === 'en' ? 'bn VND' : 'tỷ'}`;

const fmtPct = (value: number | null, lang: 'vi' | 'en') => value == null
    ? '—'
    : `${value >= 0 ? '+' : ''}${value.toLocaleString(lang === 'en' ? 'en-US' : 'vi-VN', { maximumFractionDigits: 1 })}%`;

function SortHeader({ label, column, sortKey, sortDirection, onSort }: {
    label: string;
    column: SortKey;
    sortKey: SortKey;
    sortDirection: SortDirection;
    onSort: (column: SortKey) => void;
}) {
    const active = sortKey === column;
    return (
        <th className="px-4 py-3 text-right">
            <button type="button" onClick={() => onSort(column)} className="inline-flex items-center gap-1 font-semibold hover:text-emerald-600 dark:hover:text-emerald-400">
                {label}<span aria-hidden="true" className={active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}>{active ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}</span>
            </button>
        </th>
    );
}

export default function EarningsPage() {
    const { lang } = useLanguage();
    const [data, setData] = useState<EarningsReleases | null>(null);
    const [error, setError] = useState(false);
    const [sortKey, setSortKey] = useState<SortKey>('public_date');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

    const copy = lang === 'en'
        ? {
            title: 'Financials', accent: 'Recently Reported', description: 'Revenue and net income attributable to parent shareholders; year-over-year and quarter-over-quarter comparison.',
            error: 'Unable to load financial-report data.', loading: 'Loading…', published: 'Published', company: 'Ticker / Company', revenue: 'Revenue', netIncome: 'Net income',
        }
        : {
            title: 'BCTC', accent: 'Vừa Công Bố', description: 'Doanh thu và LNST thuộc cổ đông công ty mẹ; so sánh cùng kỳ và quý trước.',
            error: 'Không tải được dữ liệu BCTC.', loading: 'Đang tải…', published: 'Công bố', company: 'Mã / Doanh nghiệp', revenue: 'Doanh thu', netIncome: 'LNST',
        };

    useEffect(() => {
        fetch('/api/market/earnings-releases')
            .then(response => response.ok ? response.json() : Promise.reject())
            .then(setData)
            .catch(() => setError(true));
    }, []);

    const sortedReleases = useMemo(() => {
        if (!data) return [];
        return [...data.releases].sort((a, b) => {
            const aValue = a[sortKey];
            const bValue = b[sortKey];
            if (aValue == null) return 1;
            if (bValue == null) return -1;
            const result = typeof aValue === 'number' && typeof bValue === 'number'
                ? aValue - bValue
                : String(aValue).localeCompare(String(bValue));
            return sortDirection === 'asc' ? result : -result;
        });
    }, [data, sortDirection, sortKey]);

    const handleSort = (column: SortKey) => {
        if (column === sortKey) {
            setSortDirection(direction => direction === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(column);
            setSortDirection('desc');
        }
    };

    return (
        <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
            <div className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6">
                <header className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h1 className="text-3xl font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100 md:text-4xl">
                            {copy.title} <span className="text-emerald-600 dark:text-emerald-400">{copy.accent}</span>
                        </h1>
                        <div className="mt-2 h-1 w-32 rounded bg-emerald-500" />
                        <p className="mt-3 max-w-4xl text-sm text-slate-600 dark:text-slate-300 md:text-base">
                            {data?.quarter ? `${data.quarter} · ` : ''}{copy.description}
                        </p>
                    </div>
                </header>

                {error && <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">{copy.error}</p>}
                {!data && !error && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">{copy.loading}</p>}

                {data && (
                    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        <table className="w-full min-w-[980px] text-sm">
                            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-400">
                            <tr>
                                <th className="px-4 py-3"><button type="button" onClick={() => handleSort('public_date')} className="inline-flex items-center gap-1 font-semibold hover:text-emerald-600 dark:hover:text-emerald-400">{copy.published}<span aria-hidden="true" className={sortKey === 'public_date' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}>{sortKey === 'public_date' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}</span></button></th>
                                <th className="px-4 py-3"><button type="button" onClick={() => handleSort('ticker')} className="inline-flex items-center gap-1 font-semibold hover:text-emerald-600 dark:hover:text-emerald-400">{copy.company}<span aria-hidden="true" className={sortKey === 'ticker' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}>{sortKey === 'ticker' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}</span></button></th>
                                <SortHeader label={copy.revenue} column="revenue" sortKey={sortKey} sortDirection={sortDirection} onSort={handleSort} />
                                <SortHeader label="YoY" column="revenue_yoy" sortKey={sortKey} sortDirection={sortDirection} onSort={handleSort} />
                                <SortHeader label="QoQ" column="revenue_qoq" sortKey={sortKey} sortDirection={sortDirection} onSort={handleSort} />
                                <SortHeader label={copy.netIncome} column="net_income" sortKey={sortKey} sortDirection={sortDirection} onSort={handleSort} />
                                <SortHeader label="YoY" column="net_income_yoy" sortKey={sortKey} sortDirection={sortDirection} onSort={handleSort} />
                                <SortHeader label="QoQ" column="net_income_qoq" sortKey={sortKey} sortDirection={sortDirection} onSort={handleSort} />
                            </tr>
                        </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {sortedReleases.map(item => (
                                <tr key={item.ticker} className="hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20">
                                    <td className="whitespace-nowrap px-4 py-3 text-slate-500 dark:text-slate-400">{new Date(item.public_date).toLocaleDateString(lang === 'en' ? 'en-US' : 'vi-VN')}</td>
                                    <td className="px-4 py-3">
                                        <Link href={`/stock/${item.ticker}`} className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400">{item.ticker}</Link>
                                        <span className="ml-2 text-slate-600 dark:text-slate-300">{lang === 'en' ? item.name_en : item.name}</span>
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{fmtBn(item.revenue, lang)}</td>
                                    <td className={`px-4 py-3 text-right tabular-nums ${item.revenue_yoy != null && item.revenue_yoy < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtPct(item.revenue_yoy, lang)}</td>
                                    <td className={`px-4 py-3 text-right tabular-nums ${item.revenue_qoq != null && item.revenue_qoq < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtPct(item.revenue_qoq, lang)}</td>
                                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{fmtBn(item.net_income, lang)}</td>
                                    <td className={`px-4 py-3 text-right tabular-nums ${item.net_income_yoy != null && item.net_income_yoy < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtPct(item.net_income_yoy, lang)}</td>
                                    <td className={`px-4 py-3 text-right tabular-nums ${item.net_income_qoq != null && item.net_income_qoq < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtPct(item.net_income_qoq, lang)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                )}
            </div>
        </main>
    );
}
