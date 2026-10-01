'use client';

import { useId, useMemo } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '@/lib/languageContext';

import { macroDate, type MacroPoint } from './macroData';

interface MacroSeriesChartProps {
    points: MacroPoint[];
    label: string;
    formatValue: (value: number) => string;
    formatAxis?: (value: number) => string;
    bar?: boolean;
    compact?: boolean;
}

export default function MacroSeriesChart({ points, label, formatValue, formatAxis = formatValue, bar = false, compact = false }: MacroSeriesChartProps) {
    const { lang } = useLanguage();
    const gradientId = useId().replaceAll(':', '');
    const data = useMemo(() => points.map(point => ({ ...point, time: Date.parse(`${point.date}T00:00:00Z`) })), [points]);
    let min = Infinity;
    let max = -Infinity;
    for (const point of points) { min = Math.min(min, point.close); max = Math.max(max, point.close); }
    if (!points.length) return null;
    const padding = (max - min || Math.abs(max) || 1) * 0.12;
    const domain: [number, number] = bar ? [Math.min(0, min), Math.max(0, max) + padding] : [min - padding, max + padding];
    const dateTick = (time: number) => {
        const date = new Date(time).toISOString().slice(0, 10);
        return data.at(-1)!.time - data[0].time < 180 * 86400000
            ? `${date.slice(8, 10)}/${date.slice(5, 7)}`
            : `${date.slice(5, 7)}/${date.slice(2, 4)}`;
    };
    const color = bar ? '#3b82f6' : '#059669';
    const axes = <>
        {!compact && <CartesianGrid vertical={false} stroke="currentColor" strokeDasharray="3 4" className="text-slate-200 dark:text-slate-800" />}
        <XAxis dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={dateTick}
            axisLine={false} tickLine={false} minTickGap={compact ? 65 : 45} tick={{ fill: '#94a3b8', fontSize: 11 }} tickMargin={12} height={30} />
        <YAxis hide={compact} domain={domain} tickFormatter={formatAxis} axisLine={false} tickLine={false}
            width={72} tick={{ fill: '#94a3b8', fontSize: 11, className: '-translate-x-14 [text-anchor:start] sm:translate-x-0 sm:[text-anchor:end]' }} tickCount={5} />
        {min < 0 && max > 0 && <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />}
        {!compact && <Tooltip cursor={{ stroke: '#94a3b8', strokeDasharray: '4 4', fill: '#94a3b812' }} content={({ active, payload }) => {
            const point = payload?.[0]?.payload as MacroPoint | undefined;
            return active && point ? <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg dark:border-slate-700 dark:bg-slate-900 sm:px-4 sm:py-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">{macroDate(point.date, lang)}</p>
                <p className="mt-1 hidden text-xs font-medium text-slate-600 dark:text-slate-300 sm:block">{label}</p>
                <p className="mt-1 text-base font-semibold tabular-nums text-slate-900 dark:text-white">{formatValue(point.close)}</p>
            </div> : null;
        }} />}
    </>;

    return <div className={`${compact ? 'h-36 w-full' : 'h-72 w-full sm:h-80'} [&_.recharts-wrapper]:[outline:none] [&_.recharts-wrapper]:shadow-none [&_.recharts-surface]:[outline:none] [&_.recharts-surface]:shadow-none`} aria-label={label}>
        <ResponsiveContainer width="100%" height="100%" debounce={80}>
            {bar ? <BarChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: compact ? 8 : 0 }} barCategoryGap="28%">
                {axes}<Bar dataKey="close" fill={color} radius={[3, 3, 0, 0]} maxBarSize={compact ? 12 : 28} isAnimationActive={false} />
            </BarChart> : <AreaChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: compact ? 8 : 0 }}>
                <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.18} /><stop offset="100%" stopColor={color} stopOpacity={0.01} /></linearGradient></defs>
                {axes}<Area type="linear" dataKey="close" stroke={color} strokeWidth={2} fill={`url(#${gradientId})`}
                    dot={data.length === 1 ? { r: 4, fill: color } : false} activeDot={compact ? false : { r: 4, strokeWidth: 2 }} isAnimationActive={false} />
            </AreaChart>}
        </ResponsiveContainer>
    </div>;
}
