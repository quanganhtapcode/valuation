'use client';

import { useEffect, useMemo, useState } from 'react';

type Scope = 'ticker' | 'industry' | 'market';
type ExportFormat = 'csv' | 'xlsx';
type PeriodKind = 'year' | 'quarter' | 'all';
type Status = 'idle' | 'loading' | 'done' | 'error';
type Ticker = { symbol: string; name: string; en_name?: string; sector?: string; exchange?: string };
type OriginalFile = { ticker: string; filename: string; url: string };

const EXCHANGES = ['HOSE', 'HNX', 'UPCOM'];
const TABLES = [
    ['income_statement', 'Income Statement'],
    ['balance_sheet', 'Balance Sheet'],
    ['cash_flow', 'Cash Flow'],
    ['note', 'Notes'],
] as const;

function ButtonIcon({ type }: { type: 'download' | 'check' | 'spin' }) {
    if (type === 'spin') return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />;
    return <span className="text-base">{type === 'check' ? '✓' : '↓'}</span>;
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
    const [status, setStatus] = useState<Status>('idle');
    const [originalStatus, setOriginalStatus] = useState<Status>('idle');
    const [originalProgress, setOriginalProgress] = useState(0);
    const [originalTotal, setOriginalTotal] = useState(0);
    const [message, setMessage] = useState('');

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
        if (scope !== 'ticker' || !value || selectedTicker) return [];
        return tickers.filter(t => t.symbol.startsWith(value) || t.name?.toUpperCase().includes(value)).slice(0, 8);
    }, [query, scope, selectedTicker, tickers]);

    const buildParams = () => {
        const params = new URLSearchParams({ scope, from_year: String(fromYear), to_year: String(toYear), period_kind: periodKind, format });
        if (scope === 'ticker') params.set('tickers', selectedTicker || query.trim().toUpperCase());
        if (scope !== 'ticker') params.set('exchanges', exchanges.join(','));
        if (scope === 'industry') params.set('sectors', sector);
        if (periodKind === 'quarter') {
            params.set('from_quarter', String(fromQuarter));
            params.set('to_quarter', String(toQuarter));
        }
        return params;
    };

    const downloadStatements = async () => {
        if (fromYear > toYear || !exchanges.length || (scope === 'ticker' && !(selectedTicker || query.trim()))) return;
        setStatus('loading');
        setMessage('');
        try {
            const response = await fetch(`/api/financial-bulk-export?${buildParams().toString()}`, { cache: 'no-store' });
            if (!response.ok) {
                const error = await response.json().catch(() => null) as { error?: string } | null;
                throw new Error(error?.error || `HTTP ${response.status}`);
            }
            const blob = await response.blob();
            const filename = scope === 'ticker' ? `${selectedTicker || query.trim().toUpperCase()}_financials.${format === 'csv' ? 'zip' : 'xlsx'}` : `financials_${scope}_${fromYear}-${toYear}.${format === 'csv' ? 'zip' : 'xlsx'}`;
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            anchor.click();
            URL.revokeObjectURL(url);
            setStatus('done');
            setTimeout(() => setStatus('idle'), 2500);
        } catch (error) {
            setStatus('error');
            setMessage(error instanceof Error ? error.message : 'Không thể tạo file BCTC.');
            setTimeout(() => setStatus('idle'), 3500);
        }
    };

    const downloadOriginalVietcap = async () => {
        const symbols = (selectedTicker || query)
            .split(',')
            .map(symbol => symbol.trim().toUpperCase())
            .filter(Boolean);
        if (symbols.length > 1) {
            await downloadOriginalBulk(symbols);
            return;
        }
        const symbol = symbols[0] || '';
        if (!symbol) return;
        setOriginalStatus('loading');
        try {
            const response = await fetch(`/api/stock/excel/${encodeURIComponent(symbol)}`);
            const payload = await response.json() as { success?: boolean; url?: string; error?: string };
            if (!response.ok || !payload.success || !payload.url) throw new Error(payload.error || 'Không tìm thấy file Excel Vietcap.');
            window.location.href = payload.url;
            setOriginalStatus('done');
        } catch (error) {
            setOriginalStatus('error');
            setMessage(error instanceof Error ? error.message : 'Không thể tải file Excel gốc.');
            setTimeout(() => setOriginalStatus('idle'), 3500);
        }
    };

    const downloadOriginalBulk = async (tickerList?: string[]) => {
        if (!tickerList && (!exchanges.length || (scope === 'industry' && !sector))) return;
        const picker = (window as Window & { showDirectoryPicker?: () => Promise<any> }).showDirectoryPicker;
        if (!picker) {
            setOriginalStatus('error');
            setMessage('Trình duyệt này chưa hỗ trợ chọn folder. Hãy dùng Chrome hoặc Edge trên máy tính.');
            return;
        }
        setOriginalStatus('loading');
        setOriginalProgress(0);
        try {
            // The browser asks for a parent folder once. The app creates a
            // named child folder, then streams files directly from R2 into it.
            const parentDirectory = await picker();
            const folderLabel = tickerList?.length
                ? `vietcap-${tickerList.join('-')}`
                : scope === 'industry'
                    ? `vietcap-${sector}`
                    : 'vietcap-toan-thi-truong';
            const folderName = folderLabel.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'vietcap-files';
            const directory = await parentDirectory.getDirectoryHandle(folderName, { create: true });
            const params = tickerList?.length
                ? new URLSearchParams({ scope: 'ticker', tickers: tickerList.join(',') })
                : new URLSearchParams({ scope, exchanges: exchanges.join(',') });
            if (!tickerList?.length && scope === 'industry') params.set('sectors', sector);
            const response = await fetch(`/api/stock/excel-manifest?${params.toString()}`, { cache: 'no-store' });
            if (!response.ok) {
                const error = await response.json().catch(() => null) as { error?: string } | null;
                throw new Error(error?.error || `HTTP ${response.status}`);
            }
            const payload = await response.json() as { files?: OriginalFile[]; missing?: string[] };
            const files = payload.files ?? [];
            if (!files.length) throw new Error('Không tìm thấy file Excel Vietcap trong R2.');
            setOriginalTotal(files.length);
            for (const [index, file] of files.entries()) {
                const fileResponse = await fetch(file.url);
                if (!fileResponse.ok) throw new Error(`Không tải được ${file.ticker}.xlsx (HTTP ${fileResponse.status})`);
                const handle = await directory.getFileHandle(file.filename, { create: true });
                const writable = await handle.createWritable();
                if (fileResponse.body) {
                    await fileResponse.body.pipeTo(writable);
                } else {
                    await writable.write(await fileResponse.blob());
                    await writable.close();
                }
                setOriginalProgress(index + 1);
            }
            setOriginalStatus('done');
            setMessage(payload.missing?.length ? `Đã tải ${files.length} file; thiếu ${payload.missing.length} mã trên R2.` : '');
            setTimeout(() => { setOriginalStatus('idle'); setOriginalProgress(0); setOriginalTotal(0); }, 3500);
        } catch (error) {
            setOriginalStatus('error');
            setMessage(error instanceof Error ? error.message : 'Không thể tải Excel Vietcap.');
            setTimeout(() => setOriginalStatus('idle'), 3500);
        }
    };

    const scopeLabel = scope === 'ticker' ? (selectedTicker || query.toUpperCase() || 'chưa chọn mã') : scope === 'industry' ? (sector || 'chưa chọn ngành') : 'toàn thị trường';

    return (
        <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
            <div className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6">
                <header className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <h1 className="text-3xl font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100 md:text-4xl">Tải <span className="text-emerald-600 dark:text-emerald-400">Dữ liệu</span></h1>
                        <div className="mt-2 h-1 w-32 rounded bg-emerald-500" />
                        <p className="mt-3 max-w-4xl text-sm text-slate-600 dark:text-slate-300 md:text-base">Chọn phạm vi dữ liệu, khoảng kỳ báo cáo và định dạng. CSV/ZIP nhẹ hơn cho ngành hoặc toàn thị trường; Excel phù hợp để mở trực tiếp với 4 sheet.</p>
                    </div>
                </header>

                <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">01 · Phạm vi tải</p>
                        <div className="mt-3 flex flex-wrap gap-2">{([['ticker', 'Một mã'], ['industry', 'Toàn ngành'], ['market', 'Toàn thị trường']] as const).map(([id, label]) => <button key={id} type="button" onClick={() => { setScope(id); setMessage(''); }} className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${scope === id ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-slate-200 text-slate-500 hover:border-emerald-300 dark:border-slate-700 dark:text-slate-300'}`}>{label}</button>)}</div>
                    </div>
                    <div className="grid gap-4 p-5 md:grid-cols-3">
                        {scope === 'ticker' && <label className="relative text-sm font-semibold md:col-span-2">Mã cổ phiếu<input value={query} onChange={e => { setQuery(e.target.value.toUpperCase()); setSelectedTicker(''); }} placeholder="Ví dụ: VCB, FPT, VNM" className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal outline-none focus:ring-2 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-950" />{suggestions.length > 0 && <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">{suggestions.map(t => <button key={t.symbol} type="button" onClick={() => { setQuery(t.symbol); setSelectedTicker(t.symbol); }} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"><b>{t.symbol}</b><span className="truncate text-xs text-slate-500">{t.name}</span><span className="ml-auto text-[10px] text-slate-400">{t.exchange}</span></button>)}</div>}</label>}
                        {scope !== 'ticker' && <fieldset><legend className="mb-2 text-sm font-semibold">Sàn</legend><div className="flex flex-wrap gap-2">{EXCHANGES.map(exchange => <label key={exchange} className={`cursor-pointer rounded-lg border px-3 py-2 text-xs font-semibold ${exchanges.includes(exchange) ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-slate-200 text-slate-500 dark:border-slate-700'}`}><input type="checkbox" className="sr-only" checked={exchanges.includes(exchange)} onChange={() => setExchanges(current => current.includes(exchange) ? current.filter(item => item !== exchange) : [...current, exchange])} />{exchange}</label>)}</div></fieldset>}
                        {scope === 'industry' && <label className="text-sm font-semibold">Ngành<select value={sector} onChange={e => setSector(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal dark:border-slate-700 dark:bg-slate-950"><option value="">Chọn ngành</option>{sectors.map(item => <option key={item}>{item}</option>)}</select></label>}
                        {scope === 'ticker' && <div className="flex items-end"><button type="button" onClick={() => void downloadOriginalVietcap()} disabled={!query.trim() || originalStatus === 'loading'} className="w-full rounded-lg border border-emerald-500 px-3 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-950/30">{originalStatus === 'loading' ? 'Đang lấy file…' : query.includes(',') ? 'Chọn thư mục cha & tự tạo folder' : 'Tải Excel gốc Vietcap'}</button></div>}
                        {scope !== 'ticker' && <div className="flex items-end md:col-span-2"><button type="button" onClick={() => void downloadOriginalBulk()} disabled={!exchanges.length || (scope === 'industry' && !sector) || originalStatus === 'loading'} className="w-full rounded-lg border border-emerald-500 px-3 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-950/30">{originalStatus === 'loading' ? `Đang tải ${originalProgress}/${originalTotal || '…'} file vào folder…` : 'Chọn thư mục cha & tự tạo folder'}</button></div>}
                    </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800"><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">02 · Kỳ báo cáo & định dạng</p></div>
                    <div className="grid gap-4 p-5 md:grid-cols-4">
                        <label className="text-sm font-semibold">Kiểu kỳ<select value={periodKind} onChange={e => setPeriodKind(e.target.value as PeriodKind)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal dark:border-slate-700 dark:bg-slate-950"><option value="year">Theo năm</option><option value="quarter">Theo quý</option><option value="all">Quý + năm</option></select></label>
                        <label className="text-sm font-semibold">Từ năm<select value={fromYear} onChange={e => setFromYear(Number(e.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal dark:border-slate-700 dark:bg-slate-950">{years.map(year => <option key={year}>{year}</option>)}</select></label>
                        <label className="text-sm font-semibold">Đến năm<select value={toYear} onChange={e => setToYear(Number(e.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal dark:border-slate-700 dark:bg-slate-950">{years.map(year => <option key={year}>{year}</option>)}</select></label>
                        {periodKind === 'quarter' && <><label className="text-sm font-semibold">Từ quý<select value={fromQuarter} onChange={e => setFromQuarter(Number(e.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal dark:border-slate-700 dark:bg-slate-950">{[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}</select></label><label className="text-sm font-semibold">Đến quý<select value={toQuarter} onChange={e => setToQuarter(Number(e.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal dark:border-slate-700 dark:bg-slate-950">{[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}</select></label></>}
                        <label className="text-sm font-semibold">Định dạng<select value={format} onChange={e => setFormat(e.target.value as ExportFormat)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal dark:border-slate-700 dark:bg-slate-950"><option value="csv">CSV / ZIP — nhẹ hơn</option><option value="xlsx">Excel — 4 sheets</option></select></label>
                    </div>
                    <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-800 md:flex-row md:items-center md:justify-between"><p className="text-sm text-slate-500">Phạm vi: <span className="font-semibold text-slate-800 dark:text-slate-200">{scopeLabel}</span>. Notes sẽ xuất dạng sparse, bỏ toàn bộ giá trị rỗng và bằng 0.</p><button type="button" onClick={() => void downloadStatements()} disabled={status === 'loading' || fromYear > toYear || !exchanges.length || (scope === 'industry' && !sector) || (scope === 'ticker' && !(selectedTicker || query.trim()))} className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">{status === 'loading' ? <><ButtonIcon type="spin" />Đang tạo file…</> : status === 'done' ? <><ButtonIcon type="check" />Đã tải</> : <><ButtonIcon type="download" />Tải 4 bảng BCTC</>}</button></div>
                    {message && <p className="px-5 pb-4 text-sm text-red-600 dark:text-red-400">{message}</p>}
                </section>

                <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{TABLES.map(([name, label]) => <div key={name} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p className="text-sm font-bold">{label}</p><p className="mt-1 text-xs text-slate-500">{name === 'note' ? 'Dạng sparse, không xuất ô 0/rỗng' : 'Tên cột tiếng Anh, lọc theo kỳ'}</p></div>)}</section>
                <p className="text-xs text-slate-400">Khuyến nghị CSV/ZIP cho toàn ngành hoặc toàn thị trường vì nhẹ hơn và không bị giới hạn kích thước Excel. Excel phù hợp khi tải một mã hoặc phạm vi nhỏ.</p>
            </div>
        </main>
    );
}
