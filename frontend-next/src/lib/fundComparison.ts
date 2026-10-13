export type NavPoint = { date: string; nav: number };
export type ComparisonRange = 'ytd' | '1m' | '3m' | '6m' | '1y' | '3y' | '5y' | 'all';

// Compare over the shared history window, carrying the most recently published
// NAV between publication dates, without extending beyond any fund's history.
export function compareFundHistories(histories: Record<string, NavPoint[]>, range: ComparisonRange) {
    const series = Object.entries(histories).map(([symbol, points]) => ({ symbol,
        points: points.filter(p => Number.isFinite(p.nav) && p.nav > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.date)).sort((a, b) => a.date.localeCompare(b.date)),
    })).filter(s => s.points.length > 1);
    if (!series.length) return [];
    const end = series.map(s => s.points[s.points.length - 1].date).sort()[0];
    const cutoff = new Date(`${end}T00:00:00Z`);
    if (range === 'ytd') cutoff.setUTCMonth(0, 1);
    else if (range.endsWith('m')) {
        const day = cutoff.getUTCDate();
        cutoff.setUTCDate(1);
        cutoff.setUTCMonth(cutoff.getUTCMonth() - Number(range.slice(0, -1)));
        const lastDay = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
        cutoff.setUTCDate(Math.min(day, lastDay));
    }
    else if (range.endsWith('y')) cutoff.setUTCFullYear(cutoff.getUTCFullYear() - Number(range.slice(0, -1)));
    const start = [...series.map(s => s.points[0].date), ...(range === 'all' ? [] : [cutoff.toISOString().slice(0, 10)])].sort().at(-1)!;
    if (start >= end) return [];
    const dates = [...new Set([start, end, ...series.flatMap(s => s.points.map(p => p.date).filter(date => date >= start && date <= end))])].sort();
    const cursors = series.map(() => 0);
    const bases = series.map(s => s.points.filter(p => p.date <= start).at(-1)!.nav);
    return dates.map(date => {
        const row: Record<string, number> = { time: Date.parse(`${date}T00:00:00Z`) };
        series.forEach((s, index) => {
            while (cursors[index] + 1 < s.points.length && s.points[cursors[index] + 1].date <= date) cursors[index]++;
            row[s.symbol] = (s.points[cursors[index]].nav / bases[index] - 1) * 100;
        });
        return row;
    });
}
