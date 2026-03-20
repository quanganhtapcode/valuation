'use client';

import { useState } from 'react';
import Link from 'next/link';

// ── helpers ───────────────────────────────────────────────────────────────────

function toCSV(rows: Record<string, unknown>[]): string {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const escape = (v: unknown) => {
        const s = v == null ? '' : String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"`
            : s;
    };
    return [
        headers.join(','),
        ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
    ].join('\n');
}

function triggerDownload(content: string, filename: string, mime = 'text/csv;charset=utf-8;') {
    const blob = new Blob(['\uFEFF' + content, ''], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ── dataset definitions ───────────────────────────────────────────────────────

type Status = 'idle' | 'loading' | 'done' | 'error';

interface Dataset {
    id: string;
    title: string;
    description: string;
    rows: string;
    format: string;
    columns: string[];
    fetch: () => Promise<Record<string, unknown>[]>;
    filename: () => string;
}

const today = () => new Date().toISOString().slice(0, 10);

const DATASETS: Dataset[] = [
    {
        id: 'valuation',
        title: 'VN-Index Valuation History',
        description: 'Daily PE TTM, PB TTM, VN-Index close price and market volume — full history.',
        rows: '~5 500 rows',
        format: 'CSV',
        columns: ['date', 'pe', 'pb', 'vnindex', 'volume'],
        filename: () => `vnindex_valuation_${today()}.csv`,
        fetch: async () => {
            const res = await fetch('/api/market/pe-chart?metric=both');
            if (!res.ok) throw new Error('Failed to fetch valuation data');
            const data = await res.json();
            const pe: Record<string, number> = {};
            const pb: Record<string, number> = {};
            const vn: Record<string, { close: number; volume?: number }> = {};
            for (const { date, value } of (data?.series?.pe ?? data?.DataPE ?? [])) pe[date] = value;
            for (const { date, value } of (data?.series?.pb ?? data?.DataPB ?? [])) pb[date] = value;
            for (const { date, value, volume } of (data?.series?.vnindex ?? [])) vn[date] = { close: value, volume };
            const dates = [...new Set([...Object.keys(pe), ...Object.keys(pb), ...Object.keys(vn)])].sort();
            return dates.map(date => ({
                date,
                pe: pe[date] ?? '',
                pb: pb[date] ?? '',
                vnindex: vn[date]?.close ?? '',
                volume: vn[date]?.volume ?? '',
            }));
        },
    },
    {
        id: 'vnindex-history',
        title: 'VN-Index Daily OHLCV',
        description: 'Full daily OHLCV price history for VN-Index from the market database.',
        rows: '~2 000 rows',
        format: 'CSV',
        columns: ['tradingDate', 'open', 'high', 'low', 'close', 'volume', 'value'],
        filename: () => `vnindex_history_${today()}.csv`,
        fetch: async () => {
            const res = await fetch('/api/market/index-history?index=VNINDEX&days=2000');
            if (!res.ok) throw new Error('Failed to fetch index history');
            return res.json();
        },
    },
    {
        id: 'vn30-history',
        title: 'VN30 Daily History',
        description: 'Full daily price history for VN30 index.',
        rows: '~2 000 rows',
        format: 'CSV',
        columns: ['tradingDate', 'open', 'high', 'low', 'close', 'volume', 'value'],
        filename: () => `vn30_history_${today()}.csv`,
        fetch: async () => {
            const res = await fetch('/api/market/index-history?index=VN30&days=2000');
            if (!res.ok) throw new Error('Failed to fetch VN30 history');
            return res.json();
        },
    },
    {
        id: 'hnx-history',
        title: 'HNX Index Daily History',
        description: 'Full daily price history for HNX-Index.',
        rows: '~2 000 rows',
        format: 'CSV',
        columns: ['tradingDate', 'open', 'high', 'low', 'close', 'volume', 'value'],
        filename: () => `hnx_history_${today()}.csv`,
        fetch: async () => {
            const res = await fetch('/api/market/index-history?index=HNXIndex&days=2000');
            if (!res.ok) throw new Error('Failed to fetch HNX history');
            return res.json();
        },
    },
    {
        id: 'top-movers-up',
        title: 'Top Gainers (Today)',
        description: 'Top 10 gaining stocks on HOSE today with price and change data.',
        rows: '10 rows',
        format: 'CSV',
        columns: ['symbol', 'companyName', 'price', 'changePercent', 'volume'],
        filename: () => `top_gainers_${today()}.csv`,
        fetch: async () => {
            const res = await fetch('/api/market/top-movers?type=UP');
            if (!res.ok) throw new Error('Failed to fetch top movers');
            const data = await res.json();
            const items: Record<string, unknown>[] = Array.isArray(data) ? data : (data?.data ?? []);
            return items.map(d => ({
                symbol: d.symbol ?? d.Symbol ?? '',
                companyName: d.companyName ?? d.CompanyName ?? d.organName ?? '',
                price: d.price ?? d.matchedPrice ?? '',
                changePercent: d.changePercent ?? d.percentPriceChange ?? '',
                volume: d.volume ?? d.matchedVolume ?? '',
            }));
        },
    },
    {
        id: 'top-movers-down',
        title: 'Top Losers (Today)',
        description: 'Top 10 declining stocks on HOSE today.',
        rows: '10 rows',
        format: 'CSV',
        columns: ['symbol', 'companyName', 'price', 'changePercent', 'volume'],
        filename: () => `top_losers_${today()}.csv`,
        fetch: async () => {
            const res = await fetch('/api/market/top-movers?type=DOWN');
            if (!res.ok) throw new Error('Failed to fetch top movers');
            const data = await res.json();
            const items: Record<string, unknown>[] = Array.isArray(data) ? data : (data?.data ?? []);
            return items.map(d => ({
                symbol: d.symbol ?? d.Symbol ?? '',
                companyName: d.companyName ?? d.CompanyName ?? d.organName ?? '',
                price: d.price ?? d.matchedPrice ?? '',
                changePercent: d.changePercent ?? d.percentPriceChange ?? '',
                volume: d.volume ?? d.matchedVolume ?? '',
            }));
        },
    },
];

// ── card ──────────────────────────────────────────────────────────────────────

function DatasetCard({ ds }: { ds: Dataset }) {
    const [status, setStatus] = useState<Status>('idle');
    const [count, setCount] = useState<number | null>(null);

    async function handleDownload() {
        setStatus('loading');
        try {
            const rows = await ds.fetch();
            if (!rows.length) { setStatus('error'); return; }
            const csv = toCSV(rows);
            triggerDownload(csv, ds.filename());
            setCount(rows.length);
            setStatus('done');
            setTimeout(() => setStatus('idle'), 3000);
        } catch {
            setStatus('error');
            setTimeout(() => setStatus('idle'), 4000);
        }
    }

    const btnLabel =
        status === 'loading' ? 'Preparing…'
        : status === 'done'  ? `Downloaded (${count?.toLocaleString()} rows)`
        : status === 'error' ? 'Error — retry?'
        : 'Download CSV';

    const btnCls = [
        'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none',
        status === 'done'    ? 'bg-emerald-600 text-white cursor-default'
        : status === 'error' ? 'bg-red-600 text-white cursor-pointer'
        : status === 'loading' ? 'bg-blue-500 text-white cursor-wait opacity-80'
        : 'bg-tremor-brand text-white hover:bg-tremor-brand-emphasis dark:bg-dark-tremor-brand dark:hover:bg-dark-tremor-brand-emphasis cursor-pointer',
    ].join(' ');

    return (
        <div className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div>
                <div className="mb-3 flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">{ds.title}</h3>
                    <span className="shrink-0 rounded bg-blue-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                        {ds.format}
                    </span>
                </div>
                <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">{ds.description}</p>
                <div className="mb-4 flex flex-wrap gap-1.5">
                    {ds.columns.map(col => (
                        <code key={col} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                            {col}
                        </code>
                    ))}
                </div>
                <p className="mb-4 text-xs text-gray-400 dark:text-gray-500">{ds.rows} · Updated daily</p>
            </div>
            <button
                type="button"
                onClick={handleDownload}
                disabled={status === 'loading'}
                className={btnCls}
            >
                {status === 'loading' && (
                    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeOpacity="0.3" />
                        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                    </svg>
                )}
                {status === 'done' && (
                    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                )}
                {btnLabel}
            </button>
        </div>
    );
}

// ── stock excel section ───────────────────────────────────────────────────────

function StockExcelCard() {
    const [symbol, setSymbol] = useState('');
    const [status, setStatus] = useState<Status>('idle');

    async function handleDownload() {
        const s = symbol.trim().toUpperCase();
        if (!s) return;
        setStatus('loading');
        try {
            const res = await fetch(`/api/download/${s}?proxy=1`);
            if (!res.ok) throw new Error('not found');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${s}_valuation_${today()}.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
            setStatus('done');
            setTimeout(() => setStatus('idle'), 3000);
        } catch {
            setStatus('error');
            setTimeout(() => setStatus('idle'), 4000);
        }
    }

    const btnLabel =
        status === 'loading' ? 'Preparing…'
        : status === 'done'  ? 'Downloaded!'
        : status === 'error' ? 'Not found — retry?'
        : 'Download Excel';

    return (
        <div className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div>
                <div className="mb-3 flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">Stock DCF Valuation Report</h3>
                    <span className="shrink-0 rounded bg-green-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-green-600 dark:bg-green-900/30 dark:text-green-400">
                        XLSX
                    </span>
                </div>
                <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
                    Multi-sheet Excel workbook with FCFE/FCFF DCF models, PE/PB analysis, sector peers and scenario outputs for any listed stock.
                </p>
                <div className="mb-4 flex flex-wrap gap-1.5">
                    {['FCFE model', 'FCFF model', 'PE analysis', 'PB analysis', 'Sector peers', 'Scenarios'].map(col => (
                        <code key={col} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                            {col}
                        </code>
                    ))}
                </div>
                <p className="mb-4 text-xs text-gray-400 dark:text-gray-500">1 file per ticker · ~700 KB</p>
                <div className="mb-4 flex gap-2">
                    <input
                        value={symbol}
                        onChange={e => setSymbol(e.target.value.toUpperCase())}
                        onKeyDown={e => e.key === 'Enter' && handleDownload()}
                        placeholder="e.g. VCB, TCB, HPG"
                        maxLength={10}
                        className="w-40 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    />
                </div>
            </div>
            <button
                type="button"
                onClick={handleDownload}
                disabled={status === 'loading' || !symbol.trim()}
                className={[
                    'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none',
                    !symbol.trim() ? 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                    : status === 'done' ? 'bg-emerald-600 text-white cursor-default'
                    : status === 'error' ? 'bg-red-600 text-white cursor-pointer'
                    : status === 'loading' ? 'bg-blue-500 text-white cursor-wait opacity-80'
                    : 'bg-tremor-brand text-white hover:bg-tremor-brand-emphasis dark:bg-dark-tremor-brand dark:hover:bg-dark-tremor-brand-emphasis cursor-pointer',
                ].join(' ')}
            >
                {status === 'loading' && (
                    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeOpacity="0.3" />
                        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                    </svg>
                )}
                {btnLabel}
            </button>
        </div>
    );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function DownloadsPage() {
    return (
        <main className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
            <header className="mb-10">
                <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-blue-600 dark:text-blue-400">
                    Data Downloads
                </p>
                <h1 className="mb-3 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-gray-50">
                    Download Market Data
                </h1>
                <p className="max-w-2xl text-base text-gray-500 dark:text-gray-400">
                    Free historical and snapshot data from the Vietnam stock market. All CSV files include a UTF-8 BOM for Excel compatibility.
                </p>
            </header>

            {/* market / index data */}
            <section className="mb-10">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                    Market &amp; Index Data
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                    {DATASETS.slice(0, 4).map(ds => <DatasetCard key={ds.id} ds={ds} />)}
                </div>
            </section>

            {/* snapshot data */}
            <section className="mb-10">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                    Daily Snapshot Data
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                    {DATASETS.slice(4).map(ds => <DatasetCard key={ds.id} ds={ds} />)}
                </div>
            </section>

            {/* stock excel */}
            <section className="mb-10">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
                    Per-Stock Report
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                    <StockExcelCard />
                </div>
            </section>

            <p className="text-xs text-gray-400 dark:text-gray-500">
                Data sourced from VCI (Viet Capital Securities) and HOSE/HNX exchange feeds.
                For personal and research use only. See our{' '}
                <Link href="/disclaimer" className="underline hover:text-gray-600 dark:hover:text-gray-300">
                    disclaimer
                </Link>.
            </p>
        </main>
    );
}
