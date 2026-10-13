'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Brush, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '@/contexts/LanguageContext';
import { fetchAPI } from '@/lib/apiCore';
import { type FundDetail, type FundPrice, type FundSnapshot } from '@/lib/fundsApi';
import { fundIssuers } from '@/lib/fundIssuers';
import { formatFundDisplayName } from '@/lib/fundDisplayName';
import { compareFundHistories, fundCagr, type ComparisonRange } from '@/lib/fundComparison';

const colors = ['#059669', '#7c3aed', '#2563eb', '#e11d48', '#d97706', '#0891b2', '#db2777', '#64748b'];
const ranges: ComparisonRange[] = ['ytd', '1m', '3m', '6m', '1y', '3y', '5y', 'all'];

export default function FundsComparison({ funds, initialDetail }: { funds?: FundPrice[]; initialDetail?: FundDetail }) {
    const { lang } = useLanguage();
    const vi = lang === 'vi';
    const [available, setAvailable] = useState<FundPrice[]>(funds ?? []);
    const [selected, setSelected] = useState<string[]>(initialDetail ? [initialDetail.fund.short_name] : []);
    const [window, setWindow] = useState<{ key: string; start: number; end: number } | null>(null);
    const [range, setRange] = useState<ComparisonRange>('3y');
    const [search, setSearch] = useState('');
    const [fundType, setFundType] = useState('');
    const [manager, setManager] = useState('');
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
    const windowKey = `${range}:${selected.join(',')}:${data[0]?.time}:${data.at(-1)?.time}`;
    const startIndex = window?.key === windowKey ? Math.min(window.start, Math.max(0, data.length - 2)) : 0;
    const endIndex = window?.key === windowKey ? Math.min(window.end, data.length - 1) : data.length - 1;
    const first = data[startIndex], last = data[endIndex];
    const dateLabel = (time: number) => new Date(time).toISOString().slice(0, 10);
    function setDate(edge: 'start' | 'end', date: string) {
        if (!date || data.length < 2) return;
        const time = Date.parse(`${date}T00:00:00Z`);
        if (!Number.isFinite(time)) return;
        if (edge === 'start') {
            const found = data.findIndex(row => row.time >= time);
            setWindow({ key: windowKey, start: Math.min(Math.max(0, found < 0 ? data.length - 1 : found), endIndex - 1), end: endIndex });
        } else {
            const found = data.findLastIndex(row => row.time <= time);
            setWindow({ key: windowKey, start: startIndex, end: Math.max(startIndex + 1, found) });
        }
    }
    const listing = funds ?? available;
    const types = [...new Set(listing.map(fund => fund.fund_type))].sort();
    const managers = [...new Set(listing.map(fund => fund.fund_owner_name))].sort();
    const filtered = useMemo(() => listing.filter(fund =>
        (!fundType || fund.fund_type === fundType) && (!manager || fund.fund_owner_name === manager) &&
        `${fund.short_name} ${fund.name} ${fundIssuers[fund.fund_owner_name]?.shortName ?? fund.fund_owner_name}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    ).sort((a, b) => a.short_name.localeCompare(b.short_name)), [listing, fundType, manager, search]);
    const missingHistory = selected.filter(symbol => loaded[symbol] && loaded[symbol].history.length < 2);
    return <div className="space-y-4">
        <section className="min-w-0" aria-label={vi ? 'Biểu đồ so sánh quỹ' : 'Fund comparison chart'}>
            <div className="mb-3 flex gap-1 overflow-x-auto">{ranges.map(value => <button key={value} onClick={() => setRange(value)} aria-pressed={range === value} className={`shrink-0 rounded-full border px-2.5 py-1.5 text-xs font-medium ${range === value ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' : 'border-slate-200 dark:border-slate-700'}`}>{value === 'all' ? (vi ? 'Tất cả' : 'All') : value.toUpperCase()}</button>)}</div>
            {selected.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{selected.map((symbol, index) => <button key={symbol} onClick={() => setSelected(current => current.filter(s => s !== symbol))} aria-label={`${vi ? 'Bỏ chọn' : 'Remove'} ${symbol}`} className="rounded-full border border-slate-200 px-3 py-1 text-xs dark:border-slate-700"><span style={{ color: colors[index] }}>●</span> {symbol} ×</button>)}</div>}
            {busy ? <p role="status" className="py-20 text-center text-sm text-slate-500">{vi ? 'Đang tải lịch sử NAV…' : 'Loading NAV history…'}</p> : data.length > 1 ? <>
                <p className="mb-3 text-right text-xs text-slate-500">{dateLabel(first.time)} → {dateLabel(last.time)}</p>
                <div className="-mx-2 h-[320px] sm:mx-0 sm:h-[520px] [&_.recharts-surface]:outline-none [&_.recharts-surface:focus-visible]:outline [&_.recharts-surface:focus-visible]:outline-1 [&_.recharts-surface:focus-visible]:outline-emerald-500"><ResponsiveContainer width="100%" height="100%"><LineChart key={windowKey} data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#94a3b8" opacity={0.15} />
                    <XAxis dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']} tick={{ fontSize: 11 }} minTickGap={50} tickFormatter={time => new Date(Number(time)).toISOString().slice(0, 7)} />
                    <YAxis width={42} tick={{ fontSize: 11 }} tickFormatter={value => `${Number(value).toFixed(0)}%`} />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                    <Tooltip labelFormatter={time => new Date(Number(time)).toISOString().slice(0, 10)} formatter={value => `${Number(value).toLocaleString(vi ? 'vi-VN' : 'en-US', { maximumFractionDigits: 2 })}%`} contentStyle={{ background: 'var(--background, #fff)', borderRadius: 8, fontSize: 12 }} />
                    {selected.filter(symbol => data[0][symbol] != null).map(symbol => <Line key={symbol} dataKey={symbol} stroke={colors[selected.indexOf(symbol)]} strokeWidth={2} dot={false} type="stepAfter" isAnimationActive={false} />)}
                    <Brush dataKey="time" startIndex={startIndex} endIndex={endIndex} onChange={indices => { if (indices.startIndex != null && indices.endIndex != null && indices.endIndex > indices.startIndex) setWindow({ key: windowKey, start: indices.startIndex, end: indices.endIndex }); }} travellerWidth={16} height={44} stroke="#059669" tickFormatter={time => new Date(Number(time)).toISOString().slice(0, 7)} />
                </LineChart></ResponsiveContainer></div>
                <div className="mt-3 flex flex-wrap items-center justify-end gap-2 text-xs text-slate-500">
                    <label className="flex items-center gap-2">{vi ? 'Từ' : 'From'}<input type="date" value={dateLabel(first.time)} min={dateLabel(data[0].time)} max={dateLabel(data[Math.max(0, endIndex - 1)].time)} onChange={event => setDate('start', event.target.value)} className="min-w-0 rounded border border-slate-200 bg-transparent p-2 dark:border-slate-700" /></label>
                    <label className="flex items-center gap-2">{vi ? 'Đến' : 'To'}<input type="date" value={dateLabel(last.time)} min={dateLabel(data[Math.min(data.length - 1, startIndex + 1)].time)} max={dateLabel(data.at(-1)!.time)} onChange={event => setDate('end', event.target.value)} className="min-w-0 rounded border border-slate-200 bg-transparent p-2 dark:border-slate-700" /></label>
                    <button type="button" onClick={() => setWindow(null)} className="px-2 py-2 text-blue-600">{vi ? 'Đặt lại' : 'Reset'}</button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">{selected.filter(symbol => first[symbol] != null).map(symbol => {
                    const value = fundCagr(first[symbol], last[symbol], first.time, last.time);
                    return <div key={symbol} className="rounded-lg bg-slate-100 px-3 py-2 text-xs dark:bg-slate-800"><span style={{ color: colors[selected.indexOf(symbol)] }} className="font-semibold">{symbol}</span><div className="mt-1">CAGR <span className="font-semibold">{value == null ? '—' : `${value.toLocaleString(vi ? 'vi-VN' : 'en-US', { maximumFractionDigits: 2 })}%`}</span> {vi ? '/ năm' : '/ year'}</div></div>;
                })}</div>
                <p className="mt-2 text-xs text-slate-500">{vi ? 'Thay đổi NAV (%), cùng mốc bắt đầu = 0%. Giữa các kỳ công bố dùng NAV gần nhất; khoảng so sánh là phần lịch sử chung. CAGR được quy đổi theo năm từ NAV trong khoảng ngày đang xem.' : 'NAV change (%), rebased to 0% at a shared start. Latest published NAV is carried between dates; comparison uses the shared history window. CAGR annualizes NAV change over the visible dates.'}</p>
            </> : <p role="status" className="py-20 text-center text-sm text-slate-500">{selected.length ? (vi ? 'Không đủ lịch sử chung cho khoảng thời gian này.' : 'Not enough shared history for this period.') : (vi ? 'Chọn quỹ phía dưới để so sánh.' : 'Select funds to compare.')}</p>}
            {missingHistory.length > 0 && <p role="status" className="mt-3 text-sm text-amber-600">{vi ? 'Chưa có đủ lịch sử NAV:' : 'Insufficient NAV history:'} {missingHistory.join(', ')}</p>}
            {(errors.length > 0 || listingError) && <div role="alert" className="mt-3 text-sm text-rose-600">{vi ? 'Không tải được dữ liệu:' : 'Unable to load:'} {listingError ? (vi ? 'danh sách quỹ' : 'fund listing') : errors.join(', ')} <button className="underline" onClick={() => setRetry(current => current + 1)}>{vi ? 'Thử lại' : 'Retry'}</button></div>}
        </section>
        <div className="rounded-lg border border-slate-200 dark:border-slate-800">
            <h2 className="px-3 pt-3 text-sm font-semibold">{vi ? 'Chọn quỹ so sánh' : 'Select funds'} <span className="ml-2 text-xs font-normal text-slate-500">{selected.length}/8</span></h2>
            <div id="fund-comparison-picker" className="p-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <input aria-label={vi ? 'Tìm quỹ so sánh' : 'Search comparison funds'} placeholder={vi ? 'Tìm mã hoặc tên quỹ…' : 'Search funds…'} value={search} onChange={event => { setSearch(event.target.value); }} className="col-span-2 min-w-0 rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm sm:col-span-1 dark:border-slate-700" />
                    <select aria-label={vi ? 'Loại quỹ' : 'Fund type'} value={fundType} onChange={event => { setFundType(event.target.value); }} className="min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"><option value="">{vi ? 'Tất cả loại quỹ' : 'All fund types'}</option>{types.map(type => <option key={type} value={type}>{formatFundDisplayName(type)}</option>)}</select>
                    <select aria-label={vi ? 'Công ty quản lý' : 'Fund manager'} value={manager} onChange={event => { setManager(event.target.value); }} className="min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"><option value="">{vi ? 'Tất cả công ty' : 'All managers'}</option>{managers.map(name => <option key={name} value={name}>{fundIssuers[name]?.shortName || formatFundDisplayName(name)}</option>)}</select>
                </div>
                <div className="mt-3 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto md:grid-cols-3 lg:grid-cols-5">{filtered.map(fund => <label key={fund.short_name} className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border p-2 ${selected.includes(fund.short_name) ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30' : 'border-slate-200 dark:border-slate-800'}`}>
                    <input type="checkbox" checked={selected.includes(fund.short_name)} disabled={!selected.includes(fund.short_name) && selected.length >= 8} onChange={event => { const checked = event.target.checked; setSelected(current => checked ? current.length < 8 && !current.includes(fund.short_name) ? [...current, fund.short_name] : current : current.filter(symbol => symbol !== fund.short_name)); }} className="accent-emerald-600" />
                    <span className="min-w-0"><span className="block text-sm font-semibold">{fund.short_name}</span><span className="block truncate text-xs text-slate-500" title={formatFundDisplayName(fund.name)}>{fundIssuers[fund.fund_owner_name]?.shortName || formatFundDisplayName(fund.fund_owner_name)}</span></span>
                </label>)}</div>
                {!filtered.length && <p className="py-4 text-sm text-slate-500">{vi ? 'Không có quỹ phù hợp.' : 'No matching funds.'}</p>}

            </div>
        </div>
    </div>;
}
