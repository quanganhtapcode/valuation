'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';

// ── Types ──────────────────────────────────────────────────────────────────────

type DownloadStatus = 'idle' | 'loading' | 'done' | 'error';
type PreviewStatus  = 'idle' | 'loading' | 'ready' | 'error';
type ExportFormat   = 'CSV' | 'XLSX';
type GroupId        = 'ALL' | 'market' | 'indices' | 'valuation' | 'reference';

type FlatRow = Record<string, string | number | boolean | null>;

type RawDataset = {
    id: string;
    title: string;
    description: string;
    endpoint: string;
    group: Exclude<GroupId, 'ALL'>;
    formats: ExportFormat[];
    filename: (format: ExportFormat) => string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);
const DATE_FIELD_HINT       = /(date|time|timestamp|trading|ngay)/i;
const DATE_FIELD_CANDIDATES = ['date', 'tradingDate', 'trading_date', 'time', 'timestamp', 'datetime', 'published_at', 'created_at'];

// ── Dataset config ────────────────────────────────────────────────────────────

const RAW_DATASETS: RawDataset[] = [
    {
        id: 'overview-refresh',
        title: 'Market Overview Snapshot',
        description: 'Full combined payload used by homepage widgets.',
        endpoint: '/api/market/overview-refresh',
        group: 'market',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `market_overview_refresh_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'vci-indices',
        title: 'Realtime Market Indices',
        description: 'VNINDEX, VN30, HNX, UPCOM index payload.',
        endpoint: '/api/market/vci-indices',
        group: 'market',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `market_indices_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'top-movers-up',
        title: 'Top Movers (Up)',
        description: 'Top gaining stocks snapshot.',
        endpoint: '/api/market/top-movers?type=UP',
        group: 'market',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `top_movers_up_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'top-movers-down',
        title: 'Top Movers (Down)',
        description: 'Top losing stocks snapshot.',
        endpoint: '/api/market/top-movers?type=DOWN',
        group: 'market',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `top_movers_down_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'market-news',
        title: 'Market News',
        description: 'Latest market news payload.',
        endpoint: '/api/market/news',
        group: 'market',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `market_news_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'heatmap-hsx',
        title: 'Heatmap (HSX)',
        description: 'Heatmap payload with sector grouping and price patches.',
        endpoint: '/api/market/heatmap?exchange=HSX&limit=300',
        group: 'market',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `heatmap_hsx_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'vnindex-history',
        title: 'VNINDEX OHLCV History',
        description: 'Full historical OHLCV series.',
        endpoint: '/api/market/index-history?index=VNINDEX&days=5000',
        group: 'indices',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `vnindex_history_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'vn30-history',
        title: 'VN30 OHLCV History',
        description: 'Full historical OHLCV series.',
        endpoint: '/api/market/index-history?index=VN30&days=5000',
        group: 'indices',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `vn30_history_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'hnx-history',
        title: 'HNX OHLCV History',
        description: 'Full historical OHLCV series.',
        endpoint: '/api/market/index-history?index=HNXIndex&days=5000',
        group: 'indices',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `hnx_history_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'upcom-history',
        title: 'UPCOM OHLCV History',
        description: 'Full historical OHLCV series.',
        endpoint: '/api/market/index-history?index=HNXUpcomIndex&days=5000',
        group: 'indices',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `upcom_history_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'index-valuation',
        title: 'Index Valuation (PE/PB)',
        description: 'PE/PB valuation chart payload for VNINDEX.',
        endpoint: '/api/market/pe-chart?metric=both&time_frame=ALL',
        group: 'valuation',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `vnindex_valuation_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'gold',
        title: 'Gold Prices',
        description: 'Gold market payload used by sidebar.',
        endpoint: '/api/market/gold',
        group: 'valuation',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `gold_prices_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'world-indices',
        title: 'World Indices',
        description: 'Global benchmark indices payload.',
        endpoint: '/api/market/world-indices',
        group: 'reference',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `world_indices_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'tickers',
        title: 'All Tickers',
        description: 'Complete ticker universe from the platform.',
        endpoint: '/api/tickers',
        group: 'reference',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `tickers_${today()}.${f.toLowerCase()}`,
    },
];

// ── Group config ──────────────────────────────────────────────────────────────

const GROUPS: { id: GroupId; label: string; color: string; bg: string }[] = [
    { id: 'ALL',        label: 'Tất cả',       color: 'text-slate-700 dark:text-slate-200',    bg: 'bg-slate-100 dark:bg-slate-700' },
    { id: 'market',     label: 'Market',        color: 'text-blue-700 dark:text-blue-300',      bg: 'bg-blue-50 dark:bg-blue-900/30' },
    { id: 'indices',    label: 'Lịch sử Index', color: 'text-violet-700 dark:text-violet-300',  bg: 'bg-violet-50 dark:bg-violet-900/30' },
    { id: 'valuation',  label: 'Valuation',     color: 'text-emerald-700 dark:text-emerald-300',bg: 'bg-emerald-50 dark:bg-emerald-900/30' },
    { id: 'reference',  label: 'Reference',     color: 'text-amber-700 dark:text-amber-300',    bg: 'bg-amber-50 dark:bg-amber-900/30' },
];

function groupConfig(id: GroupId) {
    return GROUPS.find(g => g.id === id) ?? GROUPS[0];
}

function GroupBadge({ group }: { group: Exclude<GroupId, 'ALL'> }) {
    const cfg = groupConfig(group);
    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.color} ${cfg.bg}`}>
            {cfg.label}
        </span>
    );
}

// ── Data utilities ────────────────────────────────────────────────────────────

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
        if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') { out[k] = value; continue; }
        if (Array.isArray(value)) { out[k] = JSON.stringify(value); continue; }
        if (typeof value === 'object') { Object.assign(out, flattenObject(value as Record<string, unknown>, k)); continue; }
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
            .map(c => Object.keys(obj).find(k => k.toLowerCase() === c.toLowerCase()))
            .find(Boolean)
            || Object.keys(obj).find(k => Array.isArray(obj[k]));
        if (arrayKey && Array.isArray(obj[arrayKey])) {
            return (obj[arrayKey] as unknown[]).map((item, idx) => {
                if (item && typeof item === 'object' && !Array.isArray(item)) return flattenObject(item as Record<string, unknown>);
                return { value: valueToString(item), index: idx };
            });
        }
        const isRecordMap = Object.values(obj).every(v => v && typeof v === 'object' && !Array.isArray(v));
        if (isRecordMap) return Object.entries(obj).map(([key, value]) => ({ key, ...flattenObject(value as Record<string, unknown>) }));
        return [flattenObject(obj)];
    }
    return [{ value: valueToString(payload) }];
}

function getColumns(rows: FlatRow[]): string[] {
    const set = new Set<string>();
    rows.forEach(r => Object.keys(r).forEach(k => set.add(k)));
    return Array.from(set);
}

function guessColumnType(rows: FlatRow[], column: string): string {
    const sample = rows.map(r => r[column]).find(v => v !== null && v !== undefined && v !== '');
    if (sample === undefined) return 'empty';
    if (typeof sample === 'number') return 'number';
    if (typeof sample === 'boolean') return 'boolean';
    if (typeof sample === 'string' && !Number.isNaN(Date.parse(sample))) return 'date';
    return 'string';
}

function detectDateField(rows: FlatRow[], columns: string[]): string | null {
    const hinted = columns.find(c => DATE_FIELD_HINT.test(c));
    if (hinted) return hinted;
    for (const column of columns) {
        const samples = rows.map(r => r[column]).filter((v): v is string => typeof v === 'string').slice(0, 20);
        if (samples.length > 0 && samples.filter(v => !Number.isNaN(Date.parse(v))).length >= Math.ceil(samples.length * 0.7)) return column;
    }
    return null;
}

function filterRowsByDate(rows: FlatRow[], dateField: string | null, fromDate: string, toDate: string): FlatRow[] {
    if (!dateField || (!fromDate && !toDate)) return rows;
    const fromTs = fromDate ? new Date(fromDate).getTime() : Number.NEGATIVE_INFINITY;
    const toTs   = toDate   ? new Date(`${toDate}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;
    return rows.filter(row => {
        const value = row[dateField];
        if (typeof value !== 'string' && typeof value !== 'number') return false;
        const ts = new Date(value).getTime();
        return !Number.isNaN(ts) && ts >= fromTs && ts <= toTs;
    });
}

function toCsv(rows: FlatRow[], columns: string[]): string {
    const escape = (v: unknown) => `"${valueToString(v).replace(/"/g, '""')}"`;
    return '\uFEFF' + [columns.map(c => escape(c)).join(','), ...rows.map(r => columns.map(c => escape(r[c])).join(','))].join('\n');
}

async function toXlsxBuffer(rows: FlatRow[], columns: string[], sheetName = 'Data'): Promise<ArrayBuffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(sheetName.slice(0, 31));
    ws.addRow(columns);
    rows.forEach(r => ws.addRow(columns.map(c => r[c] ?? '')));
    ws.getRow(1).font = { bold: true };
    ws.columns = columns.map(col => ({ header: col, key: col, width: Math.min(Math.max(col.length + 4, 14), 40) }));
    return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

async function exportRows(rows: FlatRow[], columns: string[], format: ExportFormat, filename: string) {
    if (format === 'CSV') {
        triggerBlobDownload(new Blob([toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' }), filename);
        return;
    }
    const buffer = await toXlsxBuffer(rows, columns);
    triggerBlobDownload(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconDownload({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
    );
}

function IconCheck({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
    );
}

function IconSpinner({ className }: { className?: string }) {
    return (
        <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
    );
}

function IconChevron({ className, open }: { className?: string; open: boolean }) {
    return (
        <svg className={`transition-transform ${open ? 'rotate-180' : ''} ${className}`} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
    );
}

// ── Download button ───────────────────────────────────────────────────────────

function DownloadBtn({
    format, status, disabled, onClick,
}: {
    format: ExportFormat;
    status: DownloadStatus;
    disabled: boolean;
    onClick: () => void;
}) {
    const isLoading = status === 'loading';
    const isDone    = status === 'done';
    const isError   = status === 'error';

    const base = 'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all focus:outline-none';
    const styles = {
        CSV: isError
            ? `${base} bg-red-50 border border-red-300 text-red-600 dark:bg-red-900/20 dark:border-red-700 dark:text-red-400`
            : isDone
            ? `${base} bg-emerald-50 border border-emerald-300 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-400`
            : `${base} border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400`,
        XLSX: isError
            ? `${base} bg-red-50 border border-red-300 text-red-600 dark:bg-red-900/20 dark:border-red-700 dark:text-red-400`
            : isDone
            ? `${base} bg-emerald-50 border border-emerald-300 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-400`
            : `${base} bg-blue-600 text-white hover:bg-blue-700`,
    };

    return (
        <button onClick={onClick} disabled={disabled || isLoading} className={`${styles[format]} disabled:opacity-50 disabled:cursor-not-allowed`}>
            {isLoading
                ? <IconSpinner className="w-4 h-4" />
                : isDone
                ? <IconCheck className="w-4 h-4" />
                : <IconDownload className="w-4 h-4" />}
            {isLoading ? 'Đang tải…' : isDone ? 'Xong!' : isError ? 'Thử lại' : format}
        </button>
    );
}

// ── Dataset card ──────────────────────────────────────────────────────────────

function DatasetCard({ ds }: { ds: RawDataset }) {
    const [csvStatus,  setCsvStatus]  = useState<DownloadStatus>('idle');
    const [xlsxStatus, setXlsxStatus] = useState<DownloadStatus>('idle');
    const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('idle');
    const [rows,    setRows]    = useState<FlatRow[]>([]);
    const [columns, setColumns] = useState<string[]>([]);
    const [dateField, setDateField] = useState<string | null>(null);
    const [fromDate, setFromDate]   = useState('');
    const [toDate,   setToDate]     = useState('');
    const [previewOpen, setPreviewOpen] = useState(false);

    const filteredRows   = useMemo(() => filterRowsByDate(rows, dateField, fromDate, toDate), [rows, dateField, fromDate, toDate]);
    const previewColumns = columns.slice(0, 8);

    const ensureData = async () => {
        if (previewStatus === 'ready') return { rows, columns };
        setPreviewStatus('loading');
        try {
            const payload     = await fetchJson(ds.endpoint);
            const parsedRows  = normalizeToRows(payload);
            const parsedCols  = getColumns(parsedRows);
            setRows(parsedRows);
            setColumns(parsedCols);
            setDateField(detectDateField(parsedRows, parsedCols));
            setPreviewStatus('ready');
            return { rows: parsedRows, columns: parsedCols };
        } catch {
            setPreviewStatus('error');
            throw new Error('load failed');
        }
    };

    const handleDownload = async (format: ExportFormat) => {
        const setStatus = format === 'CSV' ? setCsvStatus : setXlsxStatus;
        setStatus('loading');
        try {
            const data = await ensureData();
            const r    = data?.rows ?? rows;
            const c    = data?.columns?.length ? data.columns : getColumns(r);
            const fr   = filterRowsByDate(r, dateField, fromDate, toDate);
            await exportRows(fr, c, format, ds.filename(format));
            setStatus('done');
            setTimeout(() => setStatus('idle'), 2500);
        } catch {
            setStatus('error');
            setTimeout(() => setStatus('idle'), 3000);
        }
    };

    const handlePreviewToggle = async () => {
        if (!previewOpen) {
            setPreviewOpen(true);
            try { await ensureData(); } catch { /* error handled in state */ }
        } else {
            setPreviewOpen(false);
        }
    };

    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            {/* Card header */}
            <div className="px-5 pt-4 pb-3">
                <div className="flex items-start justify-between gap-3 mb-1">
                    <p className="font-semibold text-slate-900 dark:text-slate-100 leading-snug">{ds.title}</p>
                    <GroupBadge group={ds.group} />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{ds.description}</p>

                {/* Endpoint pill */}
                <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 px-3 py-1.5 mb-4">
                    <svg className="w-3 h-3 text-slate-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
                    </svg>
                    <code className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{ds.endpoint}</code>
                </div>

                {/* Download buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                    {ds.formats.includes('CSV') && (
                        <DownloadBtn format="CSV"  status={csvStatus}  disabled={false} onClick={() => void handleDownload('CSV')} />
                    )}
                    {ds.formats.includes('XLSX') && (
                        <DownloadBtn format="XLSX" status={xlsxStatus} disabled={false} onClick={() => void handleDownload('XLSX')} />
                    )}
                    <button
                        onClick={() => void handlePreviewToggle()}
                        className="ml-auto flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                    >
                        {previewStatus === 'loading'
                            ? <><IconSpinner className="w-3.5 h-3.5" /> Đang tải…</>
                            : <><IconChevron className="w-3.5 h-3.5" open={previewOpen} /> Xem trước</>}
                    </button>
                </div>
            </div>

            {/* Preview panel */}
            {previewOpen && (
                <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 px-5 py-4">
                    {previewStatus === 'error' ? (
                        <p className="text-xs text-red-500">Không tải được dữ liệu.</p>
                    ) : previewStatus === 'loading' ? (
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                            <IconSpinner className="w-4 h-4" /> Đang tải preview…
                        </div>
                    ) : (
                        <>
                            {/* Stats row */}
                            <div className="flex flex-wrap items-center gap-3 mb-3">
                                <span className="rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                                    {rows.length.toLocaleString()} dòng
                                </span>
                                <span className="rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                                    {columns.length} cột
                                </span>
                                {dateField && (
                                    <span className="rounded-md bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 px-2.5 py-1 text-xs text-blue-700 dark:text-blue-300">
                                        date: {dateField}
                                    </span>
                                )}
                            </div>

                            {/* Date filter */}
                            {dateField && (
                                <div className="flex flex-wrap gap-2 mb-3">
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-[10px] text-slate-400 uppercase tracking-wide">Từ ngày</span>
                                        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                                            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-[10px] text-slate-400 uppercase tracking-wide">Đến ngày</span>
                                        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                                            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                    </div>
                                    {(fromDate || toDate) && (
                                        <div className="flex flex-col justify-end">
                                            <span className="text-[10px] text-slate-400 mb-0.5">Sau lọc</span>
                                            <span className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                                                {filteredRows.length.toLocaleString()} dòng
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Schema preview table */}
                            <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                                            <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Cột</th>
                                            <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide w-20">Kiểu</th>
                                            <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Mẫu</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {previewColumns.map(col => {
                                            const sample = filteredRows.map(r => r[col]).find(v => v !== null && v !== undefined && v !== '');
                                            return (
                                                <tr key={col} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                                    <td className="px-3 py-2 font-mono font-medium text-slate-800 dark:text-slate-200">{col}</td>
                                                    <td className="px-3 py-2 text-slate-400 dark:text-slate-500">{guessColumnType(filteredRows, col)}</td>
                                                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400 truncate max-w-[200px]">{valueToString(sample) || <span className="italic text-slate-300 dark:text-slate-600">(trống)</span>}</td>
                                                </tr>
                                            );
                                        })}
                                        {columns.length > 8 && (
                                            <tr>
                                                <td colSpan={3} className="px-3 py-2 text-slate-400 dark:text-slate-500 italic">
                                                    + {columns.length - 8} cột nữa…
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DownloadsPage() {
    const [activeGroup, setActiveGroup] = useState<GroupId>('ALL');
    const [bulkStatus, setBulkStatus]   = useState<DownloadStatus>('idle');
    const [bulkFormat, setBulkFormat]   = useState<ExportFormat>('CSV');

    const counts = useMemo(() => {
        const c: Record<string, number> = { ALL: RAW_DATASETS.length };
        RAW_DATASETS.forEach(d => { c[d.group] = (c[d.group] ?? 0) + 1; });
        return c;
    }, []);

    const filtered = activeGroup === 'ALL' ? RAW_DATASETS : RAW_DATASETS.filter(d => d.group === activeGroup);

    const downloadAllZip = async () => {
        setBulkStatus('loading');
        try {
            const zip = new JSZip();
            for (const ds of RAW_DATASETS) {
                const payload = await fetchJson(ds.endpoint);
                const r = normalizeToRows(payload);
                const c = getColumns(r);
                if (bulkFormat === 'CSV') {
                    zip.file(ds.filename('CSV'), toCsv(r, c));
                } else {
                    zip.file(ds.filename('XLSX'), await toXlsxBuffer(r, c, ds.title));
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
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
            <div className="max-w-[1400px] mx-auto p-4 md:p-6">

                {/* Header */}
                <div className="mb-6">
                    <h1 className="text-3xl md:text-4xl font-bold leading-tight tracking-tight">
                        Tải <span className="text-blue-600 dark:text-blue-400">Dữ Liệu</span>
                    </h1>
                    <div className="w-24 h-1 bg-blue-500 rounded mt-2" />
                    <p className="text-slate-600 dark:text-slate-300 mt-3 text-sm max-w-2xl">
                        Xuất toàn bộ dữ liệu website đang dùng theo định dạng CSV hoặc XLSX. Xem trước schema, lọc theo thời gian, hoặc tải bulk ZIP.
                    </p>
                </div>

                {/* Bulk download bar */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-4 mb-5 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <svg className="w-5 h-5 text-blue-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M8 2a1 1 0 000 2h2a1 1 0 100-2H8z" /><path d="M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM15 11h2a1 1 0 110 2h-2v-2z" />
                        </svg>
                        <div>
                            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Tải toàn bộ {RAW_DATASETS.length} datasets dạng ZIP</p>
                            <p className="text-xs text-slate-400 dark:text-slate-500">Đóng gói tất cả thành một file ZIP</p>
                        </div>
                    </div>
                    <select
                        value={bulkFormat}
                        onChange={e => setBulkFormat(e.target.value as ExportFormat)}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="CSV">ZIP / CSV</option>
                        <option value="XLSX">ZIP / XLSX</option>
                    </select>
                    <button
                        onClick={() => void downloadAllZip()}
                        disabled={bulkStatus === 'loading'}
                        className="flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    >
                        {bulkStatus === 'loading' ? <><IconSpinner className="w-4 h-4" />Đang đóng gói…</> :
                         bulkStatus === 'done'    ? <><IconCheck   className="w-4 h-4" />Đã tải!</> :
                         bulkStatus === 'error'   ? 'Thử lại' :
                         <><IconDownload className="w-4 h-4" />Tải ZIP {bulkFormat}</>}
                    </button>
                    <Link href="/disclaimer"
                        className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        Disclaimer
                    </Link>
                </div>

                {/* Group filter tabs */}
                <div className="flex flex-wrap gap-2 mb-5">
                    {GROUPS.map(g => (
                        <button
                            key={g.id}
                            onClick={() => setActiveGroup(g.id)}
                            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors border ${
                                activeGroup === g.id
                                    ? 'border-blue-500 bg-blue-600 text-white'
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-blue-400'
                            }`}
                        >
                            {g.label}
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                                activeGroup === g.id ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                            }`}>
                                {counts[g.id] ?? 0}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Dataset grid */}
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {filtered.map(ds => <DatasetCard key={ds.id} ds={ds} />)}
                </div>

                {/* Footer */}
                <p className="mt-6 text-xs text-slate-400 dark:text-slate-500">
                    Dữ liệu được lấy trực tiếp từ các endpoint API của hệ thống · Cập nhật realtime hoặc theo cache TTL
                </p>
            </div>
        </div>
    );
}
