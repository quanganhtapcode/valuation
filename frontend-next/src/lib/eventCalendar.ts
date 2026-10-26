/** Calendar arithmetic uses UTC so the visitor's timezone cannot shift a date. */
export function shiftCalendarDate(date: string, days: number): string {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}

export function calendarWeek(date: string): string[] {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const monday = shiftCalendarDate(date, -((weekday + 6) % 7));
    return Array.from({ length: 7 }, (_, index) => shiftCalendarDate(monday, index));
}

export function summarizeEventDay<T extends { displayDate1: string | null; displayDate2?: string | null; eventNameVi: string; eventNameEn?: string }>(
    events: T[], date: string, lang: 'vi' | 'en',
): { events: T[]; groups: { label: string; count: number }[]; other: number } {
    // Vietcap includes both the execution/start date and its secondary calendar
    // date (e.g. the ex-right date of a meeting) in daily event queries.
    const dayEvents = events.filter(event => event.displayDate1?.slice(0, 10) === date
        || event.displayDate2?.slice(0, 10) === date);
    const counts = new Map<string, number>();
    for (const event of dayEvents) {
        const label = (lang === 'en' ? event.eventNameEn : event.eventNameVi) || event.eventNameVi;
        if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const groups = Array.from(counts, ([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count).slice(0, 2);
    return { events: dayEvents, groups, other: dayEvents.length - groups.reduce((sum, group) => sum + group.count, 0) };
}
