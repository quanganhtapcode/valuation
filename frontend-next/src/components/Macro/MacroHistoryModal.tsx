'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogPanel } from '@tremor/react';
import { RiArrowDownSLine, RiCloseLine, RiDownloadLine } from '@remixicon/react';
import { API } from '@/lib/api';
import { useLanguage } from '@/lib/languageContext';
import Pagination from '@/components/Pagination';
import MacroSeriesChart from './MacroSeriesChart';
import { macroDate, normalizeMacroPoints, type MacroPoint } from './macroData';

export interface MacroSeries {
    symbol: string;
    title: string;
    unit: string;
    source: string;
    formatValue: (value: number) => string;
    formatAxis?: (value: number) => string;
    // Express raw observations in the unit shown in the table and CSV.
    valueScale?: number;
    bar?: boolean;
    defaultDays?: number;
}

const COPY = {
    vi: { detail: 'Lịch sử dữ liệu', chart: 'Biểu đồ', table: 'Bảng dữ liệu', range: 'Khoảng thời gian', all: 'Tất cả', csv: 'Tải CSV', date: 'Thời gian', value: 'Giá trị', change: 'Thay đổi so với kỳ trước', loading: 'Đang tải dữ liệu…', empty: 'Không có dữ liệu trong khoảng thời gian này.', failed: 'Không tải được dữ liệu. Vui lòng thử lại.', retry: 'Thử lại', latest: 'Giá trị cuối kỳ', lowest: 'Thấp nhất', highest: 'Cao nhất', points: 'mốc dữ liệu', source: 'Nguồn', close: 'Đóng', year: 'năm', available: 'Dữ liệu hiện có' },
    en: { detail: 'Data history', chart: 'Chart', table: 'Data table', range: 'Time range', all: 'All', csv: 'Download CSV', date: 'Date', value: 'Value', change: 'Change vs. previous observation', loading: 'Loading data…', empty: 'No data in this date range.', failed: 'Unable to load data. Please try again.', retry: 'Retry', latest: 'Last value', lowest: 'Lowest', highest: 'Highest', points: 'observations', source: 'Source', close: 'Close', year: 'years', available: 'Available data' },
};
const RANGES = [365, 1095, 1825, 0];
const PAGE_SIZE = 25;

function rangeStart(end: string, days: number) {
    const date = new Date(`${end}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
}

function csvCell(value: string | number) { return `"${String(value).replaceAll('"', '""')}"`; }

export default function MacroHistoryModal({ series, onClose }: { series: MacroSeries; onClose: () => void }) {
    const { lang } = useLanguage();
    const c = COPY[lang];
    const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
    function close() {
        onClose();
        requestAnimationFrame(() => { if (opener?.isConnected) opener.focus({ preventScroll: true }); });
    }
    const [points, setPoints] = useState<MacroPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [range, setRange] = useState((series.defaultDays ?? 1825) <= 365 ? 365 : 1825);
    const [view, setView] = useState<'chart' | 'table'>('chart');
    const [page, setPage] = useState(1);

    useEffect(() => {
        const controller = new AbortController();
        async function load() {
            try {
                const response = await fetch(API.MACRO_HISTORY_FULL(series.symbol), { signal: controller.signal });
                if (!response.ok) throw new Error('History request failed');
                const data: unknown = await response.json();
                if (!Array.isArray(data)) throw new Error('Invalid history response');
                const history = normalizeMacroPoints(data.filter((point): point is MacroPoint =>
                    point !== null && typeof point === 'object' && typeof point.date === 'string' && typeof point.close === 'number'));
                if (controller.signal.aborted) return;
                setPoints(history);
                setLoading(false);
            } catch {
                if (!controller.signal.aborted) { setError(true); setLoading(false); }
            }
        }
        load();
        return () => controller.abort();
    }, [series.symbol, attempt]);

    const filtered = useMemo(() => {
        const end = points.at(-1)?.date;
        if (!end || range === 0) return points;
        const from = rangeStart(end, range);
        return points.filter(point => point.date >= from);
    }, [points, range]);
    const rows = useMemo(() => filtered.map((point, index) => ({ ...point, change: index ? point.close - filtered[index - 1].close : null })).reverse(), [filtered]);
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    const stats = useMemo(() => {
        if (!filtered.length) return [];
        let low = Infinity;
        let high = -Infinity;
        for (const point of filtered) { low = Math.min(low, point.close); high = Math.max(high, point.close); }
        return [{ label: c.latest, value: filtered.at(-1)!.close }, { label: c.lowest, value: low }, { label: c.highest, value: high }];
    }, [filtered, c]);

    function selectRange(days: number) {
        setRange(days);
        setPage(1);
    }

    function download() {
        const header = [c.date, c.value, lang === 'vi' ? 'Đơn vị' : 'Unit', lang === 'vi' ? 'Chỉ tiêu' : 'Indicator', c.source];
        const csv = '\uFEFF' + [header.map(csvCell).join(','), ...filtered.map(point =>
            [point.date, point.close / (series.valueScale ?? 1), series.unit, series.title, series.source].map(csvCell).join(','))].join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
        const link = document.createElement('a');
        link.href = url; link.download = `${series.symbol.replace(/[^a-zA-Z0-9_-]/g, '_')}_${filtered[0].date}_${filtered.at(-1)!.date}.csv`;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    return <Dialog open onClose={close} className="fixed inset-0 z-[100]" aria-label={series.title}>
        <DialogPanel className="w-full max-w-5xl overflow-hidden rounded-2xl bg-white p-0 text-slate-900 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-800">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-4 dark:border-slate-800 sm:px-6">
                <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">{c.detail}</p><h2 id="macro-history-title" className="mt-1 text-lg font-bold sm:text-xl">{series.title}</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{series.unit}</p></div>
                <button type="button" onClick={close} aria-label={c.close} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-slate-800"><RiCloseLine className="h-5 w-5" /></button>
            </div>
            <div className="max-h-[75dvh] space-y-4 sm:space-y-5 overflow-y-auto p-4 sm:p-6">
                <div className="flex items-center gap-2 sm:gap-3">
                    <label className="relative min-w-0 flex-1 sm:max-w-56">
                        <span className="sr-only">{c.range}</span>
                        <select value={range} onChange={event => selectRange(Number(event.target.value))} disabled={loading || error || !points.length}
                            className="h-10 w-full min-w-0 appearance-none rounded-lg border border-slate-200 bg-slate-50 py-2 pl-3 pr-8 text-sm font-medium text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                            {RANGES.map(days => <option key={days} value={days}>{days === 0 ? c.all : lang === 'en' && days === 365 ? '1 year' : `${days / 365} ${c.year}`}</option>)}
                        </select>
                        <RiArrowDownSLine aria-hidden="true" className="pointer-events-none absolute right-2 top-3 h-4 w-4 text-slate-400" />
                    </label>
                    <button type="button" onClick={download} disabled={loading || error || !filtered.length} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 sm:px-4"><RiDownloadLine className="h-4 w-4" />{c.csv}</button>
                </div>
                {loading ? <div role="status" className="flex h-72 items-center justify-center text-sm text-slate-500"><span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-600" />{c.loading}</div>
                    : error ? <div role="alert" className="py-12 text-center"><p className="text-sm text-rose-600 dark:text-rose-400">{c.failed}</p><button type="button" onClick={() => { setLoading(true); setError(false); setAttempt(value => value + 1); }} className="mt-3 rounded-lg border border-slate-200 px-4 py-2 text-sm dark:border-slate-700">{c.retry}</button></div>
                    : <>
                        {stats.length > 0 && <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-4">{stats.map((stat, index) => <div key={stat.label} className={`items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-950 sm:block sm:p-4 ${index === 0 ? 'flex' : 'hidden'}`}><p className="text-xs text-slate-500 dark:text-slate-400">{stat.label}</p><p className="break-words text-lg font-semibold tabular-nums sm:mt-1">{series.formatValue(stat.value)}</p></div>)}</div>}
                        <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800"><div className="flex" role="tablist" aria-label={c.detail}>{(['chart', 'table'] as const).map(tab => <button key={tab} id={`macro-${tab}-tab`} type="button" role="tab" aria-selected={view === tab} aria-controls="macro-history-content" tabIndex={view === tab ? 0 : -1} onKeyDown={event => {
                            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                                event.preventDefault();
                                const next = event.key === 'Home' ? 'chart' : event.key === 'End' ? 'table' : tab === 'chart' ? 'table' : 'chart';
                                setView(next);
                                document.getElementById(`macro-${next}-tab`)?.focus();
                            }
                        }} onClick={() => setView(tab)} className={`border-b-2 px-3 py-3 text-sm font-semibold ${view === tab ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400' : 'border-transparent text-slate-500 dark:text-slate-400'}`}>{c[tab]}</button>)}</div><span className="text-xs tabular-nums text-slate-400">{filtered.length} {c.points}</span></div>
                        <div id="macro-history-content" role="tabpanel" aria-labelledby={`macro-${view}-tab`}>
                            {!filtered.length ? <div className="flex h-64 items-center justify-center text-center text-sm text-slate-500 dark:text-slate-400">{c.empty}</div>
                                : view === 'chart' ? <MacroSeriesChart points={filtered} label={series.title} formatValue={series.formatValue} formatAxis={series.formatAxis} bar={series.bar} />
                                    : <div className="space-y-4"><div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-950 dark:text-slate-400"><tr><th className="px-3 py-3 text-left">{c.date}</th><th className="px-3 py-3 text-right">{c.value} ({series.unit})</th><th className="px-3 py-3 text-right">{c.change}</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(point => <tr key={point.date}><td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-500 dark:text-slate-400">{macroDate(point.date, lang)}</td><td className="px-3 py-3 text-right font-medium tabular-nums">{series.formatValue(point.close)}</td><td className="px-3 py-3 text-right tabular-nums text-slate-500 dark:text-slate-400">{point.change === null ? '—' : `${point.change > 0 ? '+' : ''}${series.formatValue(point.change)}`}</td></tr>)}</tbody></table></div><Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} /></div>}
                        </div>
                        <div className="border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500 dark:border-slate-800 dark:text-slate-400"><p>{c.source}: {series.source}</p>{points.length > 0 && <p>{c.available}: {macroDate(points[0].date, lang)} – {macroDate(points.at(-1)!.date, lang)}</p>}</div>
                    </>}
            </div>
        </DialogPanel>
    </Dialog>;
}
