'use client';

import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartColors, chartAxisTick, chartCursor, chartTooltipClass } from '@/lib/chartTheme';
import { useLanguage } from '@/contexts/LanguageContext';
import { macroDate, type MacroPoint } from './macroData';

interface MacroSeriesChartProps {
    points: MacroPoint[];
    label: string;
    formatValue: (value: number) => string;
    formatAxis?: (value: number) => string;
    compact?: boolean;
}

export default function MacroSeriesChart({ points, label, formatValue, formatAxis = formatValue, compact = false }: MacroSeriesChartProps) {
    const { lang } = useLanguage();
    const data = useMemo(() => points.map(point => ({ ...point, time: Date.parse(`${point.date}T00:00:00Z`) })), [points]);
    if (!data.length) return null;
    const min = Math.min(...points.map(point => point.close));
    const max = Math.max(...points.map(point => point.close));
    const padding = (max - min || Math.abs(max) || 1) * 0.12;
    const span = data.at(-1)!.time - data[0].time;
    const dateTick = (time: number) => {
        const date = new Date(time).toISOString().slice(0, 10);
        if (span > 4 * 365.25 * 86400000) return date.slice(0, 4);
        if (span < 180 * 86400000) return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
        return `${date.slice(5, 7)}/${date.slice(2, 4)}`;
    };
    // Tick actual publication dates, with unique labels instead of repeated months/years.
    const tickDates = Array.from({ length: Math.min(data.length, compact ? 3 : 5) }, (_, index) =>
        data[Math.round(index * (data.length - 1) / Math.max(1, Math.min(data.length, compact ? 3 : 5) - 1))].time);
    const labels = new Set<string>();
    const ticks = tickDates.filter(time => {
        const label = dateTick(time);
        if (labels.has(label)) return false;
        labels.add(label);
        return true;
    });
    return <div className={compact ? 'h-36 w-full' : 'h-72 w-full sm:h-80'} aria-label={label}>
        <ResponsiveContainer width="100%" height="100%" debounce={80}>
            <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                {!compact && <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" />}
                <XAxis dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={ticks} tickFormatter={dateTick}
                    axisLine={false} tickLine={false} minTickGap={32} tick={chartAxisTick} tickMargin={10} height={32} />
                <YAxis hide={compact} domain={[min - padding, max + padding]} tickFormatter={formatAxis} axisLine={false} tickLine={false}
                    width={64} tick={chartAxisTick} tickCount={4} tickMargin={8} />
                {min < 0 && max > 0 && <ReferenceLine y={0} stroke="var(--chart-muted)" strokeDasharray="4 4" />}
                {!compact && <Tooltip cursor={chartCursor} content={({ active, payload }) => {
                    const point = payload?.[0]?.payload as MacroPoint | undefined;
                    return active && point ? <div className={chartTooltipClass}>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">{macroDate(point.date, lang)}</p>
                        <p className="mt-1 font-semibold tabular-nums">{formatValue(point.close)}</p>
                    </div> : null;
                }} />}
                <Line type="linear" dataKey="close" stroke={chartColors.primary} strokeWidth={2}
                    dot={data.length === 1 ? { r: 4, fill: chartColors.primary } : false}
                    activeDot={compact ? false : { r: 4, stroke: 'var(--chart-surface)', strokeWidth: 2 }} isAnimationActive={false} />
            </LineChart>
        </ResponsiveContainer>
    </div>;
}
