'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';

type Scope = 'ticker' | 'industry' | 'market';
type ExportFormat = 'csv' | 'xlsx';
type PeriodKind = 'year' | 'quarter' | 'all';
type Status = 'idle' | 'loading' | 'done' | 'error';
type Ticker = { symbol: string; name: string; sector?: string; exchange?: string };
type OriginalFile = { ticker: string; filename: string; url: string };
type TableId = 'income_statement' | 'balance_sheet' | 'cash_flow' | 'note';
type DownloadTab = 'query' | 'variables' | 'manuals' | 'faqs' | 'datasets';
type DirectoryHandle = {
    getDirectoryHandle(name: string, options: { create: boolean }): Promise<DirectoryHandle>;
    getFileHandle(name: string, options: { create: boolean }): Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
};

const EXCHANGES = ['HOSE', 'HNX', 'UPCOM'];
const TABLES: Array<{ id: TableId; title: string; description: string }> = [
    { id: 'income_statement', title: 'Kết quả kinh doanh', description: 'Doanh thu, lợi nhuận và các chỉ tiêu vận hành' },
    { id: 'balance_sheet', title: 'Bảng cân đối kế toán', description: 'Tài sản, nợ phải trả và vốn chủ sở hữu' },
    { id: 'cash_flow', title: 'Lưu chuyển tiền tệ', description: 'Dòng tiền từ hoạt động kinh doanh, đầu tư, tài chính' },
    { id: 'note', title: 'Thuyết minh', description: 'Các khoản mục có giá trị, xuất dạng sparse' },
];
const DOWNLOAD_TABS: Array<{ id: DownloadTab; label: string }> = [
    { id: 'query', label: 'Biểu mẫu tải dữ liệu' },
    { id: 'variables', label: 'Mô tả biến' },
    { id: 'manuals', label: 'Hướng dẫn & tổng quan' },
    { id: 'faqs', label: 'FAQ' },
    { id: 'datasets', label: 'Danh mục dữ liệu' },
];

function DownloadIcon() { return <span aria-hidden="true">↓</span>; }
function Step({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
    return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">{number}</span>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h2>
        </div>
        <div className="p-5">{children}</div>
    </section>;
}

export default function DownloadsPage() {
    const currentYear = new Date().getFullYear();
    const years = useMemo(() => Array.from({ length: currentYear - 2010 + 1 }, (_, i) => currentYear - i), [currentYear]);
    const [tickers, setTickers] = useState<Ticker[]>([]);
    const [scope, setScope] = useState<Scope>('ticker');
    const [query, setQuery] = useState('');
    const [selectedTicker, setSelectedTicker] = useState('');
    const [exchanges, setExchanges] = useState<string[]>(EXCHANGES);
    const [sector, setSector] = useState('');
    const [fromYear, setFromYear] = useState(2020);
    const [toYear, setToYear] = useState(currentYear);
    const [fromQuarter, setFromQuarter] = useState(1);
    const [toQuarter, setToQuarter] = useState(4);
    const [periodKind, setPeriodKind] = useState<PeriodKind>('year');
    const [format, setFormat] = useState<ExportFormat>('csv');
    const [selectedTables, setSelectedTables] = useState<TableId[]>(TABLES.map(table => table.id));
    const [status, setStatus] = useState<Status>('idle');
    const [originalStatus, setOriginalStatus] = useState<Status>('idle');
    const [originalProgress, setOriginalProgress] = useState(0);
    const [originalTotal, setOriginalTotal] = useState(0);
    const [message, setMessage] = useState('');
    const [activeTab, setActiveTab] = useState<DownloadTab>('query');

    useEffect(() => {
        const load = async () => {
            try {
                const response = await fetch('/api/tickers', { cache: 'force-cache' });
                if (!response.ok) throw new Error();
                const payload = await response.json() as { tickers?: Ticker[] } | Ticker[];
                setTickers(Array.isArray(payload) ? payload : payload.tickers ?? []);
            } catch {
                try {
                    const response = await fetch('/ticker_data.json', { cache: 'force-cache' });
                    const payload = await response.json() as { tickers?: Ticker[] };
                    setTickers(payload.tickers ?? []);
                } catch { setMessage('Không tải được danh mục mã cổ phiếu.'); }
            }
        };
        void load();
    }, []);

    const sectors = useMemo(() => Array.from(new Set(tickers.map(t => t.sector).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'vi')), [tickers]);
    const suggestions = useMemo(() => {
        const value = query.trim().toUpperCase();
        if (scope !== 'ticker' || !value || selectedTicker || value.includes(',')) return [];
        return tickers.filter(t => t.symbol.startsWith(value) || t.name?.toUpperCase().includes(value)).slice(0, 8);
    }, [query, scope, selectedTicker, tickers]);
    const symbols = (selectedTicker || query).split(/[\s,]+/).map(item => item.trim().toUpperCase()).filter(Boolean);
    const scopeLabel = scope === 'ticker' ? (symbols.length > 1 ? `${symbols.length} mã đã chọn` : (symbols[0] || 'chưa chọn mã')) : scope === 'industry' ? (sector || 'chưa chọn ngành') : 'toàn thị trường';
    const canDownload = selectedTables.length > 0 && fromYear <= toYear && (scope !== 'ticker' || symbols.length > 0) && (scope !== 'industry' || !!sector) && (scope === 'ticker' || exchanges.length > 0);

    const buildParams = () => {
        const params = new URLSearchParams({ scope, from_year: String(fromYear), to_year: String(toYear), period_kind: periodKind, format, tables: selectedTables.join(',') });
        if (scope === 'ticker') params.set('tickers', symbols.join(','));
        if (scope !== 'ticker') params.set('exchanges', exchanges.join(','));
        if (scope === 'industry') params.set('sectors', sector);
        if (periodKind === 'quarter') { params.set('from_quarter', String(fromQuarter)); params.set('to_quarter', String(toQuarter)); }
        return params;
    };

    const downloadStatements = async () => {
        if (!canDownload) return;
        setStatus('loading'); setMessage('');
        try {
            const response = await fetch(`/api/financial-bulk-export?${buildParams().toString()}`, { cache: 'no-store' });
            if (!response.ok) { const error = await response.json().catch(() => null) as { error?: string } | null; throw new Error(error?.error || `HTTP ${response.status}`); }
            const blob = await response.blob();
            const base = scope === 'ticker' ? (symbols.length === 1 ? symbols[0] : `${symbols.length}-tickers`) : `financials-${scope}`;
            const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${base}_${fromYear}-${toYear}.${format === 'csv' ? 'zip' : 'xlsx'}`; anchor.click(); URL.revokeObjectURL(url);
            setStatus('done'); window.setTimeout(() => setStatus('idle'), 2500);
        } catch (error) { setStatus('error'); setMessage(error instanceof Error ? error.message : 'Không thể tạo file BCTC.'); window.setTimeout(() => setStatus('idle'), 3500); }
    };

    const handleCodeFile = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const content = await file.text();
        setScope('ticker'); setSelectedTicker(''); setQuery(content.replace(/[^a-zA-Z0-9,\s]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase());
        event.target.value = '';
    };

    const downloadOriginalVietcap = async () => {
        if (symbols.length !== 1) return downloadOriginalBulk(symbols.length ? symbols : undefined);
        setOriginalStatus('loading');
        try {
            const response = await fetch(`/api/stock/excel/${encodeURIComponent(symbols[0])}`); const payload = await response.json() as { success?: boolean; url?: string; error?: string };
            if (!response.ok || !payload.success || !payload.url) throw new Error(payload.error || 'Không tìm thấy file Excel gốc.');
            window.location.href = payload.url; setOriginalStatus('done');
        } catch (error) { setOriginalStatus('error'); setMessage(error instanceof Error ? error.message : 'Không thể tải file Excel gốc.'); window.setTimeout(() => setOriginalStatus('idle'), 3500); }
    };

    const downloadOriginalBulk = async (tickerList?: string[]) => {
        if (!tickerList && (!exchanges.length || (scope === 'industry' && !sector))) return;
        const picker = (window as Window & { showDirectoryPicker?: () => Promise<DirectoryHandle> }).showDirectoryPicker;
        if (!picker) { setOriginalStatus('error'); setMessage('Trình duyệt này chưa hỗ trợ chọn folder. Hãy dùng Chrome hoặc Edge trên máy tính.'); return; }
        setOriginalStatus('loading'); setOriginalProgress(0);
        try {
            const parentDirectory = await picker();
            const folderLabel = tickerList?.length ? `vietcap-${tickerList.join('-')}` : scope === 'industry' ? `vietcap-${sector}` : 'vietcap-toan-thi-truong';
            const folderName = folderLabel.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'vietcap-files';
            const directory = await parentDirectory.getDirectoryHandle(folderName, { create: true });
            const params = tickerList?.length ? new URLSearchParams({ scope: 'ticker', tickers: tickerList.join(',') }) : new URLSearchParams({ scope, exchanges: exchanges.join(',') });
            if (!tickerList?.length && scope === 'industry') params.set('sectors', sector);
            const response = await fetch(`/api/stock/excel-manifest?${params.toString()}`, { cache: 'no-store' });
            if (!response.ok) { const error = await response.json().catch(() => null) as { error?: string } | null; throw new Error(error?.error || `HTTP ${response.status}`); }
            const payload = await response.json() as { files?: OriginalFile[]; missing?: string[] }; const files = payload.files ?? [];
            if (!files.length) throw new Error('Không tìm thấy file Excel gốc trên R2.'); setOriginalTotal(files.length);
            for (const [index, file] of files.entries()) { const fileResponse = await fetch(file.url); if (!fileResponse.ok) throw new Error(`Không tải được ${file.ticker}.xlsx`); const handle = await directory.getFileHandle(file.filename, { create: true }); const writable = await handle.createWritable(); await writable.write(await fileResponse.blob()); await writable.close(); setOriginalProgress(index + 1); }
            setOriginalStatus('done'); setMessage(payload.missing?.length ? `Đã tải ${files.length} file; thiếu ${payload.missing.length} mã trên R2.` : ''); window.setTimeout(() => { setOriginalStatus('idle'); setOriginalProgress(0); setOriginalTotal(0); }, 3500);
        } catch (error) { setOriginalStatus('error'); setMessage(error instanceof Error ? error.message : 'Không thể tải Excel gốc.'); window.setTimeout(() => setOriginalStatus('idle'), 3500); }
    };

    const toggleTable = (id: TableId) => setSelectedTables(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    const toggleExchange = (exchange: string) => setExchanges(current => current.includes(exchange) ? current.filter(item => item !== exchange) : [...current, exchange]);

    return <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="mx-auto max-w-[1180px] space-y-5 p-4 md:p-8">
            <header className="flex flex-col gap-3 border-b border-slate-200 pb-6 dark:border-slate-800 md:flex-row md:items-end md:justify-between">
                <div><p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-600 dark:text-emerald-400">Quang Anh Data Library</p><h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">Tải dữ liệu</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">Tạo một bộ dữ liệu theo đúng phạm vi, kỳ báo cáo và các bảng bạn cần. File sẽ được xử lý và tải xuống trong một lần.</p></div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"><b>{symbols.length || '—'}</b> mã · <b>{selectedTables.length}/4</b> bảng · {format === 'csv' ? 'CSV / ZIP' : 'Excel'}</div>
            </header>

            <nav aria-label="Nội dung tải dữ liệu" className="overflow-x-auto border-b border-slate-200 dark:border-slate-800">
                <div className="flex min-w-max">
                    {DOWNLOAD_TABS.map(tab => <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`border-x border-t px-5 py-3 text-sm font-semibold transition first:border-l ${activeTab === tab.id ? 'border-emerald-600 bg-white text-emerald-700 dark:bg-slate-900 dark:text-emerald-300' : 'border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400 dark:hover:bg-slate-900'}`}>{tab.label}</button>)}
                </div>
            </nav>

            <div className={activeTab === 'query' ? 'grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]' : 'hidden'}>
                <div className="space-y-5">
                    <Step number="1" title="Chọn khoảng thời gian"><div className="grid gap-4 sm:grid-cols-3"><label className="text-sm font-semibold">Kiểu kỳ<select value={periodKind} onChange={e => setPeriodKind(e.target.value as PeriodKind)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal dark:border-slate-700 dark:bg-slate-950"><option value="year">Năm</option><option value="quarter">Quý</option><option value="all">Quý + năm</option></select></label><label className="text-sm font-semibold">Từ năm<select value={fromYear} onChange={e => setFromYear(Number(e.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal dark:border-slate-700 dark:bg-slate-950">{years.map(year => <option key={year}>{year}</option>)}</select></label><label className="text-sm font-semibold">Đến năm<select value={toYear} onChange={e => setToYear(Number(e.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal dark:border-slate-700 dark:bg-slate-950">{years.map(year => <option key={year}>{year}</option>)}</select></label>{periodKind === 'quarter' && <><label className="text-sm font-semibold">Từ quý<select value={fromQuarter} onChange={e => setFromQuarter(Number(e.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal dark:border-slate-700 dark:bg-slate-950">{[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}</select></label><label className="text-sm font-semibold">Đến quý<select value={toQuarter} onChange={e => setToQuarter(Number(e.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal dark:border-slate-700 dark:bg-slate-950">{[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}</select></label></>}</div></Step>

                    <Step number="2" title="Chọn mã hoặc phạm vi công ty"><div className="flex flex-wrap gap-2">{([['ticker', 'Nhập mã'], ['industry', 'Theo ngành'], ['market', 'Toàn thị trường']] as const).map(([id, label]) => <button key={id} type="button" onClick={() => { setScope(id); setMessage(''); }} className={`rounded-lg border px-4 py-2 text-sm font-semibold ${scope === id ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-slate-200 text-slate-500 dark:border-slate-700'}`}>{label}</button>)}</div>{scope === 'ticker' ? <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]"><label className="relative text-sm font-semibold">Mã cổ phiếu<input value={query} onChange={e => { setQuery(e.target.value.toUpperCase()); setSelectedTicker(''); }} placeholder="VCB MSFT · cách nhau bằng dấu cách hoặc dấu phẩy" className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 font-normal outline-none focus:ring-2 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-950" />{suggestions.length > 0 && <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">{suggestions.map(t => <button key={t.symbol} type="button" onClick={() => { setQuery(t.symbol); setSelectedTicker(t.symbol); }} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"><b>{t.symbol}</b><span className="truncate text-xs text-slate-500">{t.name}</span><span className="ml-auto text-[10px] text-slate-400">{t.exchange}</span></button>)}</div>}</label><label className="flex cursor-pointer items-end text-sm font-semibold text-slate-600"><span className="w-full rounded-lg border border-dashed border-slate-300 px-4 py-3 text-center dark:border-slate-700">Nạp danh sách .txt<input type="file" accept=".txt,text/plain" onChange={handleCodeFile} className="sr-only" /></span></label></div> : <div className="mt-4 grid gap-4 md:grid-cols-2"><fieldset><legend className="mb-2 text-sm font-semibold">Sàn giao dịch</legend><div className="flex flex-wrap gap-2">{EXCHANGES.map(exchange => <label key={exchange} className={`cursor-pointer rounded-lg border px-3 py-2 text-xs font-semibold ${exchanges.includes(exchange) ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-slate-200 text-slate-500 dark:border-slate-700'}`}><input type="checkbox" className="sr-only" checked={exchanges.includes(exchange)} onChange={() => toggleExchange(exchange)} />{exchange}</label>)}</div></fieldset>{scope === 'industry' && <label className="text-sm font-semibold">Ngành<select value={sector} onChange={e => setSector(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal dark:border-slate-700 dark:bg-slate-950"><option value="">Chọn ngành</option>{sectors.map(item => <option key={item}>{item}</option>)}</select></label>}</div>}</Step>

                    <Step number="3" title="Chọn bảng dữ liệu"><p className="mb-4 text-sm text-slate-500">Chọn một hoặc nhiều bảng. Bạn có thể bỏ các bảng không cần để file nhẹ hơn.</p><div className="grid gap-3 sm:grid-cols-2">{TABLES.map(table => <label key={table.id} className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition ${selectedTables.includes(table.id) ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/20' : 'border-slate-200 dark:border-slate-700'}`}><input type="checkbox" checked={selectedTables.includes(table.id)} onChange={() => toggleTable(table.id)} className="mt-1 h-4 w-4 accent-emerald-600" /><span><span className="block text-sm font-bold">{table.title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{table.description}</span></span></label>)}</div><button type="button" onClick={() => setSelectedTables(selectedTables.length === TABLES.length ? [] : TABLES.map(table => table.id))} className="mt-4 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400">{selectedTables.length === TABLES.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả bảng'}</button></Step>

                    <Step number="4" title="Chọn định dạng và tải xuống"><div className="grid gap-3 sm:grid-cols-2"><label className={`cursor-pointer rounded-xl border p-4 ${format === 'csv' ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/20' : 'border-slate-200 dark:border-slate-700'}`}><input type="radio" name="format" value="csv" checked={format === 'csv'} onChange={() => setFormat('csv')} className="mr-2 accent-emerald-600" /><b>CSV / ZIP</b><span className="mt-1 block pl-6 text-xs text-slate-500">Nhẹ, phù hợp nhiều mã và toàn thị trường. Mỗi bảng là một file CSV.</span></label><label className={`cursor-pointer rounded-xl border p-4 ${format === 'xlsx' ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/20' : 'border-slate-200 dark:border-slate-700'}`}><input type="radio" name="format" value="xlsx" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} className="mr-2 accent-emerald-600" /><b>Excel (.xlsx)</b><span className="mt-1 block pl-6 text-xs text-slate-500">Một workbook, mỗi bảng một sheet, thuận tiện mở và phân tích.</span></label></div><div className="mt-5 flex flex-col gap-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-950/60 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-slate-500">{scopeLabel} · {fromYear}–{toYear} · {selectedTables.length} bảng</p><button type="button" onClick={() => void downloadStatements()} disabled={!canDownload || status === 'loading'} className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">{status === 'loading' ? 'Đang tạo file…' : status === 'done' ? '✓ Đã tải xuống' : <><DownloadIcon /> Tạo và tải file</>}</button></div>{message && <p className={`mt-3 text-sm ${status === 'done' ? 'text-emerald-600' : 'text-red-600'}`}>{message}</p>}</Step>
                </div>

                <aside className="h-fit space-y-4 lg:sticky lg:top-5"><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Tóm tắt truy vấn</p><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-3"><dt className="text-slate-500">Phạm vi</dt><dd className="text-right font-semibold">{scopeLabel}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Thời gian</dt><dd className="font-semibold">{fromYear}–{toYear}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Bảng</dt><dd className="font-semibold">{selectedTables.length}/4</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-500">Output</dt><dd className="font-semibold">{format.toUpperCase()}{format === 'csv' ? ' / ZIP' : ''}</dd></div></dl></div><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><p className="text-sm font-bold">Excel gốc Vietcap</p><p className="mt-2 text-xs leading-5 text-slate-500">Tải workbook gốc theo mã hoặc nhiều mã. Với nhiều file, trình duyệt sẽ tạo một thư mục riêng trên máy.</p><button type="button" onClick={() => void downloadOriginalVietcap()} disabled={!symbols.length || originalStatus === 'loading'} className="mt-4 w-full rounded-lg border border-emerald-500 px-3 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-950/30">{originalStatus === 'loading' ? (originalTotal ? `Đang tải ${originalProgress}/${originalTotal} file…` : 'Đang chuẩn bị…') : symbols.length > 1 ? 'Tải vào folder riêng' : 'Tải Excel gốc'}</button></div><p className="px-1 text-xs leading-5 text-slate-400">Dữ liệu BCTC dùng tên cột tiếng Anh. Các giá trị rỗng và bằng 0 trong bảng thuyết minh được loại khỏi file để giảm dung lượng.</p></aside>
            </div>
            {activeTab !== 'query' && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-7">
                {activeTab === 'variables' && <><h2 className="text-xl font-bold">Mô tả biến</h2><p className="mt-2 text-sm text-slate-500">Mỗi file luôn có các cột định danh kỳ báo cáo; các cột còn lại phụ thuộc bảng bạn chọn.</p><div className="mt-5 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800"><tr><th className="px-3 py-3">Nhóm</th><th className="px-3 py-3">Biến</th><th className="px-3 py-3">Ý nghĩa</th></tr></thead><tbody>{[['Định danh', 'ticker', 'Mã chứng khoán'], ['Kỳ báo cáo', 'period_kind', 'YEAR hoặc QUARTER'], ['Kỳ báo cáo', 'year_report / quarter_report', 'Năm và quý của báo cáo'], ['Kỳ báo cáo', 'public_date', 'Ngày công bố dữ liệu'], ...TABLES.map(table => ['Bảng dữ liệu', table.id, table.description])].map(([group, variable, description]) => <tr key={variable} className="border-b border-slate-100 dark:border-slate-800"><td className="px-3 py-3 text-slate-500">{group}</td><td className="px-3 py-3 font-mono text-xs font-semibold">{variable}</td><td className="px-3 py-3">{description}</td></tr>)}</tbody></table></div></>}
                {activeTab === 'manuals' && <><h2 className="text-xl font-bold">Hướng dẫn & tổng quan</h2><div className="mt-5 grid gap-4 md:grid-cols-3"><div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-950"><b>1. Tạo truy vấn</b><p className="mt-2 text-sm leading-6 text-slate-500">Chọn thời gian, mã hoặc phạm vi thị trường, sau đó chỉ chọn các bảng cần thiết.</p></div><div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-950"><b>2. Chọn output</b><p className="mt-2 text-sm leading-6 text-slate-500">CSV/ZIP phù hợp dữ liệu lớn; Excel tạo một workbook với mỗi bảng là một sheet.</p></div><div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-950"><b>3. Kiểm tra dữ liệu</b><p className="mt-2 text-sm leading-6 text-slate-500">Bảng thuyết minh xuất sparse: các giá trị rỗng và 0 được bỏ để giảm dung lượng.</p></div></div></>}
                {activeTab === 'faqs' && <><h2 className="text-xl font-bold">Câu hỏi thường gặp</h2><div className="mt-5 space-y-3">{[['Tôi nên chọn CSV hay Excel?', 'Chọn CSV/ZIP cho nhiều mã hoặc toàn thị trường. Chọn Excel khi cần mở trực tiếp và phân tích một phạm vi nhỏ.'], ['Có thể tải nhiều mã cùng lúc không?', 'Có. Nhập các mã cách nhau bằng khoảng trắng hoặc dấu phẩy, hoặc tải lên file .txt với một mã mỗi dòng.'], ['Excel gốc Vietcap khác gì file xuất?', 'Excel gốc là workbook nguồn theo từng mã. File xuất là dữ liệu BCTC đã được chọn và chuẩn hóa theo truy vấn của bạn.'], ['Vì sao không có giá trị 0 trong Notes?', 'Để giảm kích thước file, các ô rỗng và giá trị 0 trong bảng thuyết minh không được đưa vào file xuất.']].map(([question, answer]) => <details key={question} className="rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-800"><summary className="cursor-pointer font-semibold">{question}</summary><p className="mt-3 text-sm leading-6 text-slate-500">{answer}</p></details>)}</div></>}
                {activeTab === 'datasets' && <><h2 className="text-xl font-bold">Danh mục dữ liệu</h2><p className="mt-2 text-sm text-slate-500">Các dataset hiện sẵn sàng trong biểu mẫu tải dữ liệu.</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{TABLES.map(table => <div key={table.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"><p className="font-bold">{table.title}</p><p className="mt-1 font-mono text-xs text-emerald-700 dark:text-emerald-400">{table.id}</p><p className="mt-3 text-sm leading-6 text-slate-500">{table.description}</p></div>)}</div></>}
            </section>}
        </div>
    </main>;
}
