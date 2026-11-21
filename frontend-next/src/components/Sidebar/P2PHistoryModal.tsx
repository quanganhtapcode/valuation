'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogPanel } from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartAxisTick, chartColors, chartCursor, chartTooltipClass } from '@/lib/chartTheme';
import { apiFetch } from '@/lib/apiFetch';
import { apiUrl } from '@/lib/apiCore';
import { useLanguage } from '@/contexts/LanguageContext';

type Point = { time: number; price: number };
export type P2PSelection = { source: 'okx' | 'binance'; direction: 'buy' | 'sell' };

export default function P2PHistoryModal({ selection, onClose }: { selection: P2PSelection; onClose: () => void }) {
    const { lang } = useLanguage();
    const vi = lang === 'vi';
    const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const [days, setDays] = useState('1');
    const [points, setPoints] = useState<Point[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const title = `${selection.source === 'okx' ? 'OKX' : 'Binance'} · ${selection.direction === 'buy' ? (vi ? 'Mua' : 'Buy') : (vi ? 'Bán' : 'Sell')} USDT/VND`;
    const date = (time: number) => new Date(time).toLocaleString(vi ? 'vi-VN' : 'en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const value = (price: number) => price.toLocaleString('vi-VN');
    useEffect(() => {
        const controller = new AbortController();
        async function load() {
            try {
                const params = new URLSearchParams({ source: selection.source, direction: selection.direction, days });
                const response = await apiFetch(`${apiUrl('/market/p2p/history')}?${params}`, { signal: controller.signal });
                if (!response.ok) throw new Error('History unavailable');
                const result: unknown = await response.json();
                if (!Array.isArray(result)) throw new Error('Invalid history');
                if (!controller.signal.aborted) { setPoints(result.filter((p): p is Point => typeof p?.time === 'number' && Number.isFinite(p.time) && typeof p.price === 'number' && Number.isFinite(p.price))); setLoading(false); }
            } catch { if (!controller.signal.aborted) { setError(true); setLoading(false); } }
        }
        load();
        return () => controller.abort();
    }, [selection.source, selection.direction, days, attempt]);
    const stats = useMemo(() => points.reduce((acc, p) => ({ min: Math.min(acc.min, p.price), max: Math.max(acc.max, p.price) }), { min: Infinity, max: -Infinity }), [points]);
    function close() { onClose(); requestAnimationFrame(() => { if (opener?.isConnected) opener.focus({ preventScroll: true }); }); }
    return <Dialog open onClose={close} className="fixed inset-0 z-[100]" aria-label={title}>
        <DialogPanel className="w-full max-w-5xl overflow-hidden rounded-2xl bg-white p-0 text-slate-900 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-800">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-4 dark:border-slate-800 sm:px-6">
                <div><p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">{vi ? 'Lịch sử dữ liệu' : 'Data history'}</p><h2 className="mt-1 text-lg font-bold sm:text-xl">{title}</h2><p className="mt-1 text-xs text-slate-500">VND/USDT · UTC+7</p></div>
                <button type="button" onClick={close} aria-label={vi ? 'Đóng' : 'Close'} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-slate-800"><RiCloseLine className="h-5 w-5" /></button>
            </div>
            <div className="max-h-[75dvh] space-y-4 overflow-y-auto p-4 sm:p-6">
                <label className="text-sm"><span className="sr-only">{vi ? 'Khoảng thời gian' : 'Time range'}</span><select value={days} onChange={e => { setLoading(true); setError(false); setDays(e.target.value); }} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950"><option value="1">{vi ? '24 giờ' : '24 hours'}</option><option value="7">{vi ? '7 ngày' : '7 days'}</option><option value="30">{vi ? '30 ngày' : '30 days'}</option><option value="0">{vi ? 'Tất cả' : 'All'}</option></select></label>
                {loading ? <div role="status" className="py-24 text-center text-sm text-slate-500">{vi ? 'Đang tải dữ liệu…' : 'Loading data…'}</div> : error ? <div role="alert" className="py-20 text-center text-sm text-rose-600">{vi ? 'Không tải được dữ liệu.' : 'Unable to load data.'} <button type="button" className="underline" onClick={() => { setLoading(true); setError(false); setAttempt(n => n + 1); }}>{vi ? 'Thử lại' : 'Retry'}</button></div> : !points.length ? <div className="py-24 text-center text-sm text-slate-500">{vi ? 'Không có dữ liệu trong khoảng thời gian này.' : 'No data in this time range.'}</div> : <>
                    <div className="grid grid-cols-3 gap-2">{[[vi ? 'Gần nhất' : 'Latest', points.at(-1)!.price], [vi ? 'Thấp nhất' : 'Lowest', stats.min], [vi ? 'Cao nhất' : 'Highest', stats.max]].map(([label, price]) => <div key={label} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold tabular-nums sm:text-lg">{value(price as number)}</p></div>)}</div>
                    <div className="h-72 w-full sm:h-80" aria-label={title}><ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" /><XAxis dataKey="time" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={date} axisLine={false} tickLine={false} minTickGap={35} tick={chartAxisTick} height={35} /><YAxis domain={['dataMin - 50', 'dataMax + 50']} tickFormatter={value} width={64} axisLine={false} tickLine={false} tick={chartAxisTick} /><Tooltip cursor={chartCursor} content={({ active, payload }) => { const point = payload?.[0]?.payload as Point | undefined; return active && point ? <div className={chartTooltipClass}><p className="text-xs text-slate-500">{date(point.time)}</p><p className="font-semibold">{value(point.price)} ₫</p></div> : null; }} /><Line type="linear" dataKey="price" stroke={chartColors.primary} strokeWidth={2} dot={points.length === 1} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>
                    <p className="text-xs text-slate-500">{points.length} {vi ? 'mốc dữ liệu' : 'observations'} · {date(points[0].time)} – {date(points.at(-1)!.time)} · UTC+7</p>
                </>}
            </div>
        </DialogPanel>
    </Dialog>;
}
