'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';

type DownloadStatus = 'idle' | 'loading' | 'done' | 'error';
type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error';
type ExportFormat = 'CSV' | 'XLSX';

type FlatRow = Record<string, string | number | boolean | null>;

type RawDataset = {
    id: string;
    title: string;
    description: string;
    endpoint: string;
    group: 'market' | 'indices' | 'valuation' | 'reference';
    formats: ExportFormat[];
    filename: (format: ExportFormat) => string;
};

const today = () => new Date().toISOString().slice(0, 10);
const DATE_FIELD_HINT = /(date|time|timestamp|trading|ngay)/i;
const DATE_FIELD_CANDIDATES = ['date', 'tradingDate', 'trading_date', 'time', 'timestamp', 'datetime', 'published_at', 'created_at'];

const RAW_DATASETS: RawDataset[] = [
    {
        id: 'overview-refresh',
        title: 'Market Overview Snapshot',
        description: 'Full combined payload used by homepage widgets.',
        endpoint: '/api/market/overview-refresh',
        group: 'market',
        formats: ['CSV', 'XLSX'],
        filename: (format) => `market_overview_refresh_${today()}.${format.toLowerCase()}`,
    },
    {
        id: 'vci-indices',
        title: 'Realtime Market Indices',
        description: 'VNINDEX, VN30, HNX, UPCOM index payload.',
        endpoint: '/api/market/vci-indices',
        group: 'market',
        formats: ['CSV', 'XLSX'],
        filename: (format) => `market_indices_${today()}.${format.toLowerCase()}`,
    },
    {
        id: 'top-movers-up',
        title: 'Top Movers (Up)',
        description: 'Top gaining stocks snapshot.',
        endpoint: '/api/market/top-movers?type=UP',
        group: 'market',
        formats: ['CSV', 'XLSX'],
        filename: (format) => `top_movers_up_${today()}.${format.toLowerCase()}`,
    },
    {
        id: 'top-movers-down',
        title: 'Top Movers (Down)',
        description: 'Top losing stocks snapshot.',
        endpoint: '/api/market/top-movers?type=DOWN',
        group: 'market',
        formats: ['CSV', 'XLSX'],
        filename: (format) => `top_movers_down_${today()}.${format.toLowerCase()}`,
    },
    {
        id: 'market-news',
        title: 'Market News',
        description: 'Latest market news payload.',
        endpoint: '/api/market/news',
        group: 'market',
        formats: ['CSV', 'XLSX'],
        filename: (format) => `market_news_${today()}.${format.toLowerCase()}`,
    },
    {
        id: 'heatmap-hsx',
        title: 'Heatmap (HSX)',
        description: 'Heatmap payload with sector grouping and price patches.',
        endpoint: '/api/market/heatmap?exchange=HSX&limit=300',
        group: 'market',
        formats: ['CSV', 'XLSX'],
        filename: (format) => `heatmap_hsx_${today()}.${format.toLowerCase()}`,
    },
    {
        id: 'vnindex-history',
        title: 'VNINDEX OHLCV History',
        description: 'Full historical OHLCV series.',
        endpoint: '/api/market/index-history?index=VNINDEX&days=5000',
        group: 'indices',
        formats: ['CSV', 'XLSX'],
        filename: (format) => `vnindex_history_${today()}.${format.toLowerCase()}`,
    },
    {
        id: 'vn30-history',
        title: 'VN30 OHLCV History',
        description: 'Full historical OHLCV series.',
        endpoint: '/api/market/index-history?index=VN30&days=5000',
        group: 'indices',
        formats: ['CSV', 'XLSX'],
        filename: (format) => `vn30_history_${today()}.${format.toLowerCase()}`,
    },
    {
        id: 'hnx-history',
        title: 'HNX OHLCV History',
        description: 'Full historical OHLCV series.',
        endpoint: '/api/market/index-history?index=HNXIndex&days=5000',
        group: 'indices',
        formats: ['CSV', 'XLSX'],
        filename: (format) => `hnx_history_${today()}.${format.toLowerCase()}`,
    },
    {
        id: 'upcom-history',
        title: 'UPCOM OHLCV History',
        description: 'Full historical OHLCV series.',
        endpoint: '/api/market/index-history?index=HNXUpcomIndex&days=5000',
        group: 'indices',
        formats: ['CSV', 'XLSX'],
        filename: (format) => `upcom_history_${today()}.${format.toLowerCase()}`,
    },
    {
        id: 'index-valuation',
        title: 'Index Valuation (PE/PB)',
        description: 'PE/PB valuation chart payload for VNINDEX.',
        endpoint: '/api/market/pe-chart?metric=both&time_frame=ALL',
        group: 'valuation',
        formats: ['CSV', 'XLSX'],
        filename: (format) => `vnindex_valuation_${today()}.${format.toLowerCase()}`,
    },
    {
        id: 'gold',
        title: 'Gold Prices',
        description: 'Gold market payload used by sidebar.',
        endpoint: '/api/market/gold',
        group: 'valuation',
        formats: ['CSV', 'XLSX'],
        filename: (format) => `gold_prices_${today()}.${format.toLowerCase()}`,
    },
    {
        id: 'world-indices',
        title: 'World Indices',
        description: 'Global benchmark indices payload.',
        endpoint: '/api/market/world-indices',
        group: 'reference',
        formats: ['CSV', 'XLSX'],
        filename: (format) => `world_indices_${today()}.${format.toLowerCase()}`,
    },
    {
        id: 'tickers',
        title: 'All Tickers',
        description: 'Complete ticker universe from the platform.',
        endpoint: '/api/tickers',
        group: 'reference',
        formats: ['CSV', 'XLSX'],
        filename: (format) => `tickers_${today()}.${format.toLowerCase()}`,
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

function valueToString(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
}

function flattenObject(input: Record<string, unknown>, prefix = ''): FlatRow {
    const out: FlatRow = {};
    for (const [key, value] of Object.entries(input)) {
        const k = prefix ? `${prefix}.${key}` : key;
        if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            out[k] = value;
            continue;
        }
        if (Array.isArray(value)) {
            out[k] = JSON.stringify(value);
            continue;
        }
        if (typeof value === 'object') {
            Object.assign(out, flattenObject(value as Record<string, unknown>, k));
            continue;
        }
        out[k] = String(value);
    }
    return out;
}

function normalizeToRows(payload: unknown): FlatRow[] {
    if (Array.isArray(payload)) {
        return payload.map((item, idx) => {
            if (item && typeof item === 'object' && !Array.isArray(item)) return flattenObject(item as Record<string, unknown>);
            return { value: valueToString(item), index: idx };
        });
    }

    if (payload && typeof payload === 'object') {
        const obj = payload as Record<string, unknown>;
        const arrayKey = DATE_FIELD_CANDIDATES
            .map((candidate) => Object.keys(obj).find((k) => k.toLowerCase() === candidate.toLowerCase()))
            .find(Boolean)
            || Object.keys(obj).find((k) => Array.isArray(obj[k]));

        if (arrayKey && Array.isArray(obj[arrayKey])) {
            const arr = obj[arrayKey] as unknown[];
            return arr.map((item, idx) => {
                if (item && typeof item === 'object' && !Array.isArray(item)) return flattenObject(item as Record<string, unknown>);
                return { value: valueToString(item), index: idx };
            });
        }

        const isRecordMap = Object.values(obj).every((v) => v && typeof v === 'object' && !Array.isArray(v));
        if (isRecordMap) {
            return Object.entries(obj).map(([key, value]) => ({
                key,
                ...flattenObject(value as Record<string, unknown>),
            }));
        }

        return [flattenObject(obj)];
    }

    return [{ value: valueToString(payload) }];
}

function getColumns(rows: FlatRow[]): string[] {
    const set = new Set<string>();
    for (const row of rows) {
        Object.keys(row).forEach((key) => set.add(key));
    }
    return Array.from(set);
}

function guessColumnType(rows: FlatRow[], column: string): string {
    const sample = rows.map((r) => r[column]).find((v) => v !== null && v !== undefined && v !== '');
    if (sample === undefined) return 'empty';
    if (typeof sample === 'number') return 'number';
    if (typeof sample === 'boolean') return 'boolean';
    if (typeof sample === 'string' && !Number.isNaN(Date.parse(sample))) return 'date/string';
    return 'string';
}

function detectDateField(rows: FlatRow[], columns: string[]): string | null {
    const hinted = columns.find((column) => DATE_FIELD_HINT.test(column));
    if (hinted) return hinted;

    for (const column of columns) {
        const sampleValues = rows
            .map((row) => row[column])
            .filter((v): v is string => typeof v === 'string')
            .slice(0, 20);

        if (sampleValues.length > 0 && sampleValues.filter((v) => !Number.isNaN(Date.parse(v))).length >= Math.ceil(sampleValues.length * 0.7)) {
            return column;
        }
    }

    return null;
}

function filterRowsByDate(rows: FlatRow[], dateField: string | null, fromDate: string, toDate: string): FlatRow[] {
    if (!dateField || (!fromDate && !toDate)) return rows;
    const fromTs = fromDate ? new Date(fromDate).getTime() : Number.NEGATIVE_INFINITY;
    const toTs = toDate ? new Date(`${toDate}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;
    return rows.filter((row) => {
        const value = row[dateField];
        if (typeof value !== 'string' && typeof value !== 'number') return false;
        const ts = new Date(value).getTime();
        if (Number.isNaN(ts)) return false;
        return ts >= fromTs && ts <= toTs;
    });
}

function toCsv(rows: FlatRow[], columns: string[]): string {
    const escape = (value: unknown) => {
        const text = valueToString(value).replace(/"/g, '""');
        return `"${text}"`;
    };
    const header = columns.map((c) => escape(c)).join(',');
    const body = rows.map((row) => columns.map((c) => escape(row[c])).join(','));
    return '\uFEFF' + [header, ...body].join('\n');
}

async function toXlsxBuffer(rows: FlatRow[], columns: string[], sheetName = 'Data'): Promise<ArrayBuffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
    sheet.addRow(columns);
    for (const row of rows) {
        sheet.addRow(columns.map((c) => row[c] ?? ''));
    }
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    sheet.columns = columns.map((col) => ({ header: col, key: col, width: Math.min(Math.max(col.length + 4, 14), 40) }));
    return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

async function exportRows(rows: FlatRow[], columns: string[], format: ExportFormat, filename: string) {
    if (format === 'CSV') {
        const blob = new Blob([toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' });
        triggerBlobDownload(blob, filename);
        return;
    }

    const buffer = await toXlsxBuffer(rows, columns);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    triggerBlobDownload(blob, filename);
}

function DatasetCard({ ds }: { ds: RawDataset }) {
    const [status, setStatus] = useState<DownloadStatus>('idle');
    const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('idle');
    const [rows, setRows] = useState<FlatRow[]>([]);
    const [columns, setColumns] = useState<string[]>([]);
    const [dateField, setDateField] = useState<string | null>(null);
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');

    const filteredRows = useMemo(() => filterRowsByDate(rows, dateField, fromDate, toDate), [rows, dateField, fromDate, toDate]);
    const previewColumns = columns.slice(0, 8);

    const ensurePreview = async (force = false) => {
        if (previewStatus === 'ready' && !force) return { rows, columns };
        setPreviewStatus('loading');
        try {
            const payload = await fetchJson(ds.endpoint);
            const parsedRows = normalizeToRows(payload);
            const parsedColumns = getColumns(parsedRows);
            setRows(parsedRows);
            setColumns(parsedColumns);
            setDateField(detectDateField(parsedRows, parsedColumns));
            setPreviewStatus('ready');
            return { rows: parsedRows, columns: parsedColumns };
        } catch {
            setPreviewStatus('error');
            throw new Error('Failed to load preview');
        }
    };

    const downloadOne = async (format: ExportFormat) => {
        setStatus('loading');
        try {
            const previewData = await ensurePreview();
            const exportRowsSource = previewData?.rows ?? rows;
            const exportColumns = previewData?.columns?.length ? previewData.columns : getColumns(exportRowsSource);
            const exportRowsData = filterRowsByDate(exportRowsSource, dateField, fromDate, toDate);
            await exportRows(exportRowsData, exportColumns, format, ds.filename(format));
            setStatus('done');
            setTimeout(() => setStatus('idle'), 2000);
        } catch {
            setStatus('error');
            setTimeout(() => setStatus('idle'), 3000);
        }
    };

    const label = status === 'loading' ? 'Preparing…' : status === 'done' ? 'Downloaded' : status === 'error' ? 'Retry export' : 'Export';
    const previewLabel = previewStatus === 'loading' ? 'Loading preview…' : previewStatus === 'ready' ? 'Refresh preview' : 'Load preview';

    return (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-3 flex items-start justify-between gap-3">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{ds.title}</h3>
                <span className="rounded bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{ds.formats.join(' / ')}</span>
            </div>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">{ds.description}</p>
            <p className="mb-4 break-all rounded bg-gray-50 px-2 py-1 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-300">{ds.endpoint}</p>

            <div className="mb-4 flex flex-wrap gap-2">
                <button onClick={ensurePreview} disabled={previewStatus === 'loading'} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800">
                    {previewLabel}
                </button>
                {ds.formats.map((format) => (
                    <button key={format} onClick={() => void downloadOne(format)} disabled={status === 'loading' || previewStatus !== 'ready'} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70">
                        {label} {format}
                    </button>
                ))}
            </div>

            {previewStatus === 'ready' && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-700 dark:bg-gray-800/60">
                    <p className="mb-2 font-semibold text-gray-700 dark:text-gray-200">
                        Preview: {rows.length.toLocaleString()} records, {columns.length} columns
                        {dateField ? ` (date field: ${dateField})` : ' (no date field detected)'}
                    </p>

                    <div className="mb-3 grid gap-2 sm:grid-cols-2">
                        <label className="flex flex-col gap-1">
                            <span className="text-gray-600 dark:text-gray-300">From date</span>
                            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} disabled={!dateField} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900" />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-gray-600 dark:text-gray-300">To date</span>
                            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} disabled={!dateField} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900" />
                        </label>
                    </div>

                    <p className="mb-2 text-gray-600 dark:text-gray-300">Records after filter: {filteredRows.length.toLocaleString()}</p>
                    <div className="space-y-1">
                        {previewColumns.map((column) => {
                            const sample = filteredRows.map((row) => row[column]).find((value) => value !== null && value !== undefined && value !== '');
                            return (
                                <p key={column} className="truncate text-gray-700 dark:text-gray-200">
                                    <span className="font-semibold">{column}</span> • {guessColumnType(filteredRows, column)} • sample: {valueToString(sample) || '(empty)'}
                                </p>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function DownloadsPage() {
    const [bulkStatus, setBulkStatus] = useState<DownloadStatus>('idle');
    const [bulkFormat, setBulkFormat] = useState<ExportFormat>('CSV');

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
                const rows = normalizeToRows(payload);
                const columns = getColumns(rows);
                if (bulkFormat === 'CSV') {
                    zip.file(ds.filename('CSV'), toCsv(rows, columns));
                } else {
                    const buffer = await toXlsxBuffer(rows, columns, ds.title);
                    zip.file(ds.filename('XLSX'), buffer);
                }
            }
            const blob = await zip.generateAsync({ type: 'blob' });
            triggerBlobDownload(blob, `datasets_${bulkFormat.toLowerCase()}_${today()}.zip`);
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
                    Xuất dữ liệu website đang dùng (market, indices, valuation, reference) theo định dạng bảng dễ dùng: xem trước schema, lọc theo thời gian, và tải CSV/XLSX.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                    <select
                        value={bulkFormat}
                        onChange={(e) => setBulkFormat(e.target.value as ExportFormat)}
                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                    >
                        <option value="CSV">Bulk ZIP format: CSV</option>
                        <option value="XLSX">Bulk ZIP format: XLSX</option>
                    </select>
                    <button onClick={downloadAllRawZip} disabled={bulkStatus === 'loading'} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70">
                        {bulkStatus === 'loading' ? 'Building ZIP…' : bulkStatus === 'done' ? 'ZIP downloaded' : bulkStatus === 'error' ? 'Retry full ZIP' : `Download full ${bulkFormat} ZIP`}
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
