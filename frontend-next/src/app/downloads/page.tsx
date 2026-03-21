'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import JSZip from 'jszip';

type DownloadStatus = 'idle' | 'loading' | 'done' | 'error';

type RawDataset = {
    id: string;
    title: string;
    description: string;
    endpoint: string;
    group: 'market' | 'indices' | 'valuation' | 'reference';
    format: 'JSON';
    filename: () => string;
};

const today = () => new Date().toISOString().slice(0, 10);

const RAW_DATASETS: RawDataset[] = [
    {
        id: 'overview-refresh',
        title: 'Market Overview Snapshot',
        description: 'Full combined payload used by homepage widgets.',
        endpoint: '/api/market/overview-refresh',
        group: 'market',
        format: 'JSON',
        filename: () => `market_overview_refresh_${today()}.json`,
    },
    {
        id: 'vci-indices',
        title: 'Realtime Market Indices',
        description: 'VNINDEX, VN30, HNX, UPCOM index payload.',
        endpoint: '/api/market/vci-indices',
        group: 'market',
        format: 'JSON',
        filename: () => `market_indices_${today()}.json`,
    },
    {
        id: 'top-movers-up',
        title: 'Top Movers (Up)',
        description: 'Top gaining stocks snapshot.',
        endpoint: '/api/market/top-movers?type=UP',
        group: 'market',
        format: 'JSON',
        filename: () => `top_movers_up_${today()}.json`,
    },
    {
        id: 'top-movers-down',
        title: 'Top Movers (Down)',
        description: 'Top losing stocks snapshot.',
        endpoint: '/api/market/top-movers?type=DOWN',
        group: 'market',
        format: 'JSON',
        filename: () => `top_movers_down_${today()}.json`,
    },
    {
        id: 'market-news',
        title: 'Market News',
        description: 'Latest market news payload.',
        endpoint: '/api/market/news',
        group: 'market',
        format: 'JSON',
        filename: () => `market_news_${today()}.json`,
    },
    {
        id: 'heatmap-hsx',
        title: 'Heatmap (HSX)',
        description: 'Heatmap payload with sector grouping and price patches.',
        endpoint: '/api/market/heatmap?exchange=HSX&limit=300',
        group: 'market',
        format: 'JSON',
        filename: () => `heatmap_hsx_${today()}.json`,
    },
    {
        id: 'vnindex-history',
        title: 'VNINDEX OHLCV History',
        description: 'Full historical OHLCV series.',
        endpoint: '/api/market/index-history?index=VNINDEX&days=5000',
        group: 'indices',
        format: 'JSON',
        filename: () => `vnindex_history_${today()}.json`,
    },
    {
        id: 'vn30-history',
        title: 'VN30 OHLCV History',
        description: 'Full historical OHLCV series.',
        endpoint: '/api/market/index-history?index=VN30&days=5000',
        group: 'indices',
        format: 'JSON',
        filename: () => `vn30_history_${today()}.json`,
    },
    {
        id: 'hnx-history',
        title: 'HNX OHLCV History',
        description: 'Full historical OHLCV series.',
        endpoint: '/api/market/index-history?index=HNXIndex&days=5000',
        group: 'indices',
        format: 'JSON',
        filename: () => `hnx_history_${today()}.json`,
    },
    {
        id: 'upcom-history',
        title: 'UPCOM OHLCV History',
        description: 'Full historical OHLCV series.',
        endpoint: '/api/market/index-history?index=HNXUpcomIndex&days=5000',
        group: 'indices',
        format: 'JSON',
        filename: () => `upcom_history_${today()}.json`,
    },
    {
        id: 'index-valuation',
        title: 'Index Valuation (PE/PB)',
        description: 'PE/PB valuation chart payload for VNINDEX.',
        endpoint: '/api/market/pe-chart?metric=both&time_frame=ALL',
        group: 'valuation',
        format: 'JSON',
        filename: () => `vnindex_valuation_${today()}.json`,
    },
    {
        id: 'gold',
        title: 'Gold Prices',
        description: 'Gold market payload used by sidebar.',
        endpoint: '/api/market/gold',
        group: 'valuation',
        format: 'JSON',
        filename: () => `gold_prices_${today()}.json`,
    },
    {
        id: 'world-indices',
        title: 'World Indices',
        description: 'Global benchmark indices payload.',
        endpoint: '/api/market/world-indices',
        group: 'reference',
        format: 'JSON',
        filename: () => `world_indices_${today()}.json`,
    },
    {
        id: 'tickers',
        title: 'All Tickers',
        description: 'Complete ticker universe from the platform.',
        endpoint: '/api/tickers',
        group: 'reference',
        format: 'JSON',
        filename: () => `tickers_${today()}.json`,
    },
];

async function fetchJson(endpoint: string): Promise<unknown> {
    const res = await fetch(endpoint, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed: ${endpoint}`);
    return res.json();
}

function triggerBlobDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function DatasetCard({ ds }: { ds: RawDataset }) {
    const [status, setStatus] = useState<DownloadStatus>('idle');

    const downloadOne = async () => {
        setStatus('loading');
        try {
            const payload = await fetchJson(ds.endpoint);
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
            triggerBlobDownload(blob, ds.filename());
            setStatus('done');
            setTimeout(() => setStatus('idle'), 2000);
        } catch {
            setStatus('error');
            setTimeout(() => setStatus('idle'), 3000);
        }
    };

    const label = status === 'loading' ? 'Preparing…' : status === 'done' ? 'Downloaded' : status === 'error' ? 'Retry download' : 'Download JSON';

    return (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-3 flex items-start justify-between gap-3">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{ds.title}</h3>
                <span className="rounded bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{ds.format}</span>
            </div>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">{ds.description}</p>
            <p className="mb-4 break-all rounded bg-gray-50 px-2 py-1 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-300">{ds.endpoint}</p>
            <button onClick={downloadOne} disabled={status === 'loading'} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70">
                {label}
            </button>
        </div>
    );
}

export default function DownloadsPage() {
    const [bulkStatus, setBulkStatus] = useState<DownloadStatus>('idle');

    const groups = useMemo(() => ({
        market: RAW_DATASETS.filter(d => d.group === 'market'),
        indices: RAW_DATASETS.filter(d => d.group === 'indices'),
        valuation: RAW_DATASETS.filter(d => d.group === 'valuation'),
        reference: RAW_DATASETS.filter(d => d.group === 'reference'),
    }), []);

    const downloadAllRawZip = async () => {
        setBulkStatus('loading');
        try {
            const zip = new JSZip();
            for (const ds of RAW_DATASETS) {
                const payload = await fetchJson(ds.endpoint);
                zip.file(ds.filename(), JSON.stringify(payload, null, 2));
            }
            const blob = await zip.generateAsync({ type: 'blob' });
            triggerBlobDownload(blob, `raw_datasets_${today()}.zip`);
            setBulkStatus('done');
            setTimeout(() => setBulkStatus('idle'), 2500);
        } catch {
            setBulkStatus('error');
            setTimeout(() => setBulkStatus('idle'), 3500);
        }
    };

    return (
        <main className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
            <section className="mb-10 rounded-2xl border border-gray-200 bg-gradient-to-br from-blue-50 to-white p-8 shadow-sm dark:border-gray-800 dark:from-blue-950/20 dark:to-gray-950">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-300">Data Downloads</p>
                <h1 className="mb-3 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-gray-100">Download full raw datasets</h1>
                <p className="max-w-3xl text-sm text-gray-600 dark:text-gray-400">
                    Tải toàn bộ raw payload mà website đang dùng (market, indices, valuation, reference). Dữ liệu xuất ở định dạng JSON gốc để phục vụ kiểm toán, phân tích và ETL.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                    <button onClick={downloadAllRawZip} disabled={bulkStatus === 'loading'} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70">
                        {bulkStatus === 'loading' ? 'Building ZIP…' : bulkStatus === 'done' ? 'ZIP downloaded' : bulkStatus === 'error' ? 'Retry full ZIP' : 'Download full raw ZIP'}
                    </button>
                    <Link href="/disclaimer" className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
                        Data usage disclaimer
                    </Link>
                </div>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Market snapshots</h2>
                <div className="grid gap-4 sm:grid-cols-2">{groups.market.map(ds => <DatasetCard key={ds.id} ds={ds} />)}</div>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Index history</h2>
                <div className="grid gap-4 sm:grid-cols-2">{groups.indices.map(ds => <DatasetCard key={ds.id} ds={ds} />)}</div>
            </section>

            <section className="mb-10">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Valuation & pricing references</h2>
                <div className="grid gap-4 sm:grid-cols-2">{groups.valuation.map(ds => <DatasetCard key={ds.id} ds={ds} />)}</div>
            </section>

            <section className="mb-8">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">Reference</h2>
                <div className="grid gap-4 sm:grid-cols-2">{groups.reference.map(ds => <DatasetCard key={ds.id} ds={ds} />)}</div>
            </section>
        </main>
    );
}
