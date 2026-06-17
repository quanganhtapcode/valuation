'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import JSZip from 'jszip';

import {
    GROUP_LABELS,
    GROUP_STYLES,
    MACRO_BADGE_FA,
    MACRO_ECO_CARDS,
    MACRO_FA_CARDS,
    MACRO_HISTORY_CARDS,
    MARKET_DATASETS,
    MARKET_GROUPS,
    STOCK_DATASETS,
    slugifyForFilename,
    today,
    type DownloadStatus,
    type ExportFormat,
    type FlatRow,
    type MainTab,
    type MarketGroupId,
} from './config';
import {
    detectDateField,
    doExport,
    fetchJson,
    filterByDate,
    getColumns,
    guessType,
    normalizeToRows,
    toCsv,
    toXlsxBuf,
    triggerBlobDownload,
    valueToString,
} from './exportUtils';

// ── Icons ─────────────────────────────────────────────────────────────────────

const IcoDownload = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
);
const IcoCheck = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
);
const IcoSpin = ({ className }: { className?: string }) => (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
);
const IcoChevron = ({ className, open }: { className?: string; open: boolean }) => (
    <svg className={`transition-transform duration-200 ${open ? 'rotate-180' : ''} ${className}`} viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
);

// ── Shared download button ────────────────────────────────────────────────────

function DlBtn({ format, status, onClick }: { format: ExportFormat; status: DownloadStatus; onClick: () => void }) {
    const busy = status === 'loading';
    const done = status === 'done';
    const err  = status === 'error';
    const base = 'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-all focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed';
    const cls  = format === 'XLSX'
        ? `${base} ${done ? 'bg-emerald-600 text-white' : err ? 'bg-red-500 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`
        : `${base} ${done ? 'border border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : err ? 'border border-red-400 text-red-500' : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400'}`;
    return (
        <button onClick={onClick} disabled={busy} className={cls}>
            {busy ? <IcoSpin className="w-3.5 h-3.5" /> : done ? <IcoCheck className="w-3.5 h-3.5" /> : <IcoDownload className="w-3.5 h-3.5" />}
            {busy ? 'Đang tải…' : done ? 'Xong!' : err ? 'Lỗi' : format}
        </button>
    );
}

// ── Preview panel ─────────────────────────────────────────────────────────────

function PreviewPanel({ rows, cols, dateField }: { rows: FlatRow[]; cols: string[]; dateField: string | null }) {
    const [from, setFrom] = useState('');
    const [to, setTo]     = useState('');
    const filtered = useMemo(() => filterByDate(rows, dateField, from, to), [rows, dateField, from, to]);
    const preview  = cols.slice(0, 8);

    return (
        <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 px-5 py-4 space-y-3">
            {/* Stats */}
            <div className="flex flex-wrap gap-2">
                <span className="rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200">{rows.length.toLocaleString()} dòng</span>
                <span className="rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200">{cols.length} cột</span>
                {dateField && <span className="rounded-md bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 px-2.5 py-1 text-xs text-blue-700 dark:text-blue-300">date: {dateField}</span>}
            </div>
            {/* Date filter */}
            {dateField && (
                <div className="flex flex-wrap gap-2 items-end">
                    {[['Từ ngày', from, setFrom], ['Đến ngày', to, setTo]].map(([label, val, set]) => (
                        <div key={label as string} className="flex flex-col gap-0.5">
                            <span className="text-[10px] text-slate-400 uppercase tracking-wide">{label as string}</span>
                            <input type="date" value={val as string} onChange={e => (set as (v: string) => void)(e.target.value)}
                                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                    ))}
                    {(from || to) && (
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] text-slate-400 uppercase tracking-wide">Sau lọc</span>
                            <span className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">{filtered.length.toLocaleString()} dòng</span>
                        </div>
                    )}
                </div>
            )}
            {/* Schema table */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                            <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Cột</th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide w-16">Kiểu</th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Mẫu</th>
                        </tr>
                    </thead>
                    <tbody>
                        {preview.map(col => {
                            const sample = filtered.map(r => r[col]).find(v => v !== null && v !== undefined && v !== '');
                            return (
                                <tr key={col} className="border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-white dark:hover:bg-slate-900/50">
                                    <td className="px-3 py-1.5 font-mono text-slate-800 dark:text-slate-200">{col}</td>
                                    <td className="px-3 py-1.5 text-slate-400">{guessType(filtered, col)}</td>
                                    <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400 truncate max-w-[180px]">{valueToString(sample) || <span className="italic text-slate-300 dark:text-slate-600">—</span>}</td>
                                </tr>
                            );
                        })}
                        {cols.length > 8 && (
                            <tr><td colSpan={3} className="px-3 py-1.5 text-slate-400 italic">+ {cols.length - 8} cột nữa…</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── Generic dataset card (used for both market + stock) ───────────────────────

function DatasetCard({
    title, description, endpoint, filename, badge, badgeColor, notes, formats = ['CSV', 'XLSX'],
}: {
    title: string; description: string; endpoint: string;
    filename: (f: ExportFormat) => string;
    badge: string; badgeColor: string; notes?: string;
    formats?: ExportFormat[];
}) {
    const [csvStatus,  setCsvStatus]  = useState<DownloadStatus>('idle');
    const [xlsxStatus, setXlsxStatus] = useState<DownloadStatus>('idle');
    const [previewSt,  setPreviewSt]  = useState<'idle'|'loading'|'ready'|'error'>('idle');
    const [rows,    setRows]    = useState<FlatRow[]>([]);
    const [cols,    setCols]    = useState<string[]>([]);
    const [dateField, setDateField] = useState<string | null>(null);
    const [open, setOpen] = useState(false);

    const ensureData = async () => {
        if (previewSt === 'ready') return { rows, cols };
        setPreviewSt('loading');
        try {
            const payload = await fetchJson(endpoint);
            const r = normalizeToRows(payload);
            const c = getColumns(r);
            setRows(r); setCols(c); setDateField(detectDateField(r, c));
            setPreviewSt('ready');
            return { rows: r, cols: c };
        } catch {
            setPreviewSt('error');
            throw new Error('load failed');
        }
    };

    const handleDownload = async (format: ExportFormat) => {
        const set = format === 'CSV' ? setCsvStatus : setXlsxStatus;
        set('loading');
        try {
            const d = await ensureData();
            const r = d?.rows ?? rows;
            const c = d?.cols?.length ? d.cols : getColumns(r);
            await doExport(r, c, format, filename(format));
            set('done'); setTimeout(() => set('idle'), 2500);
        } catch {
            set('error'); setTimeout(() => set('idle'), 3000);
        }
    };

    const handlePreview = async () => {
        if (!open) {
            setOpen(true);
            try { await ensureData(); } catch { /* handled */ }
        } else {
            setOpen(false);
        }
    };

    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-5 pt-4 pb-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="font-semibold text-slate-900 dark:text-slate-100 leading-snug text-sm">{title}</p>
                    <span className={`flex-shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeColor}`}>{badge}</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">{description}</p>
                {notes && <p className="text-[11px] text-blue-600 dark:text-blue-400 mb-2 italic">{notes}</p>}

                <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 px-3 py-1.5 mb-4">
                    <svg className="w-3 h-3 text-slate-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
                    </svg>
                    <code className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{endpoint}</code>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    {formats.includes('CSV')  && <DlBtn format="CSV"  status={csvStatus}  onClick={() => void handleDownload('CSV')} />}
                    {formats.includes('XLSX') && <DlBtn format="XLSX" status={xlsxStatus} onClick={() => void handleDownload('XLSX')} />}
                    <button onClick={() => void handlePreview()}
                        className="ml-auto flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
                        {previewSt === 'loading'
                            ? <><IcoSpin className="w-3.5 h-3.5" />Đang tải…</>
                            : <><IcoChevron className="w-3.5 h-3.5" open={open} />Preview</>}
                    </button>
                </div>
            </div>

            {open && (
                previewSt === 'error'
                    ? <div className="px-5 pb-4 text-xs text-red-500">Không tải được dữ liệu.</div>
                    : previewSt === 'loading'
                    ? <div className="flex items-center gap-2 px-5 pb-4 text-xs text-slate-400"><IcoSpin className="w-4 h-4" />Đang tải preview…</div>
                    : previewSt === 'ready' && <PreviewPanel rows={rows} cols={cols} dateField={dateField} />
            )}
        </div>
    );
}

// ── Stock tab ─────────────────────────────────────────────────────────────────

interface Ticker { symbol: string; name: string; exchange: string; }

function StockTab() {
    const [query,   setQuery]   = useState('');
    const [symbol,  setSymbol]  = useState('');
    const [tickers, setTickers] = useState<Ticker[]>([]);
    const [showSug, setShowSug] = useState(false);
    const [icbL3Sectors, setIcbL3Sectors] = useState<string[]>([]);
    const [selectedIcbL3, setSelectedIcbL3] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        fetch('/api/tickers', { cache: 'force-cache' })
            .then(r => r.json())
            .then(d => setTickers((d as { tickers?: Ticker[] }).tickers ?? d))
            .catch(() => {});
    }, []);

    useEffect(() => {
        fetch('/api/stock/stats-financial/icb-l3-sectors', { cache: 'force-cache' })
            .then(r => r.json())
            .then((d: { sectors?: string[] }) => {
                const sectors = Array.isArray(d?.sectors) ? d.sectors : [];
                setIcbL3Sectors(sectors);
                setSelectedIcbL3(prev => prev || sectors[0] || '');
            })
            .catch(() => {});
    }, []);

    const suggestions = useMemo(() => {
        if (!query.trim()) return [];
        const q = query.toUpperCase();
        const rank = (t: Ticker) => {
            if (t.symbol === q) return 0;                        // exact symbol
            if (t.symbol.startsWith(q)) return 1;               // symbol prefix
            if (t.name?.toUpperCase().includes(q)) return 2;    // name contains
            return 99;
        };
        return tickers
            .filter(t => rank(t) < 99)
            .sort((a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol))
            .slice(0, 8);
    }, [query, tickers]);

    const select = (t: Ticker) => {
        setSymbol(t.symbol.toUpperCase());
        setQuery(t.symbol.toUpperCase());
        setShowSug(false);
    };

    const handleInput = (v: string) => {
        setQuery(v);
        setSymbol(v.toUpperCase().trim());
        setShowSug(true);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setSymbol(query.toUpperCase().trim());
        setShowSug(false);
    };

    const statsBySectorEndpoint = selectedIcbL3
        ? `/api/stock/stats-financial?icb_l3=${encodeURIComponent(selectedIcbL3)}&cache=no-store`
        : '/api/stock/stats-financial?cache=no-store';
    const statsBySectorSlug = selectedIcbL3 ? slugifyForFilename(selectedIcbL3) : 'all';

    return (
        <div>
            {/* Symbol search */}
            <form onSubmit={handleSubmit} className="relative mb-6">
                <div className="flex gap-2 items-center">
                    <div className="relative flex-1 max-w-sm">
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={e => handleInput(e.target.value)}
                            onFocus={() => setShowSug(true)}
                            onBlur={() => setTimeout(() => setShowSug(false), 150)}
                            placeholder="Nhập mã cổ phiếu… (VD: VCB, FPT, VNM)"
                            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                        />
                        {/* Autocomplete */}
                        {showSug && suggestions.length > 0 && (
                            <div className="absolute z-50 top-full mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg overflow-hidden">
                                {suggestions.map(t => (
                                    <button key={t.symbol} type="button" onMouseDown={() => select(t)}
                                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-left transition-colors">
                                        <span className="font-bold text-slate-900 dark:text-slate-100 w-14 flex-shrink-0">{t.symbol}</span>
                                        <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{t.name}</span>
                                        <span className="ml-auto text-[10px] text-slate-400 flex-shrink-0">{t.exchange}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <button type="submit"
                        className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 text-sm font-semibold transition-colors">
                        Tải dữ liệu
                    </button>
                </div>
            </form>

            {/* Dataset cards for selected symbol */}
            {symbol ? (
                <>
                    <div className="flex items-center gap-3 mb-4">
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                            Dữ liệu cho <span className="text-blue-600 dark:text-blue-400 font-bold">{symbol}</span>
                        </p>
                        <span className="text-xs text-slate-400">— {STOCK_DATASETS.length} loại dữ liệu</span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {STOCK_DATASETS.map(ds => (
                            <DatasetCard
                                key={`${ds.id}-${symbol}`}
                                title={ds.title}
                                description={ds.description}
                                endpoint={ds.endpoint(symbol)}
                                filename={(f) => ds.filename(f, symbol)}
                                badge={ds.badge}
                                badgeColor={ds.badgeColor}
                                notes={ds.notes}
                            />
                        ))}
                    </div>
                </>
            ) : (
                <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-12 text-center">
                    <svg className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                    </svg>
                    <p className="text-sm text-slate-400 dark:text-slate-500 mb-1">Nhập mã cổ phiếu để xem dữ liệu</p>
                    <p className="text-xs text-slate-300 dark:text-slate-600">Lịch sử giá, tài chính, valuation, cổ đông, tin tức…</p>
                </div>
            )}

            <section className="mt-8">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                        vci_stats_financial theo ngành (ICB level 3)
                    </p>
                    <select
                        value={selectedIcbL3}
                        onChange={(e) => setSelectedIcbL3(e.target.value)}
                        className="min-w-[280px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        {icbL3Sectors.length === 0 ? (
                            <option value="">Đang tải danh sách ngành…</option>
                        ) : (
                            icbL3Sectors.map((sector) => (
                                <option key={sector} value={sector}>{sector}</option>
                            ))
                        )}
                    </select>
                </div>
                <DatasetCard
                    key={`stats-financial-icb3-${selectedIcbL3 || 'all'}`}
                    title="Thông số VCI theo ngành (ICB level 3)"
                    description="Tải dữ liệu từ vci_stats_financial.stats_financial theo ngành ICB level 3 đã chọn."
                    endpoint={statsBySectorEndpoint}
                    filename={(f) => `stats_financial_icb_l3_${statsBySectorSlug}_${today()}.${f.toLowerCase()}`}
                    badge="Tài chính"
                    badgeColor="text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30"
                    notes="CSV xuất UTF-8 (kèm BOM), mở Excel hiển thị tiếng Việt đúng encoding."
                />
            </section>
        </div>
    );
}

// ── Macro tab ─────────────────────────────────────────────────────────────────

function SimpleDlCard({
    title, description, badge, badgeColor, endpoint, filename, extract, notes,
}: {
    title: string; description: string; badge: string; badgeColor: string;
    endpoint: string; filename: (f: ExportFormat) => string;
    extract?: (data: unknown) => unknown;
    notes?: string;
}) {
    const [csvStatus,  setCsvStatus]  = useState<DownloadStatus>('idle');
    const [xlsxStatus, setXlsxStatus] = useState<DownloadStatus>('idle');

    const handleDownload = async (format: ExportFormat) => {
        const set = format === 'CSV' ? setCsvStatus : setXlsxStatus;
        set('loading');
        try {
            let payload = await fetchJson(endpoint);
            if (extract) payload = extract(payload);
            const rows = normalizeToRows(payload);
            const cols = getColumns(rows);
            await doExport(rows, cols, format, filename(format));
            set('done'); setTimeout(() => set('idle'), 2500);
        } catch {
            set('error'); setTimeout(() => set('idle'), 3000);
        }
    };

    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-5 pt-4 pb-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="font-semibold text-slate-900 dark:text-slate-100 leading-snug text-sm">{title}</p>
                    <span className={`flex-shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeColor}`}>{badge}</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">{description}</p>
                {notes && <p className="text-[11px] text-blue-600 dark:text-blue-400 mb-2 italic">{notes}</p>}
                <div className="flex items-center gap-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 px-3 py-1.5 mb-4">
                    <svg className="w-3 h-3 text-slate-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
                    </svg>
                    <code className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{endpoint}</code>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                    <DlBtn format="CSV"  status={csvStatus}  onClick={() => void handleDownload('CSV')} />
                    <DlBtn format="XLSX" status={xlsxStatus} onClick={() => void handleDownload('XLSX')} />
                </div>
            </div>
        </div>
    );
}

function MacroTab() {
    return (
        <div className="space-y-8">
            {/* FX + Commodities history */}
            <section>
                <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
                    Lịch sử tỷ giá VND & Hàng hóa
                    <span className="text-xs font-normal text-slate-400">· Nguồn: Yahoo Finance · 3 năm · Hàng ngày</span>
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {MACRO_HISTORY_CARDS.map(card => (
                        <DatasetCard
                            key={card.title}
                            title={card.title}
                            description={card.description}
                            endpoint={card.endpoint}
                            filename={card.filename}
                            badge={card.badge}
                            badgeColor={card.badgeColor}
                        />
                    ))}
                </div>
            </section>

            {/* Economic indicators */}
            <section>
                <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                    Chỉ số kinh tế vĩ mô
                    <span className="text-xs font-normal text-slate-400">· Nguồn: investing.com · Theo tháng/quý</span>
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {MACRO_ECO_CARDS.map(card => (
                        <SimpleDlCard
                            key={card.title}
                            title={card.title}
                            description={card.description}
                            endpoint={card.endpoint}
                            extract={card.extract}
                            filename={card.filename}
                            badge={card.badge}
                            badgeColor={card.badgeColor}
                        />
                    ))}
                </div>
            </section>

            {/* FireAnt macro data by type */}
            <section>
                <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-500 inline-block" />
                    Dữ liệu vĩ mô FireAnt
                    <span className="text-xs font-normal text-slate-400">· Nguồn: FireAnt · Cập nhật hàng ngày</span>
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {MACRO_FA_CARDS.map(card => (
                        <SimpleDlCard
                            key={card.type}
                            title={card.title}
                            description={card.description}
                            endpoint={`/api/market/macro/fireant?types=${card.type}&full=1`}
                            extract={(d) => (d as Record<string, unknown>)[card.type]}
                            filename={(f) => `fireant_${card.type.toLowerCase()}_${today()}.${f.toLowerCase()}`}
                            badge="FireAnt"
                            badgeColor={MACRO_BADGE_FA}
                        />
                    ))}
                </div>
            </section>
        </div>
    );
}

// ── Market tab ────────────────────────────────────────────────────────────────

function MarketTab() {
    const [activeGroup, setActiveGroup] = useState<MarketGroupId>('ALL');
    const [bulkStatus, setBulkStatus]   = useState<DownloadStatus>('idle');
    const [bulkFormat, setBulkFormat]   = useState<ExportFormat>('CSV');

    const counts = useMemo(() => {
        const c: Record<string, number> = { ALL: MARKET_DATASETS.length };
        MARKET_DATASETS.forEach(d => { c[d.group] = (c[d.group] ?? 0) + 1; });
        return c;
    }, []);

    const visible = activeGroup === 'ALL' ? MARKET_DATASETS : MARKET_DATASETS.filter(d => d.group === activeGroup);

    const downloadZip = async () => {
        setBulkStatus('loading');
        try {
            const zip = new JSZip();
            for (const ds of MARKET_DATASETS) {
                const ep = typeof ds.endpoint === 'string' ? ds.endpoint : ds.endpoint('');
                const payload = await fetchJson(ep);
                const r = normalizeToRows(payload);
                const c = getColumns(r);
                if (bulkFormat === 'CSV') zip.file(ds.filename('CSV'), toCsv(r, c));
                else zip.file(ds.filename('XLSX'), await toXlsxBuf(r, c, ds.title));
            }
            triggerBlobDownload(await zip.generateAsync({ type: 'blob' }), `market_data_${bulkFormat.toLowerCase()}_${today()}.zip`);
            setBulkStatus('done'); setTimeout(() => setBulkStatus('idle'), 2500);
        } catch {
            setBulkStatus('error'); setTimeout(() => setBulkStatus('idle'), 3500);
        }
    };

    return (
        <div>
            {/* Bulk bar */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-3.5 mb-5 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Tải toàn bộ {MARKET_DATASETS.length} datasets dạng ZIP</p>
                    <p className="text-xs text-slate-400">Đóng gói tất cả thành một file</p>
                </div>
                <select value={bulkFormat} onChange={e => setBulkFormat(e.target.value as ExportFormat)}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="CSV">ZIP / CSV</option>
                    <option value="XLSX">ZIP / XLSX</option>
                </select>
                <button onClick={() => void downloadZip()} disabled={bulkStatus === 'loading'}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
                    {bulkStatus === 'loading' ? <><IcoSpin className="w-4 h-4" />Đang đóng gói…</> :
                     bulkStatus === 'done'    ? <><IcoCheck className="w-4 h-4" />Đã tải!</> :
                     <><IcoDownload className="w-4 h-4" />Tải ZIP</>}
                </button>
            </div>

            {/* Group tabs */}
            <div className="flex flex-wrap gap-2 mb-5">
                {MARKET_GROUPS.map(g => (
                    <button key={g.id} onClick={() => setActiveGroup(g.id)}
                        className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors border ${
                            activeGroup === g.id
                                ? 'border-blue-500 bg-blue-600 text-white'
                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-blue-400'
                        }`}>
                        {g.label}
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${activeGroup === g.id ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
                            {counts[g.id] ?? 0}
                        </span>
                    </button>
                ))}
            </div>

            {/* Cards */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {visible.map(ds => {
                    const ep = typeof ds.endpoint === 'string' ? ds.endpoint : ds.endpoint('');
                    return (
                        <DatasetCard key={ds.id}
                            title={ds.title}
                            description={ds.description}
                            endpoint={ep}
                            filename={(f) => ds.filename(f)}
                            badge={GROUP_LABELS[ds.group]}
                            badgeColor={GROUP_STYLES[ds.group]}
                            notes={ds.notes}
                            formats={ds.formats}
                        />
                    );
                })}
            </div>
        </div>
    );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DownloadsPage() {
    const [tab, setTab] = useState<MainTab>('market');

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
                        Xuất dữ liệu thị trường và từng cổ phiếu theo định dạng CSV hoặc XLSX. Xem trước schema, lọc theo thời gian.
                    </p>
                </div>

                {/* Main tabs */}
                <div className="flex gap-1 mb-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 w-fit">
                    {([
                        { id: 'market', label: 'Dữ liệu thị trường', count: MARKET_DATASETS.length },
                        { id: 'stock',  label: 'Dữ liệu cổ phiếu',   count: STOCK_DATASETS.length },
                        { id: 'macro',  label: 'Dữ liệu vĩ mô',      count: MACRO_HISTORY_CARDS.length + MACRO_ECO_CARDS.length + MACRO_FA_CARDS.length },
                    ] as const).map(t => (
                        <button key={t.id} onClick={() => setTab(t.id)}
                            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                                tab === t.id
                                    ? 'bg-blue-600 text-white shadow-sm'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                            }`}>
                            {t.label}
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${tab === t.id ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'}`}>
                                {t.count}
                            </span>
                        </button>
                    ))}
                </div>

                {tab === 'market' ? <MarketTab /> : tab === 'macro' ? <MacroTab /> : <StockTab />}

                <p className="mt-8 text-xs text-slate-400 dark:text-slate-500">
                    Nguồn: VCI, CafeF, BTMC, Yahoo Finance · Cache TTL 45s–10p tuỳ endpoint ·{' '}
                    <Link href="/disclaimer" className="underline hover:text-slate-600 dark:hover:text-slate-300">Disclaimer</Link>
                </p>
            </div>
        </div>
    );
}
