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
        <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">BCTC vừa công bố</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {data?.quarter ? `${data.quarter} · ` : ''}Doanh thu và LNST thuộc cổ đông công ty mẹ; so sánh cùng kỳ.
            </p>

            {error && <p className="mt-6 text-sm text-red-600">Không tải được dữ liệu BCTC.</p>}
            {!data && !error && <p className="mt-6 text-sm text-gray-500">Đang tải…</p>}

            {data && (
                <div className="mt-6 overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
                    <table className="w-full min-w-[760px] text-sm">
                        <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-800">
                            <tr>
                                <th className="px-4 py-3">Công bố</th>
                                <th className="px-4 py-3">Mã / Doanh nghiệp</th>
                                <th className="px-4 py-3 text-right">Doanh thu</th>
                                <th className="px-4 py-3 text-right">YoY</th>
                                <th className="px-4 py-3 text-right">LNST</th>
                                <th className="px-4 py-3 text-right">YoY</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {data.releases.map(item => (
                                <tr key={item.ticker} className="hover:bg-blue-50/50 dark:hover:bg-blue-950/20">
                                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">{item.public_date.slice(0, 10)}</td>
                                    <td className="px-4 py-3">
                                        <Link href={`/stock/${item.ticker}`} className="font-semibold text-blue-600 hover:underline dark:text-blue-400">{item.ticker}</Link>
                                        <span className="ml-2 text-gray-600 dark:text-gray-300">{item.name}</span>
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
        </main>
    );
}
