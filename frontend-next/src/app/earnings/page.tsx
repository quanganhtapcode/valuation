'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Release = {
    ticker: string;
    name: string;
    public_date: string;
    revenue: number | null;
    revenue_yoy: number | null;
    net_income: number | null;
    net_income_yoy: number | null;
};

type EarningsReleases = {
    quarter: string | null;
    releases: Release[];
    updated_at: string;
};

const fmtBn = (value: number | null) => value == null
    ? '—'
    : `${(value / 1_000_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tỷ`;

const fmtPct = (value: number | null) => value == null
    ? '—'
    : `${value >= 0 ? '+' : ''}${value.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;

export default function EarningsPage() {
    const [data, setData] = useState<EarningsReleases | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        fetch('/api/market/earnings-releases')
            .then(response => response.ok ? response.json() : Promise.reject())
            .then(setData)
            .catch(() => setError(true));
    }, []);

    return (
        <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
            <div className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6">
                <header className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h1 className="text-3xl font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100 md:text-4xl">
                            BCTC <span className="text-emerald-600 dark:text-emerald-400">Vừa Công Bố</span>
                        </h1>
                        <div className="mt-2 h-1 w-32 rounded bg-emerald-500" />
                        <p className="mt-3 max-w-4xl text-sm text-slate-600 dark:text-slate-300 md:text-base">
                            {data?.quarter ? `${data.quarter} · ` : ''}Doanh thu và LNST thuộc cổ đông công ty mẹ; so sánh cùng kỳ.
                        </p>
                    </div>
                </header>

                {error && <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">Không tải được dữ liệu BCTC.</p>}
                {!data && !error && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">Đang tải…</p>}

                {data && (
                    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        <table className="w-full min-w-[760px] text-sm">
                            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-400">
                            <tr>
                                <th className="px-4 py-3">Công bố</th>
                                <th className="px-4 py-3">Mã / Doanh nghiệp</th>
                                <th className="px-4 py-3 text-right">Doanh thu</th>
                                <th className="px-4 py-3 text-right">YoY</th>
                                <th className="px-4 py-3 text-right">LNST</th>
                                <th className="px-4 py-3 text-right">YoY</th>
                            </tr>
                        </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {data.releases.map(item => (
                                <tr key={item.ticker} className="hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20">
                                    <td className="whitespace-nowrap px-4 py-3 text-slate-500 dark:text-slate-400">{item.public_date.slice(0, 10)}</td>
                                    <td className="px-4 py-3">
                                        <Link href={`/stock/${item.ticker}`} className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400">{item.ticker}</Link>
                                        <span className="ml-2 text-slate-600 dark:text-slate-300">{item.name}</span>
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{fmtBn(item.revenue)}</td>
                                    <td className={`px-4 py-3 text-right tabular-nums ${item.revenue_yoy != null && item.revenue_yoy < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtPct(item.revenue_yoy)}</td>
                                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{fmtBn(item.net_income)}</td>
                                    <td className={`px-4 py-3 text-right tabular-nums ${item.net_income_yoy != null && item.net_income_yoy < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtPct(item.net_income_yoy)}</td>
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
