/** Shared chart semantics. Neutral colors are defined in globals.css. */
export const chartColors = {
    primary: '#059669', secondary: '#2563eb', tertiary: '#7c3aed',
    positive: '#059669', negative: '#e11d48', warning: '#d97706',
};
export const chartSeriesColors = [chartColors.primary, chartColors.secondary, chartColors.tertiary, chartColors.negative, chartColors.warning, '#0891b2', '#db2777', '#64748b'];
export const chartAxisTick = { fontSize: 11, fill: 'var(--chart-muted)' };
export const chartTooltipClass = 'chart-tooltip rounded-lg border px-3 py-2 text-xs shadow-lg';
export const chartTooltipStyle = {
    background: 'var(--chart-surface)', color: 'var(--chart-text)',
    border: '1px solid var(--chart-border)', borderRadius: 8,
    fontSize: 12, fontFamily: 'var(--font-family-base)',
    boxShadow: '0 4px 12px rgb(0 0 0 / 0.12)',
};
export const chartCursor = { stroke: 'var(--chart-muted)', strokeDasharray: '4 4', fill: 'var(--chart-hover)' };

export function getChartTheme(isDark: boolean) {
    const css = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => css?.getPropertyValue(`--chart-${name}`).trim() || fallback;
    return {
        isDark,
        text: token('muted', isDark ? '#94a3b8' : '#64748b'),
        border: token('border', isDark ? '#334155' : '#e2e8f0'),
        gridLine: token('grid', isDark ? '#1e293b' : '#e2e8f0'),
        crosshair: token('muted', isDark ? '#94a3b8' : '#64748b'),
        tooltipBg: token('surface', isDark ? '#0f172a' : '#ffffff'),
        tooltipBorder: token('border', isDark ? '#334155' : '#e2e8f0'),
        tooltipText: token('text', isDark ? '#e2e8f0' : '#0f172a'),
        tooltipMuted: token('muted', isDark ? '#94a3b8' : '#64748b'),
    };
}
