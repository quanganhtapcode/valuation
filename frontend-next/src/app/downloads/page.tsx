'use client';

import { useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import {
    fetchJson,
    getColumns,
    normalizeToRows,
    toCsv,
    toMultiSheetXlsxBuf,
    triggerBlobDownload,
    type FlatRow,
} from './exportUtils';

type ExportFormat = 'CSV' | 'XLSX';
type PeriodKind = 'all' | 'year' | 'quarter';
type Status = 'idle' | 'loading' | 'done' | 'error';
type Sheet = { name: string; rows: FlatRow[]; cols: string[] };

const TABLES = [
    { type: 'income', name: 'income_statement', label: 'Income Statement', description: 'Kết quả kinh doanh' },
    { type: 'balance', name: 'balance_sheet', label: 'Balance Sheet', description: 'Bảng cân đối kế toán' },
    { type: 'cashflow', name: 'cash_flow', label: 'Cash Flow', description: 'Lưu chuyển tiền tệ' },
    { type: 'note', name: 'note', label: 'Notes', description: 'Thuyết minh BCTC' },
] as const;

function getYear(row: FlatRow): number | null {
    for (const key of ['year_report', 'yearReport', 'report_year', 'reportYear', 'year', 'period']) {
        const match = String(row[key] ?? '').match(/(?:19|20)\d{2}/);
        if (match) return Number(match[0]);
    }
    return null;
}

function getKind(row: FlatRow): 'year' | 'quarter' | null {
    const raw = Object.entries(row)
        .filter(([key]) => /period_kind|periodKind|quarter_report|quarterReport|report_type|reportType/i.test(key))
        .map(([, value]) => String(value ?? '').toLowerCase())
        .join(' ');
    if (/quarter|quý|q[1-4]/.test(raw)) return 'quarter';
    if (/year|annual|năm/.test(raw) || raw === '0') return 'year';
    return null;
}

function filterRows(rows: FlatRow[], fromYear: number, toYear: number, periodKind: PeriodKind) {
    return rows.filter(row => {
        const year = getYear(row);
        if (year !== null && (year < fromYear || year > toYear)) return false;
        if (periodKind !== 'all') {
            const kind = getKind(row);
            if (kind !== null && kind !== periodKind) return false;
        }
        return true;
    });
}

function renameColumns(rows: FlatRow[], labels: Record<string, string>): FlatRow[] {
    const used = new Set<string>();
    const names = new Map<string, string>();
    const keys = Array.from(new Set(rows.flatMap(row => Object.keys(row))));
    keys.forEach(key => {
        const base = labels[key.toLowerCase()] ?? key;
        let name = base;
        if (used.has(name)) name = `${base} (${key})`;
        used.add(name);
        names.set(key, name);
    });
    return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [names.get(key) ?? labels[key.toLowerCase()] ?? key, value])));
}

function Icon({ type }: { type: 'download' | 'check' | 'spin' }) {
    if (type === 'spin') return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />;
    if (type === 'check') return <span className="text-base">✓</span>;
    return <span className="text-base">↓</span>;
}

export default function DownloadsPage() {
    const currentYear = new Date().getFullYear();
    const years = useMemo(() => Array.from({ length: currentYear - 2010 + 1 }, (_, i) => currentYear - i), [currentYear]);
    const [query, setQuery] = useState('');
    const [symbol, setSymbol] = useState('');
    const [tickers, setTickers] = useState<Array<{ symbol: string; name: string; exchange: string }>>([]);
    const [fromYear, setFromYear] = useState(2020);
    const [toYear, setToYear] = useState(currentYear);
    const [periodKind, setPeriodKind] = useState<PeriodKind>('all');
    const [format, setFormat] = useState<ExportFormat>('XLSX');
    const [status, setStatus] = useState<Status>('idle');
    const [rowCount, setRowCount] = useState<number | null>(null);

    useEffect(() => {
        fetch('/api/tickers', { cache: 'force-cache' })
            .then(response => response.json())
            .then(payload => setTickers((payload as { tickers?: typeof tickers }).tickers ?? payload))
            .catch(() => {});
    }, []);

    const suggestions = useMemo(() => {
        const q = query.trim().toUpperCase();
        if (!q) return [];
        return tickers.filter(t => t.symbol.startsWith(q) || t.name?.toUpperCase().includes(q)).slice(0, 8);
    }, [query, tickers]);

    const download = async () => {
        const selected = query.trim().toUpperCase();
        if (!selected || fromYear > toYear) return;
        setSymbol(selected);
        setStatus('loading');
        try {
            const [fieldPayload, ...tablePayloads] = await Promise.all([
                fetchJson('/api/financial-field-codes'),
                ...TABLES.map(table => fetchJson(`/api/financial-report/${selected}?type=${table.type}&period=all&limit=1000`)),
            ]);
            const labels: Record<string, string> = {};
            Object.values(fieldPayload as Record<string, Array<{ field?: string; titleEn?: string }>>).flat().forEach(entry => {
                if (entry.field && entry.titleEn && entry.titleEn !== entry.field) labels[entry.field.toLowerCase()] = entry.titleEn;
            });
            const sheets: Sheet[] = TABLES.map((table, index) => {
                const rows = renameColumns(filterRows(normalizeToRows(tablePayloads[index]), fromYear, toYear, periodKind), labels);
                return { name: table.name, rows, cols: getColumns(rows) };
            }).filter(sheet => sheet.rows.length > 0);
            const totalRows = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
            if (!totalRows) throw new Error('No data');
            setRowCount(totalRows);
            const baseName = `${selected}_financials_${fromYear}-${toYear}_${periodKind}`;
            if (format === 'XLSX') {
                const blob = new Blob([await toMultiSheetXlsxBuf(sheets)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                triggerBlobDownload(blob, `${baseName}.xlsx`);
            } else {
                const zip = new JSZip();
                sheets.forEach(sheet => zip.file(`${sheet.name}.csv`, toCsv(sheet.rows, sheet.cols)));
                triggerBlobDownload(await zip.generateAsync({ type: 'blob' }), `${baseName}.zip`);
            }
            setStatus('done');
            setTimeout(() => setStatus('idle'), 2500);
        } catch {
            setStatus('error');
            setTimeout(() => setStatus('idle'), 3500);
        }
    };

    return (
        <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
            <div className="mx-auto max-w-5xl p-4 md:p-8">
                <header className="mb-8">
                    <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">Data export</p>
                    <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Tải BCTC</h1>
                    <p className="mt-3 max-w-2xl text-sm text-slate-600 dark:text-slate-300">Xuất 4 bảng BCTC theo mã cổ phiếu, khoảng năm và kỳ báo cáo. Tên cột dùng tiếng Anh từ metadata của Vietcap.</p>
                </header>

                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-7">
                    <div className="grid gap-4 md:grid-cols-2">
                        <label className="relative text-sm font-semibold">Mã cổ phiếu
                            <input value={query} onChange={e => { setQuery(e.target.value.toUpperCase()); setSymbol(''); }} placeholder="Ví dụ: VCB, FPT, VNM" className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-normal outline-none ring-blue-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950" />
                            {suggestions.length > 0 && !symbol && <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">{suggestions.map(t => <button key={t.symbol} type="button" onClick={() => { setQuery(t.symbol); setSymbol(t.symbol); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"><b>{t.symbol}</b><span className="truncate text-xs text-slate-500">{t.name}</span><span className="ml-auto text-[10px] text-slate-400">{t.exchange}</span></button>)}</div>}
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            <label className="text-sm font-semibold">Từ năm<select value={fromYear} onChange={e => setFromYear(Number(e.target.value))} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 font-normal dark:border-slate-700 dark:bg-slate-950">{years.map(year => <option key={year}>{year}</option>)}</select></label>
                            <label className="text-sm font-semibold">Đến năm<select value={toYear} onChange={e => setToYear(Number(e.target.value))} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 font-normal dark:border-slate-700 dark:bg-slate-950">{years.map(year => <option key={year}>{year}</option>)}</select></label>
                        </div>
                        <label className="text-sm font-semibold">Kỳ báo cáo<select value={periodKind} onChange={e => setPeriodKind(e.target.value as PeriodKind)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 font-normal dark:border-slate-700 dark:bg-slate-950"><option value="all">Quý và năm</option><option value="year">Chỉ báo cáo năm</option><option value="quarter">Chỉ báo cáo quý</option></select></label>
                        <label className="text-sm font-semibold">Định dạng<select value={format} onChange={e => setFormat(e.target.value as ExportFormat)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 font-normal dark:border-slate-700 dark:bg-slate-950"><option value="XLSX">Excel — 4 sheets</option><option value="CSV">CSV — ZIP 4 files</option></select></label>
                    </div>
                    <button type="button" onClick={() => void download()} disabled={!query.trim() || fromYear > toYear || status === 'loading'} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{status === 'loading' ? <><Icon type="spin" />Đang chuẩn bị file…</> : status === 'done' ? <><Icon type="check" />Đã tải</> : <><Icon type="download" />Tải 4 bảng BCTC</>}</button>
                    {status === 'error' && <p className="mt-3 text-center text-xs font-medium text-red-600">Không có dữ liệu hoặc không thể tải BCTC cho mã này.</p>}
                    {rowCount && status !== 'loading' && <p className="mt-3 text-center text-xs text-slate-500">Lần tải gần nhất: {rowCount.toLocaleString()} dòng.</p>}
                </section>

                <section className="mt-6 grid gap-3 sm:grid-cols-2">
                    {TABLES.map(table => <div key={table.type} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p className="text-sm font-bold">{table.label}</p><p className="mt-1 text-xs text-slate-500">{table.description} · sheet/file riêng</p></div>)}
                </section>
                <p className="mt-8 text-xs text-slate-400">CSV nhẹ hơn nhưng được đóng gói thành ZIP vì CSV không hỗ trợ nhiều sheet. Excel có 4 sheet trong cùng một file.</p>
            </div>
        </main>
    );
}
