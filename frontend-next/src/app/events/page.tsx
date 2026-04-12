'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { API } from '@/lib/api';
import { siteConfig } from '@/app/siteConfig';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EventItem {
    id: string;
    ticker: string;
    organNameVi: string;
    eventNameVi: string;
    eventTitleVi: string;
    displayDate1: string | null;
    exrightDate: string | null;
    recordDate: string | null;
    publicDate: string | null;
    category: 'DIVIDEND' | 'SHAREHOLDER_MEETING' | 'MAJOR_SHAREHOLDER_TRADING' | 'OTHER';
}

type Category = 'ALL' | EventItem['category'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function toInputValue(date: Date): string {
    return date.toISOString().slice(0, 10); // YYYY-MM-DD for input[type=date]
}

function fromInputValue(s: string): string {
    return s.replace(/-/g, ''); // → YYYYMMDD
}

function fmtDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// ── Category config ───────────────────────────────────────────────────────────

const CATEGORIES: { id: Category; label: string; color: string; bg: string }[] = [
    { id: 'ALL',                    label: 'Tất cả',          color: 'text-slate-700 dark:text-slate-200',   bg: 'bg-slate-100 dark:bg-slate-700' },
    { id: 'DIVIDEND',               label: 'Cổ tức',          color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-900/30' },
    { id: 'SHAREHOLDER_MEETING',    label: 'Đại hội CĐ',      color: 'text-blue-700 dark:text-blue-300',      bg: 'bg-blue-50 dark:bg-blue-900/30' },
    { id: 'MAJOR_SHAREHOLDER_TRADING', label: 'Giao dịch nội bộ', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-900/30' },
    { id: 'OTHER',                  label: 'Khác',            color: 'text-slate-600 dark:text-slate-300',    bg: 'bg-slate-50 dark:bg-slate-800' },
];

function catConfig(cat: EventItem['category']) {
    return CATEGORIES.find(c => c.id === cat) ?? CATEGORIES[0];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CategoryBadge({ cat }: { cat: EventItem['category'] }) {
    const cfg = catConfig(cat);
    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.color} ${cfg.bg}`}>
            {cfg.label}
        </span>
    );
}

function SkeletonRow() {
    return (
        <tr className="border-b border-slate-100 dark:border-slate-800">
            {[32, 48, 200, 120, 80].map((w, i) => (
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
    const today = new Date();
    const [dateInput, setDateInput] = useState(toInputValue(today));
    const [category, setCategory]   = useState<Category>('ALL');
    const [events, setEvents]       = useState<EventItem[]>([]);
    const [loading, setLoading]     = useState(true);
    const [error, setError]         = useState(false);

    const dateYYYYMMDD = fromInputValue(dateInput); // e.g. "20260328"

    const load = useCallback(async (date: string) => {
        setLoading(true);
        setError(false);
        try {
            const res = await fetch(API.MARKET_EVENTS(date));
            if (!res.ok) throw new Error('fetch failed');
            setEvents(await res.json());
        } catch {
            setError(true);
            setEvents([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(dateYYYYMMDD); }, [dateYYYYMMDD, load]);

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
            <div className="max-w-[1400px] mx-auto p-4 md:p-6">

                {/* Header */}
                <div className="mb-6">
                    <h1 className="text-3xl md:text-4xl font-bold leading-tight tracking-tight">
                        Lịch <span className="text-blue-600 dark:text-blue-400">Sự Kiện</span>
                    </h1>
                    <div className="w-24 h-1 bg-blue-500 rounded mt-2" />
                    <p className="text-slate-600 dark:text-slate-300 mt-3 text-sm max-w-2xl">
                        Sự kiện doanh nghiệp niêm yết: cổ tức, đại hội cổ đông, giao dịch nội bộ và các sự kiện khác.
                    </p>
                </div>

                {/* Controls */}
                <div className="flex flex-wrap items-center gap-3 mb-5">
                    <input
                        type="date"
                        value={dateInput}
                        onChange={e => setDateInput(e.target.value)}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="M12 15V3m0 12l-4-4m4 4l4-4M2 17l.621 2.485A2 2 0 004.561 21h14.878a2 2 0 001.94-1.515L22 17" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Tải Excel
                    </button>
                    <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">
                        {!loading && `${events.length} sự kiện`}
                    </span>
                </div>

                {/* Category tabs */}
                <div className="flex flex-wrap gap-2 mb-4">
                    {CATEGORIES.map(cat => (
                        <button
                            key={cat.id}
                            onClick={() => setCategory(cat.id)}
                            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors border ${
                                category === cat.id
                                    ? 'border-blue-500 bg-blue-600 text-white'
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-blue-400'
                            }`}
                        >
                            {cat.label}
                            {counts[cat.id] !== undefined && (
                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                                    category === cat.id ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                                }`}>
                                    {counts[cat.id]}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Table */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide w-28">Mã CP</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Sự kiện</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide w-32 hidden sm:table-cell">Loại</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide w-32 hidden md:table-cell">Ngày GD KHQ</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide w-32 hidden lg:table-cell">Ngày thực hiện</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                                ) : error ? (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                                            Không thể tải dữ liệu. Vui lòng thử lại.
                                        </td>
                                    </tr>
                                ) : filtered.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                                            Không có sự kiện {category !== 'ALL' ? `"${catConfig(category as EventItem['category']).label}"` : ''} trong ngày này.
                                        </td>
                                    </tr>
                                ) : (
                                    filtered.map(event => (
                                        <tr key={event.id}
                                            className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                            {/* Ticker */}
                                            <td className="px-4 py-3">
                                                <Link href={`/stock/${event.ticker}`}
                                                    className="flex items-center gap-2 group w-fit">
                                                    <StockLogo ticker={event.ticker} />
                                                    <span className="font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                                        {event.ticker}
                                                    </span>
                                                </Link>
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
                                                    <CategoryBadge cat={event.category} />
                                                </span>
                                            </td>
                                            {/* Category */}
                                            <td className="px-4 py-3 hidden sm:table-cell">
                                                <CategoryBadge cat={event.category} />
                                            </td>
                                            {/* Ex-right date */}
                                            <td className="px-4 py-3 text-slate-500 dark:text-slate-400 tabular-nums hidden md:table-cell">
                                                {fmtDate(event.exrightDate)}
                                            </td>
                                            {/* Exercise/display date */}
                                            <td className="px-4 py-3 text-slate-500 dark:text-slate-400 tabular-nums hidden lg:table-cell">
                                                {fmtDate(event.displayDate1)}
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
                        Nguồn: Vietcap IQ · Dữ liệu cập nhật mỗi 15 phút
                    </p>
                )}
            </div>
        </div>
    );
}
