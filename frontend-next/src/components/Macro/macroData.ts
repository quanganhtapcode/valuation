export interface MacroPoint {
    date: string;
    close: number;
}

export function normalizeMacroPoints(points: MacroPoint[]): MacroPoint[] {
    const byDate = new Map<string, MacroPoint>();
    for (const point of points) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(Date.parse(point.date)) && Number.isFinite(point.close)) {
            byDate.set(point.date, point);
        }
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function macroDate(date: string, lang: 'vi' | 'en') {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', { timeZone: 'UTC' });
}
