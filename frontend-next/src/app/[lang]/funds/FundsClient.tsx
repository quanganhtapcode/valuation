'use client';

import Link from 'next/link';
import FundsComparison from '@/components/Funds/FundsComparison';
import FundsTabs from '@/components/Funds/FundsTabs';
import Image from 'next/image';
import { fundIssuers } from '@/lib/fundIssuers';
import { fundDetailCopy } from '@/lib/fundDetailCopy';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatFundDisplayName } from '@/lib/fundDisplayName';
import { fundsCopy } from '@/lib/fundsCopy';
import { fetchFundPrices, type FundPrice, type FundSnapshot } from '@/lib/fundsApi';

type SortKey = 'short_name' | 'fund_owner_name' | 'nav' | 'nav_change_12m' | 'nav_change_36m_annualized';

function IssuerLogo({ manager }: { manager: string }) {
    const issuer = fundIssuers[manager];
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-white">
        {issuer && failedUrl !== issuer.logoUrl
            ? <Image src={issuer.logoUrl} alt="" width={36} height={36} unoptimized className="h-9 w-9 object-contain" onError={() => setFailedUrl(issuer.logoUrl)} />
            : <span className="text-xs font-semibold text-slate-500">{issuer?.shortName.slice(0, 3) || '—'}</span>}
    </span>;
}

export default function FundsClient({ initial }: { initial: FundSnapshot | null }) {
    const { lang } = useLanguage();
    const t = fundsCopy[lang];
    const headings = fundDetailCopy[lang];
    const locale = { vi: 'vi-VN', en: 'en-US' }[lang];
    const [snapshot, setSnapshot] = useState(initial);
    const [loading, setLoading] = useState(!initial);
    const [error, setError] = useState(false);
    const [tab, setTab] = useState<'nav' | 'compare'>('nav');
    const [comparisonVisited, setComparisonVisited] = useState(false);
    const [search, setSearch] = useState('');
    const [fundType, setFundType] = useState('');
    const [fundManager, setFundManager] = useState('');
    const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'nav_change_12m', descending: true });
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
    const managers = useMemo(() => [...new Set((snapshot?.data ?? []).map(row => row.fund_owner_name).filter(Boolean))]
        .sort((a, b) => (fundIssuers[a]?.shortName || formatFundDisplayName(a)).localeCompare(fundIssuers[b]?.shortName || formatFundDisplayName(b), locale)), [snapshot, locale]);
    const rows = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        const filtered = (snapshot?.data ?? []).filter(row => (!fundType || row.fund_type === fundType) &&
            (!fundManager || row.fund_owner_name === fundManager) &&
            `${row.short_name} ${row.name} ${row.fund_owner_name} ${fundIssuers[row.fund_owner_name]?.shortName ?? ''}`.toLocaleLowerCase().includes(query));
        return filtered.sort((a, b) => {
            const av = sort.key === 'fund_owner_name' ? fundIssuers[a.fund_owner_name]?.shortName || a.fund_owner_name : a[sort.key];
            const bv = sort.key === 'fund_owner_name' ? fundIssuers[b.fund_owner_name]?.shortName || b.fund_owner_name : b[sort.key];
            if (av == null) return bv == null ? 0 : 1;
            if (bv == null) return -1;
            const diff = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
            return sort.descending ? -diff : diff;
        });
    }, [snapshot, search, fundType, fundManager, sort]);
    function changeSort(key: SortKey) {
        setSort(current => ({ key, descending: current.key === key ? !current.descending : key !== 'short_name' && key !== 'fund_owner_name' }));
    }
    function typeLabel(value: string) {
        const name = value.toLowerCase();
        if (name.includes('cổ phiếu') || name.includes('stock')) return lang === 'vi' ? `Quỹ ${t.equity.toLowerCase()}` : t.equity;
        if (name.includes('trái phiếu') || name.includes('bond')) return lang === 'vi' ? `Quỹ ${t.bond.toLowerCase()}` : t.bond;
        if (name.includes('cân bằng') || name.includes('balanced')) return lang === 'vi' ? `Quỹ ${t.balanced.toLowerCase()}` : t.balanced;
        return value;
    }
    function percent(value: number | null) {
        if (value == null) return <span className="text-slate-400">—</span>;
        return <span className={value > 0 ? 'text-emerald-600 dark:text-emerald-400' : value < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'}>
            {new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)}%
        </span>;
    }
    const columns: { key: SortKey; label: string }[] = [
        { key: 'short_name', label: t.name }, { key: 'fund_owner_name', label: t.issuer },
        { key: 'nav', label: t.nav },
        { key: 'nav_change_12m', label: t.year }, { key: 'nav_change_36m_annualized', label: t.annualized },
    ];
    return <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <section className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6">
        <header className="mb-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div><h1 className="text-3xl font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100 md:text-4xl">{headings.title} <span className="text-emerald-600 dark:text-emerald-400">{headings.accent}</span></h1>
                    <div className="mt-2 h-1 w-32 rounded bg-emerald-500" />
                    <p className="mt-3 max-w-4xl text-sm text-slate-600 dark:text-slate-300 md:text-base">{t.description}</p></div>
            </div>
            <FundsTabs value={tab} onChange={value => { setTab(value); if (value === 'compare') setComparisonVisited(true); }} />
        </header>
        {(error || snapshot?.stale) && <p role="status" className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{snapshot ? t.stale : t.error}</p>}
        <div id="fund-panel-compare" role="tabpanel" aria-labelledby="fund-tab-compare" hidden={tab !== 'compare'}>{comparisonVisited && <FundsComparison funds={snapshot?.data ?? []} />}</div>
        <div id="fund-panel-nav" role="tabpanel" aria-labelledby="fund-tab-nav" hidden={tab !== 'nav'} className="overflow-hidden border-y border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
                <input aria-label={t.search} value={search} onChange={event => setSearch(event.target.value)} placeholder={t.search} className="w-full min-w-0 rounded-lg sm:w-80 border border-slate-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-slate-700" />
                <select aria-label={t.type} value={fundType} onChange={event => setFundType(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm sm:w-auto dark:border-slate-700 dark:bg-slate-900">
                    <option value="">{t.allTypes}</option>{types.map(type => <option key={type} value={type}>{typeLabel(type)}</option>)}
                </select>
                <select aria-label={t.manager} value={fundManager} onChange={event => setFundManager(event.target.value)} className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm sm:w-80 dark:border-slate-700 dark:bg-slate-900">
                    <option value="">{t.allManagers}</option>{managers.map(manager => <option key={manager} value={manager}>{fundIssuers[manager]?.shortName || formatFundDisplayName(manager)}</option>)}
                </select>
            </div>
            <div className="overflow-x-auto"><table className="w-full min-w-[960px] table-fixed text-left text-sm">
                <thead className="border-b border-slate-200 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-300"><tr>
                    {columns.map(column => <th key={column.key} scope="col" className={`px-3 py-3 font-semibold md:px-4 ${column.key === 'short_name' || column.key === 'fund_owner_name' ? 'text-left' : 'text-right'}`} aria-sort={sort.key === column.key ? sort.descending ? 'descending' : 'ascending' : 'none'}>
                        <button className="inline-flex items-center gap-2" onClick={() => changeSort(column.key)}><span>{column.label}</span><span aria-hidden="true" className={sort.key === column.key ? 'text-blue-600' : 'text-slate-300'}>{sort.key === column.key && !sort.descending ? '▴' : '▾'}</span></button>
                    </th>)}
                </tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{rows.map((row: FundPrice) => <tr key={row.short_name} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="px-3 py-3.5 md:px-4"><div className="flex items-center gap-3">
                        <IssuerLogo manager={row.fund_owner_name} />
                        <div className="min-w-0"><Link href={`/${lang}/funds/${encodeURIComponent(row.short_name)}`} title={formatFundDisplayName(row.name)} aria-label={`${row.short_name} — ${formatFundDisplayName(row.name)}`} className="font-semibold text-blue-600 hover:underline dark:text-blue-400">{row.short_name}</Link>
                            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{typeLabel(row.fund_type)}</div>
                        </div>
                    </div></td>
                    <td className="px-3 py-3.5 md:px-4" title={formatFundDisplayName(row.fund_owner_name)}>{fundIssuers[row.fund_owner_name]?.shortName || formatFundDisplayName(row.fund_owner_name)}</td>
                    <td className="px-3 py-3.5 md:px-4 text-right font-medium tabular-nums">
                        <div>{new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(row.nav)}</div>
                        <div className="mt-0.5 whitespace-nowrap text-xs font-normal text-slate-400">{t.navAsOf} {row.nav_update_at ? row.nav_update_at.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1') : '—'}</div>
                    </td>
                    {[row.nav_change_12m, row.nav_change_36m_annualized].map((value, index) => <td key={index} className="px-3 py-3.5 md:px-4 text-right font-semibold tabular-nums">{percent(value)}</td>)}
                </tr>)}</tbody>
            </table></div>
            {!rows.length && <p role="status" className="p-10 text-center text-sm text-slate-500">{loading ? t.loading : error ? t.error : t.empty}</p>}
            <div className="flex flex-wrap justify-between gap-2 px-4 py-3 text-xs text-slate-500"><a href="https://fmarket.vn/" target="_blank" rel="noreferrer" className="hover:text-blue-600">{t.source}</a></div>
        </div>
        </section>
    </div>;
}
