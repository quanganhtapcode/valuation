'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '@/lib/languageContext';
import { fundDetailCopy } from '@/lib/fundDetailCopy';
import type { FundDetail } from '@/lib/fundsApi';

export default function FundDetailClient({ detail }: { detail: FundDetail }) {
    const { lang } = useLanguage();
    const t = fundDetailCopy[lang];
    const locale = { vi: 'vi-VN', en: 'en-US' }[lang];
    const [range, setRange] = useState('3');
    const [year, setYear] = useState('');
    const fund = detail.fund;
    const format = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
    const points = useMemo(() => {
        if (year) return detail.history.filter(point => point.date.startsWith(year));
        if (range === 'all' || !detail.history.length) return detail.history;
        const end = new Date(`${detail.history[detail.history.length - 1].date}T00:00:00Z`);
        end.setUTCFullYear(end.getUTCFullYear() - Number(range));
        const start = end.toISOString().slice(0, 10);
        return detail.history.filter(point => point.date >= start);
    }, [detail.history, year, range]);
    const periods = [{ key: '1', label: t.one }, { key: '3', label: t.three }, { key: '5', label: t.five }, { key: 'all', label: t.all }];
    return <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="mx-auto max-w-[1600px] space-y-6 p-4 md:p-6">
            <header className="mb-5">
                <Link href={`/${lang}/funds`} className="text-sm text-slate-500 hover:text-emerald-600">← {t.back}</Link>
                <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight md:text-4xl">{fund.short_name} <span className="text-emerald-600 dark:text-emerald-400">{t.history}</span></h1>
                <div className="mt-2 h-1 w-32 rounded bg-emerald-500" />
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 md:text-base">{fund.name}</p>
            </header>
            <dl className="grid gap-x-8 gap-y-4 border-y border-slate-200 py-5 sm:grid-cols-2 lg:grid-cols-3 dark:border-slate-800">
                {[{ label: t.nav, value: `${format(fund.nav)} VNĐ/CCQ · ${fund.nav_update_at}` },
                    { label: t.fee, value: fund.management_fee == null ? t.unavailable : `${format(fund.management_fee)}${t.perYear}` },
                    { label: t.inception, value: fund.inception_date || t.unavailable },
                    { label: t.owner, value: fund.fund_owner_name }, { label: t.type, value: fund.fund_type }].map(item =>
                    <div key={item.label}><dt className="text-xs text-slate-500">{item.label}</dt><dd className="mt-1 text-sm font-semibold">{item.value}</dd></div>)}
            </dl>
            <section aria-labelledby="nav-history-title">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h2 id="nav-history-title" className="text-lg font-bold">{t.history}</h2>
                    <div className="flex flex-wrap items-center gap-2">
                        {periods.map(period => <button key={period.key} aria-pressed={!year && range === period.key} onClick={() => { setYear(''); setRange(period.key); }} className={`rounded-full border px-3 py-1.5 text-sm font-medium ${!year && range === period.key ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' : 'border-slate-200 dark:border-slate-700'}`}>{period.label}</button>)}
                        <select aria-label={t.year} value={year} onChange={event => setYear(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"><option value="">{t.year}</option>{detail.yearly_returns.map(row => <option key={row.year} value={row.year}>{row.year}</option>)}</select>
                    </div>
                </div>
                {detail.history_stale && <p role="status" className="mb-3 text-sm text-amber-600">{detail.history_available ? t.stale : t.noHistory}</p>}
                {points.length > 1 ? <div className="h-[340px] rounded-lg border border-slate-200 bg-white p-3 sm:h-[420px] dark:border-slate-800 dark:bg-slate-900">
                    <ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{ top: 20, right: 16, left: 5, bottom: 12 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.15} />
                        <XAxis dataKey="date" minTickGap={60} tick={{ fontSize: 11 }} tickFormatter={value => String(value).slice(0, 7)} />
                        <YAxis width={75} domain={['auto', 'auto']} tick={{ fontSize: 11 }} tickFormatter={value => format(Number(value))} />
                        <Tooltip content={({ active, payload, label }) => active && payload?.length ? <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-md dark:border-slate-700 dark:bg-slate-900"><p className="text-slate-500">{label}</p><p className="mt-1 font-semibold text-emerald-600">NAV: {format(Number(payload[0].value))} VNĐ/CCQ</p></div> : null} />
                        <Line type="monotone" dataKey="nav" stroke="#059669" strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart></ResponsiveContainer>
                </div> : <p className="py-12 text-center text-sm text-slate-500">{t.noHistory}</p>}
                {points.length > 0 && <p className="mt-2 text-xs text-slate-500">{points[0].date} — {points[points.length - 1].date} · {t.source}</p>}
                {detail.conflicting_dates > 0 && <p className="mt-2 text-xs text-slate-500">{t.conflicts}</p>}
            </section>
            <section aria-labelledby="annual-nav-title">
                <h2 id="annual-nav-title" className="mb-4 text-lg font-bold">{t.annual}</h2>
                <div className="overflow-x-auto border-y border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><table className="w-full min-w-[650px] text-sm">
                    <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800"><tr>{[t.year, t.first, t.last, t.change, t.period].map(label => <th key={label} className="px-4 py-3 text-left font-medium">{label}</th>)}</tr></thead>
                    <tbody>{detail.yearly_returns.map(row => <tr key={row.year} className="border-b border-slate-100 dark:border-slate-800/60">
                        <td className="px-4 py-3 font-semibold">{row.year}{row.ytd && <span className="ml-2 text-xs font-normal text-slate-500">{t.ytd}</span>}</td>
                        <td className="px-4 py-3 tabular-nums">{format(row.start_nav)}</td><td className="px-4 py-3 tabular-nums">{format(row.end_nav)}</td>
                        <td className={`px-4 py-3 font-semibold tabular-nums ${row.return_pct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{row.return_pct > 0 ? '+' : ''}{format(row.return_pct)}%</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{row.start_date} — {row.end_date}{row.partial && <p className="mt-1">{t.partial}</p>}</td>
                    </tr>)}</tbody>
                </table></div>
                <p className="mt-3 max-w-4xl text-xs leading-relaxed text-slate-500">{t.note}</p>
            </section>
        </div>
    </div>;
}
