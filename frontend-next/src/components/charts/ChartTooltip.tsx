'use client';

import type { ComponentProps } from 'react';
import type { LineChart } from '@tremor/react';
import { chartTooltipClass } from '@/lib/chartTheme';

type TooltipProps = ComponentProps<NonNullable<ComponentProps<typeof LineChart>['customTooltip']>>;

export default function ChartTooltip({ active, payload, label, valueFormatter }: TooltipProps & { valueFormatter: (value: number) => string }) {
    if (!active || !payload?.length) return null;
    return <div className={chartTooltipClass}>
        <p className="mb-1 text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
        {payload.map((entry, index) => <div key={`${entry.dataKey}:${index}`} className="flex items-center justify-between gap-4 py-0.5">
            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />{entry.name}</span>
            <span className="font-semibold tabular-nums">{entry.value == null ? '—' : valueFormatter(Number(entry.value))}</span>
        </div>)}
    </div>;
}
