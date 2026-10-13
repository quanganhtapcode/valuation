'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Brush, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '@/contexts/LanguageContext';
import { fetchAPI } from '@/lib/apiCore';
import { type FundDetail, type FundPrice, type FundSnapshot } from '@/lib/fundsApi';
import { fundIssuers } from '@/lib/fundIssuers';
import { formatFundDisplayName } from '@/lib/fundDisplayName';
import { compareFundHistories, type ComparisonRange } from '@/lib/fundComparison';

const colors = ['#059669', '#7c3aed', '#2563eb', '#e11d48', '#d97706', '#0891b2', '#db2777', '#64748b'];
const ranges: ComparisonRange[] = ['ytd', '1m', '3m', '6m', '1y', '3y', '5y', 'all'];

export default function FundsComparison({ funds, initialDetail }: { funds?: FundPrice[]; initialDetail?: FundDetail }) {
    const { lang } = useLanguage();
    const vi = lang === 'vi';
    const [available, setAvailable] = useState<FundPrice[]>(funds ?? []);
    const [selected, setSelected] = useState<string[]>(initialDetail ? [initialDetail.fund.short_name] : []);
    const [range, setRange] = useState<ComparisonRange>('3y');
    const [search, setSearch] = useState('');
    const cache = useRef<Record<string, FundDetail>>(initialDetail ? { [initialDetail.fund.short_name]: initialDetail } : {});
    const [loaded, setLoaded] = useState<Record<string, FundDetail>>(() => initialDetail ? { [initialDetail.fund.short_name]: initialDetail } : {});
    const [busy, setBusy] = useState(false);
    const [listingError, setListingError] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        if (funds) return;
        const controller = new AbortController();
        fetchAPI<FundSnapshot>('/api/market/funds', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(result => {
            if (!result.success) throw new Error('Unavailable');
            setAvailable(result.data);
            setListingError(false);
        }).catch(() => { if (!controller.signal.aborted) setListingError(true); });
        return () => controller.abort();
    }, [funds, retry]);
    useEffect(() => {
        const controller = new AbortController();
        const missing = selected.filter(symbol => !cache.current[symbol]);
        // Schedule status updates with the asynchronous loading work.
        void Promise.resolve().then(async () => {
            if (controller.signal.aborted) return;
            setBusy(missing.length > 0);
            const results = await Promise.allSettled(missing.map(symbol => fetchAPI<FundDetail>(`/api/market/funds/${encodeURIComponent(symbol)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })));
            if (controller.signal.aborted) return;
            const failed: string[] = [];
            results.forEach((result, index) => {
                if (result.status === 'fulfilled' && result.value.success) cache.current[missing[index]] = result.value;
                else failed.push(missing[index]);
            });
            setLoaded({ ...cache.current });
            setErrors(failed);
            setBusy(false);
        });
        return () => controller.abort();
    }, [selected, retry]);
    const data = useMemo(() => compareFundHistories(Object.fromEntries(selected.filter(symbol => loaded[symbol]).map(symbol => [symbol, loaded[symbol].history])), range), [selected, loaded, range]);
    const grouped = useMemo(() => {
        const groups = new Map<string, Map<string, FundPrice[]>>();
        for (const fund of funds ?? available) {
            const manager = fundIssuers[fund.fund_owner_name]?.shortName || formatFundDisplayName(fund.fund_owner_name);
            if (!`${fund.short_name} ${fund.name} ${manager}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) continue;
            const type = fund.fund_type;
            if (!groups.has(type)) groups.set(type, new Map());
            const companies = groups.get(type)!;
            companies.set(manager, [...(companies.get(manager) ?? []), fund]);
        }
        return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([type, companies]) => ({ type, companies: [...companies].sort(([a], [b]) => a.localeCompare(b)) }));
    }, [funds, available, search]);
    const missingHistory = selected.filter(symbol => loaded[symbol] && loaded[symbol].history.length < 2);
    return <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0" aria-label={vi ? 'Biểu đồ so sánh quỹ' : 'Fund comparison chart'}>
            <div className="mb-4 flex flex-wrap gap-2">{ranges.map(value => <button key={value} onClick={() => setRange(value)} aria-pressed={range === value} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${range === value ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' : 'border-slate-200 dark:border-slate-700'}`}>{value === 'all' ? (vi ? 'Tất cả' : 'All') : value.toUpperCase()}</button>)}</div>
            {selected.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{selected.map((symbol, index) => <button key={symbol} onClick={() => setSelected(current => current.filter(s => s !== symbol))} aria-label={`${vi ? 'Bỏ chọn' : 'Remove'} ${symbol}`} className="rounded-full border border-slate-200 px-3 py-1 text-xs dark:border-slate-700"><span style={{ color: colors[index] }}>●</span> {symbol} ×</button>)}</div>}
            {busy ? <p role="status" className="py-20 text-center text-sm text-slate-500">{vi ? 'Đang tải lịch sử NAV…' : 'Loading NAV history…'}</p> : data.length > 1 ? <>
                <p className="mb-3 text-xs text-slate-500">{new Date(data[0].time).toISOString().slice(0, 10)} → {new Date(data[data.length - 1].time).toISOString().slice(0, 10)}</p>
                <div className="h-[420px] sm:h-[520px]"><ResponsiveContainer width="100%" height="100%"><LineChart key={`${range}:${selected.join(',')}`} data={data} margin={{ top: 10, right: 16, left: 0, bottom: 10 }}>
                    <CartesianGrid stroke="#94a3b8" opacity={0.15} />
                    <XAxis dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']} tick={{ fontSize: 11 }} minTickGap={50} tickFormatter={time => new Date(Number(time)).toISOString().slice(0, 7)} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={value => `${Number(value).toFixed(0)}%`} />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                    <Tooltip labelFormatter={time => new Date(Number(time)).toISOString().slice(0, 10)} formatter={value => `${Number(value).toLocaleString(vi ? 'vi-VN' : 'en-US', { maximumFractionDigits: 2 })}%`} contentStyle={{ background: 'var(--background, #fff)', borderRadius: 8, fontSize: 12 }} />
                    <Legend />
                    {selected.filter(symbol => data[0][symbol] != null).map(symbol => <Line key={symbol} dataKey={symbol} stroke={colors[selected.indexOf(symbol)]} strokeWidth={2} dot={false} type="stepAfter" isAnimationActive={false} />)}
                    <Brush dataKey="time" height={32} stroke="#059669" tickFormatter={time => new Date(Number(time)).toISOString().slice(0, 7)} />
                </LineChart></ResponsiveContainer></div>
                <p className="mt-2 text-xs text-slate-500">{vi ? 'Thay đổi NAV (%), cùng mốc bắt đầu = 0%. Giữa các kỳ công bố dùng NAV gần nhất; khoảng so sánh là phần lịch sử chung.' : 'NAV change (%), rebased to 0% at a shared start. Latest published NAV is carried between dates; comparison uses the shared history window.'}</p>
            </> : <p role="status" className="py-20 text-center text-sm text-slate-500">{selected.length ? (vi ? 'Không đủ lịch sử chung cho khoảng thời gian này.' : 'Not enough shared history for this period.') : (vi ? 'Chọn các quỹ bên cạnh để so sánh.' : 'Select funds to compare.')}</p>}
            {missingHistory.length > 0 && <p role="status" className="mt-3 text-sm text-amber-600">{vi ? 'Chưa có đủ lịch sử NAV:' : 'Insufficient NAV history:'} {missingHistory.join(', ')}</p>}
            {(errors.length > 0 || listingError) && <div role="alert" className="mt-3 text-sm text-rose-600">{vi ? 'Không tải được dữ liệu:' : 'Unable to load:'} {listingError ? (vi ? 'danh sách quỹ' : 'fund listing') : errors.join(', ')} <button className="underline" onClick={() => setRetry(current => current + 1)}>{vi ? 'Thử lại' : 'Retry'}</button></div>}
        </section>
        <aside className="border-t border-slate-200 pt-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0 dark:border-slate-800">
            <input aria-label={vi ? 'Tìm quỹ so sánh' : 'Search comparison funds'} placeholder={vi ? 'Tìm quỹ, công ty quản lý…' : 'Search funds, managers…'} value={search} onChange={event => setSearch(event.target.value)} className="mb-3 w-full rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-slate-700" />
            <p className="mb-3 text-xs text-slate-500">{vi ? 'Chọn tối đa 8 quỹ' : 'Select up to 8 funds'} · {selected.length}/8</p>
            <div className="max-h-[640px] space-y-4 overflow-y-auto">{grouped.map(group => <div key={group.type}><h3 className="mb-2 border-b border-slate-200 pb-2 text-sm font-semibold dark:border-slate-800">{formatFundDisplayName(group.type)}</h3>{group.companies.map(([manager, items]) => <details key={manager} open className="mb-2"><summary className="cursor-pointer text-sm font-medium">{manager}</summary><div className="mt-1 space-y-1 pl-4">{items.sort((a, b) => a.short_name.localeCompare(b.short_name)).map(fund => <label key={fund.short_name} title={formatFundDisplayName(fund.name)} className="flex cursor-pointer items-center gap-2 py-1 text-sm"><input type="checkbox" checked={selected.includes(fund.short_name)} disabled={!selected.includes(fund.short_name) && selected.length >= 8} onChange={event => setSelected(current => event.target.checked ? [...current, fund.short_name] : current.filter(symbol => symbol !== fund.short_name))} className="accent-emerald-600" /><span style={{ color: selected.includes(fund.short_name) ? colors[selected.indexOf(fund.short_name)] : undefined }}>{fund.short_name}</span></label>)}</div></details>)}</div>)}{!grouped.length && <p className="text-sm text-slate-500">{vi ? 'Không có quỹ phù hợp.' : 'No matching funds.'}</p>}</div>
        </aside>
    </div>;
}
