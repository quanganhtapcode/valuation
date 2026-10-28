'use client';

import { apiFetch } from '@/lib/apiFetch';

import { apiUrl } from '@/lib/apiCore';

import { FormEvent, useEffect, useRef, useState } from 'react';

type Dataset = {
    id: string;
    name: { vi: string; en: string };
    note: { vi: string; en: string };
    available: boolean;
    dated: boolean;
    symbols: boolean;
    require_symbols: boolean;
    source: string;
    columns: string[];
};

export default function MarketDownloads({ lang }: { lang: 'vi' | 'en' }) {
    const vi = lang === 'vi';
    const [catalog, setCatalog] = useState<Dataset[]>([]);
    const [datasetId, setDatasetId] = useState('index-valuations');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [symbols, setSymbols] = useState('');
    const [format, setFormat] = useState('csv');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [failed, setFailed] = useState(false);
    const [retry, setRetry] = useState(0);
    const requestRef = useRef<AbortController | null>(null);
    const dataset = catalog.find(item => item.id === datasetId);
    const inputClass = 'mt-2 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950';

    useEffect(() => {
        const controller = new AbortController();
        apiFetch(apiUrl('/exports/catalog'), { signal: controller.signal, cache: 'no-store' })
            .then(async response => {
                if (!response.ok) throw new Error();
                const payload = await response.json() as { datasets: Dataset[] };
                if (controller.signal.aborted) return;
                setCatalog(payload.datasets);
                setDatasetId(payload.datasets.find(item => item.available)?.id ?? 'index-valuations');
                setFailed(false);
            })
            .catch(() => { if (!controller.signal.aborted) setFailed(true); });
        return () => controller.abort();
    }, [retry]);
    useEffect(() => () => requestRef.current?.abort(), []);

    async function download(event: FormEvent) {
        event.preventDefault();
        if (!dataset?.available || busy) return;
        const controller = new AbortController();
        requestRef.current = controller;
        setBusy(true);
        setMessage('');
        const params = new URLSearchParams({ dataset: dataset.id, format });
        if (dataset.dated) {
            if (from) params.set('from', from);
            if (to) params.set('to', to);
        }
        if (dataset.symbols && symbols.trim()) params.set('symbols', symbols.trim().toUpperCase());
        try {
            const response = await apiFetch(apiUrl(`/exports/market?${params}`), { signal: controller.signal, cache: 'no-store' });
            if (!response.ok) {
                const errors: Record<number, string> = vi ? {
                    400: 'Bộ lọc chưa hợp lệ. Kiểm tra ngày và danh sách mã (tối đa 50 mã).',
                    404: 'Không có dữ liệu phù hợp với bộ lọc.',
                    413: 'Vượt 100.000 dòng. Hãy thu hẹp khoảng ngày hoặc danh sách mã.',
                    429: 'Bạn đã tải nhiều tệp. Vui lòng thử lại sau.',
                } : {
                    400: 'Invalid filters. Check dates and symbols (up to 50).',
                    404: 'No data matches these filters.',
                    413: 'Over 100,000 rows. Narrow the dates or symbols.',
                    429: 'Download limit reached. Please try again later.',
                };
                throw new Error(errors[response.status] ?? (vi ? 'Chưa tải được dữ liệu. Vui lòng thử lại.' : 'Download unavailable. Please try again.'));
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `${dataset.id}-${new Date().toISOString().slice(0, 10)}.${format}`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 30_000);
            const count = Number(response.headers.get('X-Export-Rows'));
            setMessage(vi ? `Đã tải ${count ? count.toLocaleString('vi-VN') + ' dòng dữ liệu' : 'tệp dữ liệu'}.` : `Downloaded ${count ? count.toLocaleString('en-US') + ' rows' : 'the dataset'}.`);
        } catch (error) {
            if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : (vi ? 'Không tải được dữ liệu.' : 'Download failed.'));
        } finally {
            if (!controller.signal.aborted) setBusy(false);
        }
    }

    return <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 md:p-7">
        <h2 className="text-xl font-bold">{vi ? 'Dữ liệu thị trường' : 'Market data'}</h2>
        <p className="mt-2 text-sm text-slate-500">{vi ? 'Tải lịch sử giá, định giá, danh mục doanh nghiệp, dữ liệu quỹ và nhiều bộ dữ liệu khác dưới dạng CSV hoặc Excel.' : 'Download prices, valuations, companies, funds and other datasets as CSV or Excel.'}</p>
        {failed ? <p role="alert" className="mt-4 text-sm text-rose-600">{vi ? 'Chưa tải được danh mục.' : 'Could not load the catalog.'} <button type="button" className="underline" onClick={() => setRetry(value => value + 1)}>{vi ? 'Thử lại' : 'Retry'}</button></p> : !catalog.length ? <p role="status" className="mt-4 text-sm text-slate-500">{vi ? 'Đang tải danh mục…' : 'Loading datasets…'}</p> : <form onSubmit={download} className="mt-5 space-y-5">
            <fieldset disabled={busy} className="space-y-5 disabled:opacity-70">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                    <label className="text-sm font-medium">{vi ? 'Bộ dữ liệu' : 'Dataset'}<select className={inputClass} value={datasetId} onChange={event => { setDatasetId(event.target.value); setSymbols(''); setMessage(''); }}>
                        {catalog.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.name[lang]}{item.available ? '' : (vi ? ' — chưa có dữ liệu' : ' — unavailable')}</option>)}
                    </select></label>
                    <label className="text-sm font-medium">{vi ? 'Định dạng' : 'Format'}<select className={inputClass} value={format} onChange={event => setFormat(event.target.value)}><option value="csv">CSV (UTF-8)</option><option value="xlsx">Excel (.xlsx)</option></select></label>
                </div>
                {dataset?.dated && <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-medium">{vi ? 'Từ ngày' : 'From'}<input type="date" className={inputClass} value={from} max={to || undefined} onChange={event => setFrom(event.target.value)} /></label>
                    <label className="text-sm font-medium">{vi ? 'Đến ngày' : 'To'}<input type="date" className={inputClass} value={to} min={from || undefined} onChange={event => setTo(event.target.value)} /></label>
                </div>}
                {dataset?.symbols && <label className="block text-sm font-medium">{vi ? 'Mã, cách nhau bằng dấu phẩy' : 'Symbols, separated by commas'}{dataset.require_symbols ? ' *' : (vi ? ' (để trống để lấy tất cả)' : ' (blank for all)')}
                    <input className={inputClass} value={symbols} required={dataset.require_symbols} maxLength={1300} placeholder={dataset.id === 'index-prices' ? 'VNINDEX, VN30, HNXIndex' : dataset.id === 'fund-nav' ? 'DCDS, VESAF' : dataset.id === 'macro-prices' ? '^GSPC, GC=F, CL=F' : 'FPT, VCB, HPG'} onChange={event => setSymbols(event.target.value)} />
                </label>}
                {dataset && <div className="rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-950">
                    <p><b>{vi ? 'Nguồn: ' : 'Source: '}</b>{dataset.source}</p>
                    <p className="mt-1 text-slate-500">{dataset.note[lang]} {dataset.dated ? (vi ? 'Để trống ngày để lấy toàn bộ lịch sử hiện có.' : 'Leave dates blank for all available history.') : (vi ? 'Bản dữ liệu mới nhất, không phải chuỗi lịch sử.' : 'Latest snapshot, not a historical series.')}</p>
                    <details className="mt-3"><summary className="cursor-pointer font-medium">{vi ? 'Các cột trong tệp' : 'Exported columns'}</summary><p className="mt-2 break-words font-mono text-xs text-slate-500">{dataset.columns.join(', ')}</p></details>
                </div>}
                <div className="flex flex-wrap items-center gap-4">
                    <button type="submit" disabled={!dataset?.available} className="rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? (vi ? 'Đang tạo tệp…' : 'Preparing…') : (vi ? '↓ Tải dữ liệu thị trường' : '↓ Download market data')}</button>
                    <p className="text-xs text-slate-500">{vi ? 'Tối đa 100.000 dòng/tệp. Không cắt bớt dữ liệu khi vượt giới hạn.' : 'Up to 100,000 rows per file. Oversized exports are never truncated.'}</p>
                </div>
            </fieldset>
            {message && <p role="status" className="text-sm" aria-live="polite">{message}</p>}
        </form>}
    </section>;
}
