'use client';

import React, { useEffect, useState } from 'react';
import {
    PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from 'recharts';

interface LoanItem {
    name: string;
    value: number;
}

interface LoanBreakdownData {
    years: number[];
    year: number | null;
    industry: LoanItem[];
    npl: LoanItem[];
}

const INDUSTRY_COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
    '#ef4444', '#06b6d4', '#f97316', '#84cc16',
];

const NPL_COLORS = ['#22c55e', '#facc15', '#f97316', '#ef4444', '#7f1d1d'];

function fmt(v: number): string {
    if (!v) return '0';
    if (v >= 1e12) return `${(v / 1e12).toFixed(1)} nghìn tỷ`;
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)} tỷ`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)} tr`;
    return v.toLocaleString('vi-VN');
}

function pct(v: number, total: number): string {
    if (!total) return '0%';
    return `${((v / total) * 100).toFixed(1)}%`;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
    if (!active || !payload?.length) return null;
    const entry = payload[0];
    const name: string = entry.name;
    const value: number = entry.value;
    const total: number = entry.payload?.total ?? 0;
    return (
        <div className="rounded-lg border border-tremor-border bg-white px-3 py-2 text-xs shadow-md dark:border-dark-tremor-border dark:bg-gray-900">
            <p className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong mb-0.5">{name}</p>
            <p className="text-tremor-content dark:text-dark-tremor-content">{fmt(value)}</p>
            {total > 0 && (
                <p className="text-tremor-content-subtle dark:text-dark-tremor-content-subtle">{pct(value, total)}</p>
            )}
        </div>
    );
}

function PieSection({
    title,
    data,
    colors,
}: {
    title: string;
    data: LoanItem[];
    colors: string[];
}) {
    const total = data.reduce((s, d) => s + d.value, 0);
    const enriched = data.map(d => ({ ...d, total }));

    return (
        <div className="flex-1 min-w-0">
            <h4 className="text-xs font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong mb-2 text-center">
                {title}
            </h4>
            <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                    <Pie
                        data={enriched}
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                    >
                        {enriched.map((_, i) => (
                            <Cell key={i} fill={colors[i % colors.length]} />
                        ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                </PieChart>
            </ResponsiveContainer>
            {/* Legend */}
            <div className="mt-2 flex flex-col gap-1 px-1">
                {data.map((d, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                        <div className="flex items-center gap-1.5 min-w-0">
                            <span
                                className="h-2 w-2 flex-shrink-0 rounded-full"
                                style={{ backgroundColor: colors[i % colors.length] }}
                            />
                            <span className="truncate text-tremor-content dark:text-dark-tremor-content">{d.name}</span>
                        </div>
                        <span className="flex-shrink-0 font-medium tabular-nums text-tremor-content-strong dark:text-dark-tremor-content-strong">
                            {pct(d.value, total)}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function BankLoanBreakdown({ symbol }: { symbol: string }) {
    const [data, setData] = useState<LoanBreakdownData | null>(null);
    const [selectedYear, setSelectedYear] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        setError(null);
        const yearParam = selectedYear ? `?year=${selectedYear}` : '';
        fetch(`/api/stock/${symbol}/loan-breakdown${yearParam}`)
            .then(r => r.json())
            .then((d: LoanBreakdownData) => {
                setData(d);
                if (!selectedYear && d.year) setSelectedYear(d.year);
            })
            .catch(() => setError('Không thể tải dữ liệu'))
            .finally(() => setLoading(false));
    }, [symbol, selectedYear]);

    if (loading) {
        return (
            <div className="h-48 flex items-center justify-center text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle animate-pulse">
                Đang tải dữ liệu thuyết minh…
            </div>
        );
    }

    if (error || !data || (!data.industry.length && !data.npl.length)) {
        return (
            <div className="h-24 flex items-center justify-center text-xs text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                Không có dữ liệu cho vay trong thuyết minh
            </div>
        );
    }

    return (
        <div>
            {/* Header + year selector */}
            <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                    Cơ cấu cho vay
                </h3>
                {data.years.length > 1 && (
                    <select
                        value={selectedYear ?? ''}
                        onChange={e => setSelectedYear(Number(e.target.value))}
                        className="rounded border border-tremor-border bg-tremor-background px-2 py-1 text-xs text-tremor-content-strong dark:border-dark-tremor-border dark:bg-dark-tremor-background dark:text-dark-tremor-content-strong"
                    >
                        {data.years.map(y => (
                            <option key={y} value={y}>{y}</option>
                        ))}
                    </select>
                )}
            </div>

            {/* Two pie charts side by side */}
            <div className="flex gap-4">
                {data.industry.length > 0 && (
                    <PieSection
                        title="Cho vay theo ngành"
                        data={data.industry}
                        colors={INDUSTRY_COLORS}
                    />
                )}
                {data.npl.length > 0 && (
                    <PieSection
                        title="Chất lượng nợ vay"
                        data={data.npl}
                        colors={NPL_COLORS}
                    />
                )}
            </div>
        </div>
    );
}
