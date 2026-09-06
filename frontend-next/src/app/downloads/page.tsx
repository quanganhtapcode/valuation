'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/lib/languageContext';
import { translations } from '@/lib/translations';

type Scope = 'ticker' | 'industry' | 'market';
type ExportFormat = 'csv' | 'xlsx';
type PeriodKind = 'year' | 'quarter' | 'all';
type Status = 'idle' | 'loading' | 'done' | 'error';
type Ticker = { symbol: string; name: string; en_name?: string; sector?: string };
type TableId = 'income_statement' | 'balance_sheet' | 'cash_flow' | 'note';
type DataTableId = TableId | 'stock_metrics' | 'stock_metrics_history';
type DownloadTab = 'query' | 'variables' | 'manuals' | 'faqs' | 'datasets';
type FieldCodeSection = 'INCOME_STATEMENT' | 'BALANCE_SHEET' | 'CASH_FLOW' | 'NOTE';
type FieldCode = { field: string; level?: number; titleVi?: string; titleEn?: string; fullTitleVi?: string; fullTitleEn?: string };
type FieldCodeMap = Partial<Record<FieldCodeSection, FieldCode[]>>;
type DirectoryHandle = { getDirectoryHandle(name: string, options: { create: boolean }): Promise<DirectoryHandle>; getFileHandle(name: string, options: { create: boolean }): Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }> };

const EXCHANGES = ['HOSE', 'HNX', 'UPCOM'];
const TABLE_IDS: TableId[] = ['income_statement', 'balance_sheet', 'cash_flow', 'note'];
const TABLES: Array<{ id: DataTableId; vi: string[]; en: string[] }> = [
    ...TABLE_IDS.map((id) => ({ id, vi: translations.vi.downloads.dataTables[id], en: translations.en.downloads.dataTables[id] })),
    { id: 'stock_metrics', vi: ['Chỉ số cổ phiếu', 'Định giá, sinh lời, thanh khoản và chỉ số ngân hàng'], en: ['Stock metrics', 'Valuation, profitability, liquidity, and banking metrics'] },
    { id: 'stock_metrics_history', vi: ['Lịch sử chỉ số cổ phiếu', 'Chuỗi PE, PB, ROE, ROA và các chỉ số theo năm hoặc quý'], en: ['Stock metric history', 'PE, PB, ROE, ROA, and other annual or quarterly metric history'] },
];
const TAB_IDS: DownloadTab[] = ['query', 'variables', 'manuals', 'faqs', 'datasets'];
const TABS = TAB_IDS.map((id) => ({ id, vi: translations.vi.downloads.tabs[id], en: translations.en.downloads.tabs[id] }));
const FIELD_SECTIONS: Array<{ id: FieldCodeSection; tableId: TableId }> = [
    { id: 'INCOME_STATEMENT', tableId: 'income_statement' },
    { id: 'BALANCE_SHEET', tableId: 'balance_sheet' },
    { id: 'CASH_FLOW', tableId: 'cash_flow' },
    { id: 'NOTE', tableId: 'note' },
];

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
    return <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">{n}</span><h2 className="font-bold">{title}</h2></div><div className="p-5">{children}</div></section>;
}

export default function DownloadsPage() {
    const { lang } = useLanguage();
    const c = translations[lang].downloads;
    const currentYear = new Date().getFullYear();
    const years = useMemo(() => Array.from({ length: currentYear - 2010 + 1 }, (_, i) => currentYear - i), [currentYear]);
    const [tickers, setTickers] = useState<Ticker[]>([]);
    const [scope, setScope] = useState<Scope>('ticker');
    const [query, setQuery] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [exchanges, setExchanges] = useState<string[]>(EXCHANGES);
    const [sector, setSector] = useState('');
    const [fromYear, setFromYear] = useState(2020);
    const [toYear, setToYear] = useState(currentYear);
    const [fromQuarter, setFromQuarter] = useState(1);
    const [toQuarter, setToQuarter] = useState(4);
    const [periodKind, setPeriodKind] = useState<PeriodKind>('year');
    const [format, setFormat] = useState<ExportFormat>('csv');
    const [selectedTables, setSelectedTables] = useState<DataTableId[]>(TABLES.map((table) => table.id));
    const [status, setStatus] = useState<Status>('idle');
    const [originalStatus, setOriginalStatus] = useState<Status>('idle');
    const [progress, setProgress] = useState([0, 0]);
    const [message, setMessage] = useState('');
    const [activeTab, setActiveTab] = useState<DownloadTab>('query');
    const [fieldCodes, setFieldCodes] = useState<FieldCodeMap>({});
    const [fieldCodesLoading, setFieldCodesLoading] = useState(false);
    const [fieldCodesLoaded, setFieldCodesLoaded] = useState(false);
    const [fieldSection, setFieldSection] = useState<FieldCodeSection>('INCOME_STATEMENT');

    useEffect(() => { void (async () => {
        try {
            const response = await fetch('/api/tickers', { cache: 'force-cache' });
            if (!response.ok) throw new Error();
            const data = await response.json() as { tickers?: Ticker[] } | Ticker[];
            setTickers(Array.isArray(data) ? data : data.tickers ?? []);
        } catch {
            try {
                const response = await fetch('/ticker_data.json', { cache: 'force-cache' });
                setTickers(((await response.json()) as { tickers?: Ticker[] }).tickers ?? []);
            } catch { setMessage(c.errorTickers); }
        }
    })(); }, [c.errorTickers]);

    useEffect(() => {
        if (activeTab !== 'variables' || fieldCodesLoading || fieldCodesLoaded) return;
        setFieldCodesLoading(true);
        void fetch('/api/financial-field-codes', { cache: 'force-cache' })
            .then((response) => { if (!response.ok) throw new Error(); return response.json() as Promise<FieldCodeMap>; })
            .then(setFieldCodes)
            .catch(() => setFieldCodes({}))
            .finally(() => { setFieldCodesLoaded(true); setFieldCodesLoading(false); });
    }, [activeTab, fieldCodesLoaded, fieldCodesLoading]);

    const sectors = useMemo(() => Array.from(new Set(tickers.map((ticker) => ticker.sector).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'vi')), [tickers]);
    const symbols = query.split(/[\s,]+/).map((value) => value.trim().toUpperCase()).filter(Boolean);
    const activeTickerQuery = query.split(/[\s,]+/).at(-1)?.trim().toUpperCase() ?? '';
    const suggestions = useMemo(() => {
        if (!showSuggestions || scope !== 'ticker' || !activeTickerQuery) return [];
        return tickers.filter((ticker) => ticker.symbol.startsWith(activeTickerQuery) || ticker.name?.toUpperCase().includes(activeTickerQuery) || ticker.en_name?.toUpperCase().includes(activeTickerQuery)).slice(0, 8).map((ticker) => lang === 'en' ? { ...ticker, name: ticker.en_name || ticker.name } : ticker);
    }, [activeTickerQuery, lang, scope, showSuggestions, tickers]);
    const scopeText = scope === 'ticker' ? (symbols.length > 1 ? `${symbols.length} ${c.tickers}` : symbols[0] || c.noTicker) : scope === 'industry' ? sector || c.noSector : c.allMarket;
    const canDownload = selectedTables.length > 0 && fromYear <= toYear && (scope !== 'ticker' || symbols.length > 0) && (scope !== 'industry' || !!sector) && (scope === 'ticker' || exchanges.length > 0);
    const params = (ticker?: string) => {
        const result = new URLSearchParams({ scope, from_year: `${fromYear}`, to_year: `${toYear}`, period_kind: periodKind, format, tables: selectedTables.join(',') });
        if (scope === 'ticker') result.set('tickers', ticker ?? symbols.join(',')); else result.set('exchanges', exchanges.join(','));
        if (scope === 'industry') result.set('sectors', sector);
        if (periodKind === 'quarter') { result.set('from_quarter', `${fromQuarter}`); result.set('to_quarter', `${toQuarter}`); }
        return result;
    };
    const saveBlob = (blob: Blob, filename: string) => { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); };
    const selectTicker = (ticker: Ticker) => { setQuery((value) => `${value.replace(/[^\s,]*$/, '')}${ticker.symbol} `); setShowSuggestions(false); };
    const toggleTable = (id: DataTableId) => setSelectedTables((value) => value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);

    const download = async () => {
        if (!canDownload) return;
        setStatus('loading'); setMessage('');
        try {
            if (format === 'xlsx' && scope === 'ticker' && symbols.length > 1) {
                const picker = (window as Window & { showDirectoryPicker?: () => Promise<DirectoryHandle> }).showDirectoryPicker;
                if (!picker) { setStatus('error'); setMessage(c.browser); return; }
                const directory = await (await picker()).getDirectoryHandle(`financials-${symbols.join('-')}`.slice(0, 80), { create: true });
                setProgress([0, symbols.length]);
                for (const [index, ticker] of symbols.entries()) {
                    const response = await fetch(`/api/financial-bulk-export?${params(ticker)}`, { cache: 'no-store' }); if (!response.ok) throw new Error();
                    const writable = await (await directory.getFileHandle(`${ticker}_${fromYear}-${toYear}.xlsx`, { create: true })).createWritable();
                    await writable.write(await response.blob()); await writable.close(); setProgress([index + 1, symbols.length]);
                }
            } else {
                const response = await fetch(`/api/financial-bulk-export?${params()}`, { cache: 'no-store' }); if (!response.ok) throw new Error();
                const filename = `${scope === 'ticker' ? (symbols.length === 1 ? symbols[0] : `${symbols.length}-tickers`) : `financials-${scope}`}_${fromYear}-${toYear}.${format === 'csv' ? 'zip' : 'xlsx'}`;
                saveBlob(await response.blob(), filename);
            }
            setStatus('done'); window.setTimeout(() => setStatus('idle'), 2500);
        } catch { setStatus('error'); setMessage(c.errorFile); }
    };
    const upload = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; setScope('ticker'); setShowSuggestions(false); setQuery((await file.text()).replace(/[^a-zA-Z0-9,\s]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()); event.target.value = ''; };
    const downloadOriginal = async () => {
        if (!symbols.length) return;
        if (symbols.length === 1) {
            setOriginalStatus('loading');
            try { const response = await fetch(`/api/stock/excel/${encodeURIComponent(symbols[0])}`); const data = await response.json() as { success?: boolean; url?: string }; if (!data.success || !data.url) throw new Error(); window.location.href = data.url; setOriginalStatus('done'); } catch { setMessage(c.errorOriginal); setOriginalStatus('error'); }
            return;
        }
        const picker = (window as Window & { showDirectoryPicker?: () => Promise<DirectoryHandle> }).showDirectoryPicker;
        if (!picker) { setMessage(c.browser); return; }
        setOriginalStatus('loading');
        try {
            const directory = await (await picker()).getDirectoryHandle(`vietcap-${symbols.join('-')}`.slice(0, 80), { create: true });
            const response = await fetch(`/api/stock/excel-manifest?${new URLSearchParams({ scope: 'ticker', tickers: symbols.join(',') })}`); if (!response.ok) throw new Error();
            const files = ((await response.json()) as { files?: Array<{ filename: string; url: string }> }).files ?? [];
            setProgress([0, files.length]);
            for (const [index, file] of files.entries()) { const fileResponse = await fetch(file.url); if (!fileResponse.ok) throw new Error(); const writable = await (await directory.getFileHandle(file.filename, { create: true })).createWritable(); await writable.write(await fileResponse.blob()); await writable.close(); setProgress([index + 1, files.length]); }
            setOriginalStatus('done');
        } catch { setMessage(c.errorOriginal); setOriginalStatus('error'); }
    };

    return <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100"><div className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6">
        <header className="mb-5"><h1 className="text-3xl font-bold leading-tight tracking-tight md:text-4xl">{c.title.split(' ')[0]} <span className="text-emerald-600 dark:text-emerald-400">{c.title.split(' ').slice(1).join(' ')}</span></h1><div className="mt-2 h-1 w-32 rounded bg-emerald-500" /><p className="mt-3 max-w-4xl text-sm text-slate-600 dark:text-slate-300 md:text-base">{c.intro}</p></header>
        <nav className="overflow-x-auto border-b border-slate-200 dark:border-slate-800"><div className="flex min-w-max">{TABS.map((tab) => <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`border-b-2 px-5 py-3 text-sm font-semibold ${activeTab === tab.id ? 'border-emerald-600 text-emerald-700 dark:text-emerald-300' : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400'}`}>{tab[lang]}</button>)}</div></nav>
        {activeTab === 'query' && <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]"><div className="space-y-5">
            <Step n={1} title={c.time}><div className="grid gap-4 sm:grid-cols-3"><label>{c.type}<select value={periodKind} onChange={(event) => setPeriodKind(event.target.value as PeriodKind)}><option value="year">{c.year}</option><option value="quarter">{c.quarter}</option><option value="all">{c.all}</option></select></label><label>{c.from}<select value={fromYear} onChange={(event) => setFromYear(+event.target.value)}>{years.map((year) => <option key={year}>{year}</option>)}</select></label><label>{c.to}<select value={toYear} onChange={(event) => setToYear(+event.target.value)}>{years.map((year) => <option key={year}>{year}</option>)}</select></label>{periodKind === 'quarter' && <><label>{c.fromQ}<select value={fromQuarter} onChange={(event) => setFromQuarter(+event.target.value)}>{[1, 2, 3, 4].map((quarter) => <option key={quarter} value={quarter}>Q{quarter}</option>)}</select></label><label>{c.toQ}<select value={toQuarter} onChange={(event) => setToQuarter(+event.target.value)}>{[1, 2, 3, 4].map((quarter) => <option key={quarter} value={quarter}>Q{quarter}</option>)}</select></label></>}</div></Step>
            <Step n={2} title={c.scope}>
                <div className="flex flex-wrap gap-2">{([['ticker', c.ticker], ['industry', c.industry], ['market', c.market]] as const).map(([id, label]) => <button key={id} onClick={() => { setScope(id); setShowSuggestions(false); }} className={`rounded-full border px-4 py-2 text-sm font-semibold ${scope === id ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}>{label}</button>)}</div>
                {scope === 'ticker' ? <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]"><label className="relative block text-sm font-semibold text-slate-800 dark:text-slate-200"><span className="mb-2 block">{c.symbol}</span><input value={query} onFocus={() => setShowSuggestions(true)} onKeyDown={(event) => { if (event.key === 'Escape') setShowSuggestions(false); }} onChange={(event) => { setQuery(event.target.value.toUpperCase()); setShowSuggestions(true); }} placeholder={c.symbolHint} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm font-normal text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" />{suggestions.length > 0 && <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">{suggestions.map((ticker) => <button key={ticker.symbol} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => selectTicker(ticker)} className="flex w-full gap-3 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"><b>{ticker.symbol}</b><span className="truncate text-xs text-slate-500">{ticker.name}</span></button>)}</div>}</label><label className="flex cursor-pointer items-end"><span className="w-full rounded-lg border border-dashed border-slate-300 px-4 py-3 text-center text-sm font-semibold text-slate-600 transition hover:border-emerald-500 hover:text-emerald-700 dark:border-slate-700 dark:text-slate-300 dark:hover:text-emerald-300">{c.upload}<input type="file" accept=".txt,text/plain" onChange={upload} className="sr-only" /></span></label></div> : <div className={`mt-5 grid gap-4 ${scope === 'industry' ? 'md:grid-cols-2' : ''}`}><fieldset><legend className="text-sm font-medium">{c.exchange}</legend><div className="mt-2 flex flex-wrap gap-2">{EXCHANGES.map((exchange) => <button key={exchange} type="button" aria-pressed={exchanges.includes(exchange)} onClick={() => setExchanges((value) => value.includes(exchange) ? value.filter((item) => item !== exchange) : [...value, exchange])} className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${exchanges.includes(exchange) ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-slate-200 text-slate-600 hover:border-emerald-400 dark:border-slate-700 dark:text-slate-300'}`}>{exchange}</button>)}</div></fieldset>{scope === 'industry' && <label className="block self-end text-sm font-medium">{c.sector}<select value={sector} onChange={(event) => setSector(event.target.value)} className="mt-2"><option value="">{c.chooseSector}</option>{sectors.map((item) => <option key={item}>{item}</option>)}</select></label>}</div>}
            </Step>
            <Step n={3} title={c.data}><p className="mb-4 text-sm text-slate-500">{c.dataHint}</p><div className="grid gap-3 sm:grid-cols-2">{TABLES.map((table) => <label key={table.id} className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${selectedTables.includes(table.id) ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/20' : 'border-slate-200 dark:border-slate-700'}`}><input type="checkbox" checked={selectedTables.includes(table.id)} onChange={() => toggleTable(table.id)} className="mt-1 accent-emerald-600" /><span><b>{table[lang][0]}</b><small className="mt-1 block text-slate-500">{table[lang][1]}</small></span></label>)}</div><button onClick={() => setSelectedTables(selectedTables.length === TABLES.length ? [] : TABLES.map((table) => table.id))} className="mt-4 text-xs font-semibold text-emerald-700 dark:text-emerald-400">{selectedTables.length === TABLES.length ? c.clear : c.select}</button></Step>
            <Step n={4} title={c.output}><div className="grid gap-3 sm:grid-cols-2"><label className="rounded-xl border p-4"><input className="mr-2 accent-emerald-600" type="radio" checked={format === 'csv'} onChange={() => setFormat('csv')} /><b>CSV / ZIP</b><small className="mt-2 block text-slate-500">{c.csv}</small></label><label className="rounded-xl border p-4"><input className="mr-2 accent-emerald-600" type="radio" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} /><b>Excel (.xlsx)</b><small className="mt-2 block text-slate-500">{c.xlsx}</small></label></div><div className="mt-5 flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-4 dark:bg-slate-950"><span className="text-sm text-slate-500">{scopeText} · {fromYear}–{toYear} · {selectedTables.length} {c.tables}</span><button onClick={download} disabled={!canDownload || status === 'loading'} className="rounded-lg bg-emerald-600 px-6 py-3 text-sm font-bold text-white disabled:opacity-50">{status === 'loading' ? c.creating : status === 'done' ? `✓ ${c.done}` : `↓ ${c.create}`}</button></div>{message && <p className="mt-3 text-sm text-rose-600">{message}</p>}</Step>
        </div><aside className="h-fit space-y-4 lg:sticky lg:top-5"><section className="rounded-xl border border-slate-200 p-5 dark:border-slate-800"><p className="text-xs font-bold uppercase tracking-wider text-slate-400">{c.summary}</p><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-3"><dt className="text-slate-500">{c.scope}</dt><dd className="text-right font-semibold">{scopeText}</dd></div><div className="flex justify-between"><dt className="text-slate-500">{c.period}</dt><dd>{fromYear}–{toYear}</dd></div><div className="flex justify-between"><dt className="text-slate-500">{c.tables}</dt><dd>{selectedTables.length}/{TABLES.length}</dd></div></dl></section><section className="rounded-xl border border-slate-200 p-5 dark:border-slate-800"><b>{c.original}</b><p className="mt-2 text-xs leading-5 text-slate-500">{c.originalHint}</p><button onClick={downloadOriginal} disabled={!symbols.length || originalStatus === 'loading'} className="mt-4 w-full rounded-lg border border-emerald-500 px-3 py-2.5 text-sm font-semibold text-emerald-700 disabled:opacity-50 dark:text-emerald-300">{originalStatus === 'loading' ? (progress[1] ? `${progress[0]}/${progress[1]}` : c.preparing) : symbols.length > 1 ? c.many : c.one}</button></section></aside></div>}
        {activeTab === 'variables' && <><ExportSchema lang={lang} /><VariablesReference title={c.tabs.variables} lang={lang} fieldCodes={fieldCodes} loading={fieldCodesLoading} selectedSection={fieldSection} onSelectSection={setFieldSection} /></>}
        {activeTab === 'manuals' && <Reference title={c.tabs.manuals}><div className="grid gap-4 md:grid-cols-3">{c.guides.map(([title, description]) => <div key={title} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-950"><b>{title}</b><p className="mt-2 text-sm text-slate-500">{description}</p></div>)}</div></Reference>}
        {activeTab === 'faqs' && <Reference title={c.tabs.faqs}>{c.faqItems.map(([question, answer]) => <details key={question} className="border-b border-slate-100 py-3 dark:border-slate-800"><summary className="cursor-pointer font-semibold">{question}</summary><p className="mt-2 text-sm text-slate-500">{answer}</p></details>)}</Reference>}
        {activeTab === 'datasets' && <Reference title={c.tabs.datasets}><div className="grid gap-3 sm:grid-cols-2">{TABLES.map((table) => <div key={table.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"><b>{table[lang][0]}</b><p className="mt-1 font-mono text-xs text-emerald-700 dark:text-emerald-400">{table.id}</p><p className="mt-3 text-sm text-slate-500">{table[lang][1]}</p></div>)}</div></Reference>}
    </div></main>;
}

function ExportSchema({ lang }: { lang: 'vi' | 'en' }) {
    const copy = lang === 'vi'
        ? {
            title: 'Cấu trúc dữ liệu tải xuống',
            headers: ['Dataset / sheet', 'Tên cột', 'Kiểu dữ liệu', 'Ý nghĩa', 'Đơn vị & kỳ'],
            rows: [
                ['Báo cáo tài chính', 'Năm / Quý', 'integer', 'Các cột dữ liệu là từng kỳ báo cáo; tên dòng là chỉ tiêu BCTC.', 'VND; năm, quý hoặc cả hai'],
                ['Stock Metrics', 'ticker, pe, pb, roe, roa, ...', 'string / float', 'Snapshot chỉ số mới nhất của mã tại thời điểm xuất file.', 'x hoặc %; TTM / mới nhất'],
                ['Stock Metrics History', 'ticker, year_report, quarter_report, pe, pb, roe, roa, ...', 'string / integer / float', 'Chuỗi lịch sử chỉ số theo kỳ, phù hợp để so sánh xu hướng.', 'x hoặc %; quý 1–4, năm = 5'],
                ['Thuyết minh', 'field_code, field_name_en, value', 'string / float', 'Các khoản thuyết minh có giá trị, xuất dạng danh sách thay vì ma trận.', 'VND; theo kỳ báo cáo'],
            ],
        }
        : {
            title: 'Download data schema',
            headers: ['Dataset / sheet', 'Columns', 'Data type', 'Meaning', 'Unit & period'],
            rows: [
                ['Financial statements', 'Year / Quarter', 'integer', 'Each data column is a reporting period; rows are financial-statement items.', 'VND; annual, quarterly, or both'],
                ['Stock Metrics', 'ticker, pe, pb, roe, roa, ...', 'string / float', 'Latest metric snapshot for the ticker at export time.', 'x or %; TTM / latest'],
                ['Stock Metrics History', 'ticker, year_report, quarter_report, pe, pb, roe, roa, ...', 'string / integer / float', 'Historical metric series for trend analysis.', 'x or %; quarter 1–4, annual = 5'],
                ['Notes', 'field_code, field_name_en, value', 'string / float', 'Non-empty note items, exported as a list rather than a matrix.', 'VND; reporting period'],
            ],
        };
    return <Reference title={copy.title}><div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-left text-sm"><thead><tr className="border-b border-slate-200 text-xs font-bold uppercase text-slate-500 dark:border-slate-800">{copy.headers.map((header) => <th key={header} className="px-3 py-3 first:pl-0">{header}</th>)}</tr></thead><tbody>{copy.rows.map((row) => <tr key={row[0]} className="border-b border-slate-100 align-top dark:border-slate-800">{row.map((value, index) => <td key={index} className="px-3 py-3 first:pl-0">{index === 1 ? <code className="text-xs text-emerald-700 dark:text-emerald-300">{value}</code> : value}</td>)}</tr>)}</tbody></table></div></Reference>;
}

function VariablesReference({ title, lang, fieldCodes, loading, selectedSection, onSelectSection }: { title: string; lang: 'vi' | 'en'; fieldCodes: FieldCodeMap; loading: boolean; selectedSection: FieldCodeSection; onSelectSection: (section: FieldCodeSection) => void }) {
    const fields = fieldCodes[selectedSection] ?? [];
    return <Reference title={title}><div className="border-b border-slate-200 dark:border-slate-800"><div className="flex overflow-x-auto" role="tablist" aria-label={title}>{FIELD_SECTIONS.map((section) => { const table = TABLES.find((item) => item.id === section.tableId)!; return <button key={section.id} type="button" role="tab" aria-selected={selectedSection === section.id} onClick={() => onSelectSection(section.id)} className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold ${selectedSection === section.id ? 'border-emerald-600 text-emerald-700 dark:text-emerald-300' : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400'}`}>{table[lang][0]}</button>; })}</div></div>{loading && <p className="py-6 text-sm text-slate-500">{lang === 'vi' ? 'Đang tải danh mục biến…' : 'Loading field catalog…'}</p>}{!loading && fields.length === 0 && <p className="py-6 text-sm text-slate-500">{lang === 'vi' ? 'Chưa có danh mục biến.' : 'The field catalog is unavailable.'}</p>}{!loading && fields.length > 0 && <div className="divide-y divide-slate-100 dark:divide-slate-800">{fields.map((field) => { const primary = lang === 'vi' ? field.fullTitleVi || field.titleVi : field.fullTitleEn || field.titleEn; const secondary = lang === 'vi' ? field.fullTitleEn || field.titleEn : field.fullTitleVi || field.titleVi; const indent = Math.min(Math.max((field.level ?? 1) - 1, 0), 3) * 16; return <div key={field.field} className="grid gap-1 py-3 sm:grid-cols-[minmax(150px,220px)_minmax(0,1fr)] sm:gap-4" style={{ paddingInlineStart: indent }}><code className="self-start rounded bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{field.field}</code><div><p className="text-sm font-medium">{primary || field.field}</p>{secondary && secondary !== primary && <p className="mt-1 text-xs text-slate-500">{secondary}</p>}</div></div>; })}</div>}</Reference>;
}

function Reference({ title, children }: { title: string; children: React.ReactNode }) {
    return <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 md:p-7"><h2 className="text-xl font-bold">{title}</h2><div className="mt-5">{children}</div></section>;
}
