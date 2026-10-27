'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import StockLink from '@/components/StockLink';
import { API } from '@/lib/api';
import { siteConfig } from '@/config/siteConfig';
import { useI18n } from '@/contexts/LanguageContext';
import { translations } from '@/lib/translations';
import { localizedPath } from '@/lib/localePath';
import { calendarWeek, shiftCalendarDate, summarizeEventDay } from '@/lib/eventCalendar';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EventItem {
    id: string;
    ticker: string;
    organNameVi: string;
    eventNameVi: string;
    eventNameEn?: string;
    eventTitleVi: string;
    displayDate1: string | null;
    displayDate2: string | null;
    exrightDate: string | null;
    recordDate: string | null;
    publicDate: string | null;
    category: 'DIVIDEND' | 'SHAREHOLDER_MEETING' | 'MAJOR_SHAREHOLDER_TRADING' | 'OTHER';
}

type Category = 'ALL' | EventItem['category'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function toInputValue(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
}

function fromInputValue(s: string): string {
    return s.replace(/-/g, ''); // → YYYYMMDD
}

function fmtDate(iso: string | null, locale: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ── Category config ───────────────────────────────────────────────────────────

const CATEGORIES = [
    { id: 'ALL',                    label: 'all', color: 'text-slate-700 dark:text-slate-200', bg: 'bg-slate-100 dark:bg-slate-700' },
    { id: 'DIVIDEND',               label: 'dividend', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-900/30' },
    { id: 'SHAREHOLDER_MEETING',    label: 'meeting', color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-900/30' },
    { id: 'MAJOR_SHAREHOLDER_TRADING', label: 'insider', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-900/30' },
    { id: 'OTHER',                  label: 'other', color: 'text-slate-600 dark:text-slate-300', bg: 'bg-slate-50 dark:bg-slate-800' },
] as const;

function catConfig(cat: EventItem['category']) {
    return CATEGORIES.find(c => c.id === cat) ?? CATEGORIES[0];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CategoryBadge({ cat, lang }: { cat: EventItem['category']; lang: 'vi' | 'en' }) {
    const cfg = catConfig(cat);
    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.color} ${cfg.bg}`}>
            {translations[lang].pages.events.categories[cfg.label]}
        </span>
    );
}

function SkeletonRow() {
    return (
        <tr className="border-b border-slate-100 dark:border-slate-800">
            {[48, 200, 100, 100, 100, 100].map((w, i) => (
                <td key={i} className="px-4 py-3">
                    <div className={`h-4 rounded animate-pulse bg-slate-100 dark:bg-slate-800`} style={{ width: w }} />
                </td>
            ))}
        </tr>
    );
}

function StockLogo({ ticker }: { ticker: string }) {
    const [err, setErr] = useState(false);
    if (err) return (
        <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[9px] font-bold text-slate-500">
            {ticker.slice(0, 2)}
        </div>
    );
    return (
        <Image src={siteConfig.stockLogoUrl(ticker)} alt={ticker}
            width={28} height={28}
            className="w-7 h-7 rounded-md object-contain bg-white border border-slate-100 dark:border-slate-700 p-0.5"
            unoptimized
            onError={() => setErr(true)} />
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function EventsPage() {
    const { lang, locale } = useI18n();
    const copy = translations[lang].pages.events;
    const today = new Date();
    const [dateInput, setDateInput] = useState(toInputValue(today));
    const [category, setCategory]   = useState<Category>('ALL');
    const [weekData, setWeekData]   = useState<{ start: string; events: EventItem[] }>({ start: '', events: [] });
    const [fetching, setFetching]   = useState(true);
    const [error, setError]         = useState(false);
    const [retry, setRetry]         = useState(0);

    const dateYYYYMMDD = fromInputValue(dateInput); // e.g. "20260328"
    const week = calendarWeek(dateInput);
    const weekStart = week[0];
    const weekEnd = week[6];
    const loading = fetching || weekData.start !== weekStart;
    const days = week.map(date => ({ date, ...summarizeEventDay(weekData.events, date, lang) }));
    const events = days.find(day => day.date === dateInput)?.events ?? [];
    const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

    useEffect(() => {
        const controller = new AbortController();
        const load = async () => {
            setFetching(true);
            setError(false);
            try {
                const res = await fetch(API.MARKET_EVENTS_RANGE(fromInputValue(weekStart), fromInputValue(weekEnd)), { signal: controller.signal });
                if (!res.ok) throw new Error('fetch failed');
                const data: unknown = await res.json();
                if (!Array.isArray(data)) throw new Error('invalid events response');
                if (!controller.signal.aborted) setWeekData({ start: weekStart, events: data });
            } catch {
                if (!controller.signal.aborted) {
                    setError(true);
                    setWeekData({ start: weekStart, events: [] });
                }
            } finally {
                if (!controller.signal.aborted) setFetching(false);
            }
        };
        void load();
        return () => controller.abort();
    }, [weekStart, weekEnd, retry]);

    // ── Filtered list ──────────────────────────────────────────────────────
    const filtered = category === 'ALL' ? events : events.filter(e => e.category === category);

    // ── Counts per tab ─────────────────────────────────────────────────────
    const counts: Record<string, number> = { ALL: events.length };
    events.forEach(e => { counts[e.category] = (counts[e.category] ?? 0) + 1; });

    // ── Excel download ────────────────────────────────────────────────────
    const handleExport = () => {
        window.location.href = API.MARKET_EVENTS_EXPORT(dateYYYYMMDD, dateYYYYMMDD);
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
            <div className="max-w-[1600px] mx-auto p-4 md:p-6">

                {/* Header */}
                <div className="mb-6">
                    <h1 className="text-3xl md:text-4xl font-bold leading-tight tracking-tight">
                        {copy.title} <span className="text-blue-600 dark:text-blue-400">{copy.accent}</span>
                    </h1>
                    <div className="w-24 h-1 bg-blue-500 rounded mt-2" />
                    <p className="text-slate-600 dark:text-slate-300 mt-3 text-sm max-w-2xl">
                        {copy.subtitle}
                    </p>
                </div>

                {/* Controls */}
                <div className="mb-5 flex flex-wrap items-center gap-2 sm:gap-3">
                    <button type="button" onClick={() => setDateInput(toInputValue(new Date()))}
                        className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700">
                        {copy.today}
                    </button>
                    <button type="button" aria-label={copy.previousWeek} onClick={() => setDateInput(shiftCalendarDate(dateInput, -7))}
                        className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">‹</button>
                    <span className="text-sm font-bold tabular-nums sm:text-base">{shortDate(weekStart)}{weekStart.slice(0, 4) !== weekEnd.slice(0, 4) ? `/${weekStart.slice(0, 4)}` : ''} – {shortDate(weekEnd)}/{weekEnd.slice(0, 4)}</span>
                    <button type="button" aria-label={copy.nextWeek} onClick={() => setDateInput(shiftCalendarDate(dateInput, 7))}
                        className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">›</button>
                    <input
                        type="date"
                        aria-label={copy.chooseDate}
                        value={dateInput}
                        onChange={e => { if (e.target.value) setDateInput(e.target.value); }}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        {copy.download}
                    </button>
                    <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">
                        {!loading && `${events.length} ${copy.count}`}
                    </span>
                </div>

                <div className="mb-6 grid grid-cols-7 gap-1 sm:grid-cols-[repeat(7,minmax(170px,1fr))] sm:gap-3 sm:overflow-x-auto sm:pb-2" aria-label={`${copy.title} ${copy.accent}`}>
                    {days.map(day => (
                        <button type="button" key={day.date} aria-pressed={dateInput === day.date}
                            onClick={() => setDateInput(day.date)}
                            className={`flex min-w-0 flex-col items-center rounded-lg border px-0.5 py-2 text-center transition-colors sm:min-h-36 sm:items-stretch sm:p-4 sm:text-left focus-visible:outline-2 focus-visible:outline-blue-500 ${dateInput === day.date
                                ? 'border-blue-400 bg-blue-50 dark:border-slate-500 dark:bg-slate-700'
                                : 'border-slate-200 bg-white hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800'}`}>
                            <span className={`inline-block pb-1 text-xs font-bold tabular-nums sm:mb-2 sm:self-start sm:text-base ${dateInput === day.date ? 'border-b-2 border-emerald-500' : 'border-b-2 border-transparent'}`}>{shortDate(day.date)}</span>
                            <span className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 sm:hidden">{loading ? "…" : error ? "—" : day.events.length}</span>
                            <div className="hidden sm:block">
                            {loading ? <div className="h-14 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                                : error ? <p className="text-xs text-slate-500 dark:text-slate-400">{copy.failed}</p>
                                : day.events.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">{copy.empty}</p>
                                : <div className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
                                    {day.groups.map(group => <div key={group.label} className="flex items-center gap-3">
                                        <span className="min-w-0 flex-1 truncate" title={group.label}>{group.label}</span>
                                        <span className="tabular-nums">{group.count}</span>
                                    </div>)}
                                    {day.other > 0 && <div className="flex justify-between gap-3"><span>{copy.categories.other}</span><span className="tabular-nums">{day.other}</span></div>}
                                </div>}
                            </div>
                        </button>
                    ))}
                </div>

                {/* Category tabs */}
                <div className="mb-4 flex overflow-x-auto border-b border-slate-200 dark:border-slate-800">
                    {CATEGORIES.map(cat => (
                        <button
                            key={cat.id}
                            type="button"
                            aria-pressed={category === cat.id}
                            onClick={() => setCategory(cat.id)}
                            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-semibold sm:px-5 sm:text-base transition-colors ${
                                category === cat.id
                                    ? 'border-blue-600 text-blue-700 dark:text-blue-400'
                                    : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                            }`}
                        >
                            {copy.categories[cat.label]}
                            {counts[cat.id] !== undefined && (
                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                                    category === cat.id ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                                }`}>
                                    {counts[cat.id]}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Mobile event cards */}
                <div className="space-y-3 sm:hidden">
                    {loading ? (
                        Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />)
                    ) : error ? (
                        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                            {copy.failed} <button type="button" onClick={() => setRetry(value => value + 1)} className="font-semibold text-blue-600 dark:text-blue-400">{copy.retry}</button>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                            {copy.empty} {category !== 'ALL' ? `"${copy.categories[catConfig(category as EventItem['category']).label]}"` : ''} {copy.emptySuffix}
                        </div>
                    ) : filtered.map(event => (
                        <article key={event.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                            <div className="flex items-center justify-between gap-3">
                                <StockLink symbol={event.ticker} href={localizedPath(`/stock/${event.ticker}`, lang)} className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
                                    <StockLogo ticker={event.ticker} /> {event.ticker}
                                </StockLink>
                                <CategoryBadge cat={event.category} lang={lang} />
                            </div>
                            <p className="mt-3 text-sm font-semibold leading-snug text-slate-800 dark:text-slate-200">{event.eventTitleVi}</p>
                            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{event.organNameVi}</p>
                            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                                {event.exrightDate && <span>{copy.exDate}: <span className="font-medium tabular-nums text-slate-700 dark:text-slate-300">{fmtDate(event.exrightDate, locale)}</span></span>}
                                {event.displayDate1 && <span>{copy.date}: <span className="font-medium tabular-nums text-slate-700 dark:text-slate-300">{fmtDate(event.displayDate1, locale)}</span></span>}
                                {event.publicDate && <span>{copy.announced}: <span className="font-medium tabular-nums text-slate-700 dark:text-slate-300">{fmtDate(event.publicDate, locale)}</span></span>}
                            </div>
                        </article>
                    ))}
                </div>

                {/* Table */}
                <div className="hidden sm:block rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide w-28">{copy.ticker}</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{copy.event}</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide w-32 hidden sm:table-cell">{copy.type}</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide w-32 hidden md:table-cell">{copy.exDate}</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide w-32 hidden lg:table-cell">{copy.date}</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide w-36">{copy.announced}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                                ) : error ? (
                                    <tr>
                                        <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                                            {copy.failed}
                                            <button type="button" onClick={() => setRetry(value => value + 1)} className="ml-3 font-semibold text-blue-600 dark:text-blue-400">{copy.retry}</button>
                                        </td>
                                    </tr>
                                ) : filtered.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                                            {copy.empty} {category !== 'ALL' ? `"${copy.categories[catConfig(category as EventItem['category']).label]}"` : ''} {copy.emptySuffix}
                                        </td>
                                    </tr>
                                ) : (
                                    filtered.map(event => (
                                        <tr key={event.id}
                                            className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                            {/* Ticker */}
                                            <td className="px-4 py-3">
                                                <StockLink symbol={event.ticker} href={localizedPath(`/stock/${event.ticker}`, lang)}
                                                    className="flex items-center gap-2 group w-fit">
                                                    <StockLogo ticker={event.ticker} />
                                                    <span className="font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                                        {event.ticker}
                                                    </span>
                                                </StockLink>
                                            </td>
                                            {/* Event description */}
                                            <td className="px-4 py-3">
                                                <p className="font-medium text-slate-800 dark:text-slate-200 leading-snug">
                                                    {event.eventTitleVi}
                                                </p>
                                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate max-w-[360px]">
                                                    {event.organNameVi}
                                                </p>
                                                {/* Show category badge inline on mobile */}
                                                <span className="sm:hidden mt-1 inline-block">
                                                    <CategoryBadge cat={event.category} lang={lang} />
                                                </span>
                                            </td>
                                            {/* Category */}
                                            <td className="px-4 py-3 hidden sm:table-cell">
                                                <CategoryBadge cat={event.category} lang={lang} />
                                            </td>
                                            {/* Ex-right date */}
                                            <td className="px-4 py-3 text-slate-500 dark:text-slate-400 tabular-nums hidden md:table-cell">
                                                {fmtDate(event.exrightDate, locale)}
                                            </td>
                                            {/* Exercise/display date */}
                                            <td className="px-4 py-3 text-slate-500 dark:text-slate-400 tabular-nums hidden lg:table-cell">
                                                {fmtDate(event.displayDate1, locale)}
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap text-slate-500 dark:text-slate-400 tabular-nums">
                                                {fmtDate(event.publicDate, locale)}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Footer note */}
                {!loading && events.length > 0 && (
                    <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                        {copy.source}
                    </p>
                )}
            </div>
        </div>
    );
}
