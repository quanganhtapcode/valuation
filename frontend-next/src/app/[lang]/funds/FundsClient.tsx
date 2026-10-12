'use client';

import Link from 'next/link';
import { fundDetailCopy } from '@/lib/fundDetailCopy';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/lib/languageContext';
import { fundsCopy } from '@/lib/fundsCopy';
import { fetchFundPrices, type FundPrice, type FundSnapshot } from '@/lib/fundsApi';

type SortKey = 'short_name' | 'nav' | 'nav_change_previous' | 'nav_change_1m' | 'nav_change_12m' | 'nav_change_36m_annualized';

export default function FundsClient({ initial }: { initial: FundSnapshot | null }) {
    const { lang } = useLanguage();
    const t = fundsCopy[lang];
    const headings = fundDetailCopy[lang];
    const locale = { vi: 'vi-VN', en: 'en-US' }[lang];
    const [snapshot, setSnapshot] = useState(initial);
    const [loading, setLoading] = useState(!initial);
    const [error, setError] = useState(false);
    const [search, setSearch] = useState('');
    const [fundType, setFundType] = useState('');
    const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'short_name', descending: false });
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const result = await fetchFundPrices();
            if (!result.success) throw new Error('Unavailable snapshot');
            setSnapshot(result);
            setError(false);
        } catch { setError(true); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => {
        if (!initial) void load();
        const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 300000);
        return () => clearInterval(timer);
    }, [initial, load]);
    const types = useMemo(() => [...new Set((snapshot?.data ?? []).map(row => row.fund_type).filter(Boolean))].sort(), [snapshot]);
    const rows = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        const filtered = (snapshot?.data ?? []).filter(row => (!fundType || row.fund_type === fundType) &&
            `${row.short_name} ${row.name} ${row.fund_owner_name}`.toLocaleLowerCase().includes(query));
        return filtered.sort((a, b) => {
            const av = a[sort.key], bv = b[sort.key];
            if (av == null) return bv == null ? 0 : 1;
            if (bv == null) return -1;
            const diff = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
            return sort.descending ? -diff : diff;
        });
    }, [snapshot, search, fundType, sort]);
    function changeSort(key: SortKey) {
        setSort(current => ({ key, descending: current.key === key ? !current.descending : key !== 'short_name' }));
    }
    function typeLabel(value: string) {
        const name = value.toLowerCase();
        if (name.includes('cổ phiếu') || name.includes('stock')) return t.equity;
        if (name.includes('trái phiếu') || name.includes('bond')) return t.bond;
        if (name.includes('cân bằng') || name.includes('balanced')) return t.balanced;
        return value;
    }
    function percent(value: number | null) {
        if (value == null) return <span className="text-slate-400">—</span>;
        return <span className={value > 0 ? 'text-emerald-600 dark:text-emerald-400' : value < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'}>
            {value > 0 ? '+' : ''}{new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)}%
        </span>;
    }
    const columns: { key: SortKey; label: string }[] = [
        { key: 'short_name', label: t.name }, { key: 'nav', label: t.nav },
        { key: 'nav_change_previous', label: t.change }, { key: 'nav_change_1m', label: t.month },
        { key: 'nav_change_12m', label: t.year }, { key: 'nav_change_36m_annualized', label: t.annualized },
    ];
    return <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <section className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6">
        <header className="mb-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div><h1 className="text-3xl font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100 md:text-4xl">{headings.title} <span className="text-emerald-600 dark:text-emerald-400">{headings.accent}</span></h1>
                    <div className="mt-2 h-1 w-32 rounded bg-emerald-500" />
                    <p className="mt-3 max-w-4xl text-sm text-slate-600 dark:text-slate-300 md:text-base">{t.description}</p></div>
                <button disabled={loading} onClick={() => void load()} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-slate-700">{t.refresh}{loading ? '…' : ''}</button>
            </div>
        </header>
        <p className="mb-5 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{t.note}</p>
        {(error || snapshot?.stale) && <p role="status" className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{snapshot ? t.stale : t.error}</p>}
        <div className="overflow-hidden border-y border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
                <input aria-label={t.search} value={search} onChange={event => setSearch(event.target.value)} placeholder={t.search} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-slate-700" />
                <select aria-label={t.type} value={fundType} onChange={event => setFundType(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                    <option value="">{t.allTypes}</option>{types.map(type => <option key={type} value={type}>{typeLabel(type)}</option>)}
                </select>
            </div>
            <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-sm">
                <thead><tr className="border-b border-slate-100 text-xs text-slate-500 dark:border-slate-800">
                    {columns.map(column => <th key={column.key} scope="col" className={`px-4 py-4 font-medium ${column.key === 'short_name' ? 'text-left' : 'text-right'}`} aria-sort={sort.key === column.key ? sort.descending ? 'descending' : 'ascending' : 'none'}>
                        <button onClick={() => changeSort(column.key)}>{column.label} {sort.key === column.key ? sort.descending ? '↓' : '↑' : ''}</button></th>)}
                    <th scope="col" className="px-4 py-4 text-right font-medium">{t.date}</th>
                </tr></thead>
                <tbody>{rows.map((row: FundPrice) => <tr key={row.short_name} className="border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40">
                    <td className="max-w-[360px] px-4 py-4"><Link href={`/${lang}/funds/${encodeURIComponent(row.short_name)}`} className="block hover:underline"><span className="font-bold text-blue-600 dark:text-blue-400">{row.short_name}</span><div className="mt-1 truncate font-medium" title={row.name}>{row.name}</div></Link><div className="mt-1 text-xs text-slate-500">{typeLabel(row.fund_type)} · {row.fund_owner_name}</div></td>
                    <td className="px-4 py-4 text-right font-semibold tabular-nums">{new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(row.nav)}</td>
                    {[row.nav_change_previous, row.nav_change_1m, row.nav_change_12m, row.nav_change_36m_annualized].map((value, index) => <td key={index} className="px-4 py-4 text-right tabular-nums">{percent(value)}</td>)}
                    <td className="whitespace-nowrap px-4 py-4 text-right text-xs text-slate-500">{row.nav_update_at || '—'}</td>
                </tr>)}</tbody>
            </table></div>
            {!rows.length && <p role="status" className="p-10 text-center text-sm text-slate-500">{loading ? t.loading : error ? t.error : t.empty}</p>}
            <div className="flex flex-wrap justify-between gap-2 px-4 py-3 text-xs text-slate-500"><a href="https://fmarket.vn/" target="_blank" rel="noreferrer" className="hover:text-blue-600">{t.source}</a></div>
        </div>
        </section>
    </div>;
}
