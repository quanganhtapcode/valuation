'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, LineChart, Text, Title } from '@tremor/react';

type ValuationHistoryRow = { period: string; 'P/E': number | null; 'P/B': number | null };

function toNumberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function toRows(response: any): ValuationHistoryRow[] {
    const records = Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response?.records)
            ? response.records
            : [];

    if (records.length) {
        return records.map((row: any) => ({
            period: String(row?.period ?? row?.date ?? row?.tradingDate ?? row?.trading_date ?? '').slice(0, 10),
            'P/E': toNumberOrNull(row?.pe ?? row?.['P/E'] ?? row?.PE),
            'P/B': toNumberOrNull(row?.pb ?? row?.['P/B'] ?? row?.PB),
        })).filter((row: ValuationHistoryRow) => row.period && (row['P/E'] !== null || row['P/B'] !== null));
    }

    const data = response?.data ?? response;
    if (!Array.isArray(data?.years)) return [];
    return data.years.map((period: string, index: number) => ({
        period,
        'P/E': toNumberOrNull(data.pe_ratio_data?.[index]),
        'P/B': toNumberOrNull(data.pb_ratio_data?.[index]),
    })).filter((row: ValuationHistoryRow) => row['P/E'] !== null || row['P/B'] !== null);
}

export default function ValuationHistoryChart({ symbol, lang }: { symbol: string; lang: 'vi' | 'en' }) {
    const [rows, setRows] = useState<ValuationHistoryRow[]>([]);

    useEffect(() => {
        const controller = new AbortController();
        fetch(`/api/stock/${symbol}/ratio-daily-history?limit=250`, { signal: controller.signal })
            .then((response) => response.ok ? response.json() : null)
            .then((response) => { if (response) setRows(toRows(response)); })
            .catch(() => undefined);
        return () => controller.abort();
    }, [symbol]);

    const latest = useMemo(
        () => [...rows].reverse().find((row) => row['P/E'] !== null || row['P/B'] !== null),
        [rows],
    );
    const text = lang === 'vi'
        ? { title: 'Lịch sử định giá', subtitle: 'Diễn biến P/E và P/B theo thời gian', pe: 'P/E hiện tại', pb: 'P/B hiện tại', empty: 'Chưa có dữ liệu định giá lịch sử.' }
        : { title: 'Valuation history', subtitle: 'P/E and P/B over time', pe: 'Current P/E', pb: 'Current P/B', empty: 'No valuation history is available.' };

    return (
        <Card className="overflow-hidden p-5 sm:p-6">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <Title>{text.title}</Title>
                    <Text>{text.subtitle}</Text>
                </div>
                {latest && (
                    <div className="flex gap-5 sm:gap-7">
                        <div className="text-right"><Text className="text-xs font-semibold uppercase">{text.pe}</Text><div className="mt-1 text-lg font-semibold text-blue-600">{latest['P/E']?.toFixed(2) ?? '—'}</div></div>
                        <div className="text-right"><Text className="text-xs font-semibold uppercase">{text.pb}</Text><div className="mt-1 text-lg font-semibold text-violet-600">{latest['P/B']?.toFixed(2) ?? '—'}</div></div>
                    </div>
                )}
            </div>
            {rows.length ? (
                <LineChart className="h-72" data={rows} index="period" categories={['P/E', 'P/B']} colors={['blue', 'violet']} valueFormatter={(value: number) => value.toFixed(2)} showAnimation={false} showLegend showTooltip autoMinValue yAxisWidth={40} />
            ) : <div className="flex h-40 items-center justify-center text-sm text-slate-500 dark:text-slate-400">{text.empty}</div>}
        </Card>
    );
}
