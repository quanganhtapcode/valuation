'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { formatNumber } from '@/lib/api';
import { Card, Title, Text, Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@tremor/react';
import { cx } from '@/lib/utils';

type DisplayMode = 'annual' | 'quarterly';
type ReportType = 'key_stats' | 'ratio' | 'income' | 'balance' | 'cashflow' | 'note';
type StatementWindow = '4' | '8' | '12' | 'all';

interface FinancialsTabProps {
    symbol: string;
    period?: 'quarter' | 'year';
    setPeriod?: (p: 'quarter' | 'year') => void;
    initialChartData?: any;
    initialOverviewData?: any;
    isLoading?: boolean;
    onDownloadExcel?: () => void;
}

const TABS: { id: ReportType; label: string }[] = [
    { id: 'key_stats', label: 'Key Stats' },
    { id: 'ratio', label: 'Ratios' },
    { id: 'income', label: 'Income' },
    { id: 'balance', label: 'Balance Sheet' },
    { id: 'cashflow', label: 'Cash Flow' },
    { id: 'note', label: 'Note' },
];

const BANK_SYMBOLS = new Set(['VCB','BID','CTG','TCB','MBB','ACB','VPB','HDB','SHB','STB','TPB','LPB','MSB','OCB','EIB','ABB','NAB','PGB','VAB','VIB','SSB','BAB','KLB','BVB','KBS','SGB','NVB']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, decimals = 0): string {
    if (v === null || v === undefined || Number.isNaN(v)) return '-';
    return formatNumber(v, { maximumFractionDigits: decimals });
}

function fmtPct(v: number | null | undefined, decimals = 1): string {
    if (v === null || v === undefined || Number.isNaN(v)) return '-';
    // Values < 2 are likely decimals (e.g. 0.16 = 16%), multiply by 100
    const displayValue = Math.abs(v) < 2 ? v * 100 : v;
    return `${displayValue.toFixed(decimals)}%`;
}

function renderPeriod(row: Record<string, any>): string {
    const year = row?.year ?? row?.year_report ?? row?.yearReport;
    const quarter = row?.quarter ?? row?.quarter_report ?? row?.quarterReport;
    if (quarter && Number(quarter) > 0) return `Q${quarter}/${year}`;
    if (year) return String(year);
    return '-';
}

function periodSortKey(row: Record<string, any>): number {
    const year = Number(row?.year ?? row?.year_report ?? row?.yearReport ?? 0);
    const quarter = Number(row?.quarter ?? row?.quarter_report ?? row?.quarterReport ?? 0);
    return year * 10 + quarter;
}

function isBankStock(symbol: string, overviewData: any): boolean {
    if (BANK_SYMBOLS.has(symbol)) return true;
    const nim = overviewData?.nim ?? overviewData?.net_interest_margin;
    if (nim !== null && nim !== undefined && Number(nim) > 0) return true;
    return false;
}

// ── Key Metrics Config ────────────────────────────────────────────────────────

const NORMAL_KEY_METRICS = [
    { key: 'revenue', label: 'Doanh thu', fields: ['total_revenues', 'isa1'] },
    { key: 'gross_profit', label: 'Lợi nhuận gộp', fields: ['gross_profit', 'isa5'] },
    { key: 'operating_profit', label: 'Lợi nhuận HĐKD', fields: ['operating_profit', 'isa9'] },
    { key: 'net_income', label: 'Lợi nhuận ròng', fields: ['consolidated_net_income', 'isa22'] },
    { key: 'eps', label: 'EPS (VND)', fields: ['basic_eps', 'isa23'] },
    { key: 'pe', label: 'P/E', fields: ['pe', 'ttmPe'] },
    { key: 'pb', label: 'P/B', fields: ['pb', 'ttmPb'] },
    { key: 'roe', label: 'ROE', fields: ['roe', 'ttmRoe'], isPct: true },
    { key: 'roa', label: 'ROA', fields: ['roa'], isPct: true },
    { key: 'net_margin', label: 'Biên LN ròng', fields: ['net_profit_margin', 'netMargin'], isPct: true },
];

const BANK_KEY_METRICS = [
    { key: 'net_interest_income', label: 'Thu nhập lãi thuần', fields: ['net_interest_income'] },
    { key: 'non_interest_income', label: 'Thu nhập ngoài lãi', fields: ['non_interest_income'] },
    { key: 'pre_tax_profit', label: 'Lợi nhuận trước thuế', fields: ['income_before_tax', 'isa16'] },
    { key: 'net_income', label: 'Lợi nhuận ròng', fields: ['consolidated_net_income', 'isa22'] },
    { key: 'eps', label: 'EPS (VND)', fields: ['basic_eps', 'isa23'] },
    { key: 'nim', label: 'NIM', fields: ['nim', 'net_interest_margin'], isPct: true },
    { key: 'cir', label: 'CIR', fields: ['cir'], isPct: true },
    { key: 'roe', label: 'ROE', fields: ['roe', 'ttmRoe'], isPct: true },
    { key: 'roa', label: 'ROA', fields: ['roa'], isPct: true },
    { key: 'npl', label: 'NPL', fields: ['npl'], isPct: true },
    { key: 'casa', label: 'CASA', fields: ['casa_ratio'], isPct: true },
    { key: 'car', label: 'CAR', fields: ['car'], isPct: true },
];

// Key metrics for Cash Flow (only important items)
const CASHFLOW_KEY_METRICS = [
    { key: 'cfa1', label: 'LN trước thuế' },
    { key: 'cfa18', label: 'Lưu chuyển tiền từ HĐKD' },
    { key: 'cfa19', label: 'Tiền mua sắm TSCĐ' },
    { key: 'cfa26', label: 'Lưu chuyển tiền từ HĐĐT' },
    { key: 'cfa34', label: 'Lưu chuyển tiền từ HĐTC' },
    { key: 'cfa35', label: 'Lưu chuyển tiền thuần trong kỳ' },
    { key: 'cfa38', label: 'Tiền và tương đương tiền cuối kỳ' },
];

// Key metrics for Note (only important items)
const NOTE_KEY_METRICS = [
    { key: 'noc1', label: 'Thuế TNDN phải nộp' },
    { key: 'noc2', label: 'Chi phí lãi vay' },
    { key: 'noc3', label: 'Khấu hao TSCĐ' },
    { key: 'noc4', label: 'Chi phí nhân viên' },
    { key: 'noc5', label: 'Doanh thu bán hàng' },
];

// ── Main Component ────────────────────────────────────────────────────────────

export default function FinancialsTab({
    symbol,
    period,
    setPeriod,
    initialChartData,
    initialOverviewData,
    isLoading: parentLoading = false,
    onDownloadExcel,
}: FinancialsTabProps) {
    const [loading, setLoading] = useState(false);
    const [reportLoading, setReportLoading] = useState(false);
    const [activeSubTab, setActiveSubTab] = useState<ReportType>('key_stats');
    const [displayMode, setDisplayMode] = useState<DisplayMode>('annual');
    const [statementWindow, setStatementWindow] = useState<StatementWindow>('4');
    const [overviewData, setOverviewData] = useState<any>(null);
    const [reportData, setReportData] = useState({ income: [], balance: [], cashflow: [], note: [], ratio: [] });
    const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({});

    const effectivePeriod = period || (displayMode === 'annual' ? 'year' : 'quarter');
    const isBank = isBankStock(symbol, overviewData);

    const windowSize = statementWindow === 'all' ? 100 : Number(statementWindow);

    // ── Fetch data ────────────────────────────────────────────────────────────

    useEffect(() => {
        if (initialOverviewData) setOverviewData(initialOverviewData);
    }, [initialOverviewData]);

    // Fetch field labels (map field codes → Vietnamese labels)
    useEffect(() => {
        Promise.allSettled([
            fetch(`/api/financial-report-metrics/${symbol}?type=income`).then(r => r.json()),
            fetch(`/api/financial-report-metrics/${symbol}?type=balance`).then(r => r.json()),
            fetch(`/api/financial-report-metrics/${symbol}?type=cashflow`).then(r => r.json()),
        ]).then(([incomeMeta, balanceMeta, cashflowMeta]) => {
            const unwrap = (res: PromiseSettledResult<any>) => {
                if (res.status !== 'fulfilled' || !res.value) return {};
                // API returns {data: [...], field_map: {isa1: '...'}, field_map_en: {...}}
                // Prefer Vietnamese labels (field_map), fallback to English (field_map_en)
                return res.value.field_map || res.value.field_map_en || {};
            };
            const labels: Record<string, string> = {};
            Object.assign(labels, unwrap(incomeMeta), unwrap(balanceMeta), unwrap(cashflowMeta));
            console.log('[FinancialsTab] Field labels loaded:', Object.keys(labels).length, 'mappings');
            setFieldLabels(labels);
        }).catch(err => console.error('[FinancialsTab] Failed to load field labels:', err));
    }, [symbol]);

    // Fetch financial reports
    useEffect(() => {
        const controller = new AbortController();
        setReportLoading(true);

        Promise.allSettled([
            fetch(`/api/financial-report/${symbol}?type=income&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report/${symbol}?type=balance&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report/${symbol}?type=cashflow&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report/${symbol}?type=note&period=${effectivePeriod}&limit=20`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report/${symbol}?type=ratio&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
        ]).then(([income, balance, cashflow, note, ratio]) => {
            if (controller.signal.aborted) return;
            const unwrap = (res: PromiseSettledResult<any>) => {
                if (res.status !== 'fulfilled') return [];
                const payload = res.value;
                return Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);
            };
            setReportData({
                income: unwrap(income).sort((a, b) => periodSortKey(b) - periodSortKey(a)).slice(0, windowSize),
                balance: unwrap(balance).sort((a, b) => periodSortKey(b) - periodSortKey(a)).slice(0, windowSize),
                cashflow: unwrap(cashflow).sort((a, b) => periodSortKey(b) - periodSortKey(a)).slice(0, windowSize),
                note: unwrap(note).sort((a, b) => periodSortKey(b) - periodSortKey(a)).slice(0, windowSize),
                ratio: unwrap(ratio).sort((a, b) => periodSortKey(b) - periodSortKey(a)).slice(0, windowSize),
            });
            setOverviewData(prev => prev || {});
        }).catch(() => {}).finally(() => {
            if (!controller.signal.aborted) setReportLoading(false);
        });

        return () => controller.abort();
    }, [symbol, effectivePeriod, windowSize]);

    // ── Extract metric value from report data ─────────────────────────────────

    const getMetricValue = useCallback((metricConfig: any, periodIndex: number, rows: any[]) => {
        if (!rows || rows.length === 0) return null;
        const row = rows[periodIndex];
        if (!row) return null;

        for (const field of metricConfig.fields) {
            const v = row[field];
            if (v !== null && v !== undefined && !Number.isNaN(Number(v))) {
                return Number(v);
            }
        }
        return null;
    }, []);

    // ── Render ────────────────────────────────────────────────────────────────

    if (loading || parentLoading) {
        return (
            <div className="flex items-center justify-center p-12">
                <div className="spinner" />
                <span className="ml-3 text-tremor-default text-tremor-content">Loading data...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* ── Tab Bar + Controls ──────────────────────────────────────── */}
            <Card className="p-3">
                <div className="flex flex-col md:flex-row md:items-center gap-3">
                    {/* Sub-tabs (desktop) */}
                    <div className="hidden md:flex items-center gap-1">
                        {TABS.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => { setActiveSubTab(tab.id); setStatementWindow('4'); }}
                                className={cx(
                                    'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                                    activeSubTab === tab.id
                                        ? 'bg-tremor-background-muted text-tremor-content-emphasis dark:bg-dark-tremor-background-muted dark:text-dark-tremor-content-emphasis'
                                        : 'text-tremor-content-subtle hover:text-tremor-content dark:text-dark-tremor-content-subtle hover:dark:text-dark-tremor-content'
                                )}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Right controls */}
                    <div className="hidden md:flex ml-auto items-center gap-2">
                        {/* Period selector */}
                        <div className="flex items-center rounded-md border border-tremor-border bg-tremor-background-muted p-0.5 dark:border-dark-tremor-border dark:bg-dark-tremor-background-muted">
                            {(['annual', 'quarterly'] as DisplayMode[]).map(m => (
                                <button
                                    key={m}
                                    onClick={() => setDisplayMode(m)}
                                    className={cx(
                                        'rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                                        displayMode === m
                                            ? 'bg-white text-tremor-content-emphasis shadow-sm dark:bg-dark-tremor-background dark:text-dark-tremor-content-emphasis'
                                            : 'text-tremor-content-subtle hover:text-tremor-content dark:text-dark-tremor-content-subtle'
                                    )}
                                >
                                    {m === 'annual' ? 'Năm' : 'Quý'}
                                </button>
                            ))}
                        </div>

                        {/* Window selector */}
                        {activeSubTab !== 'ratio' && activeSubTab !== 'key_stats' && (
                            <select
                                value={statementWindow}
                                onChange={e => setStatementWindow(e.target.value as StatementWindow)}
                                className="rounded-md border border-tremor-border bg-tremor-background-muted px-2 py-1 text-xs text-tremor-content dark:border-dark-tremor-border dark:bg-dark-tremor-background-muted dark:text-dark-tremor-content"
                            >
                                <option value="4">4 kỳ</option>
                                <option value="8">8 kỳ</option>
                                <option value="12">12 kỳ</option>
                                <option value="all">Tất cả</option>
                            </select>
                        )}

                        {/* Export */}
                        {onDownloadExcel && (
                            <button
                                onClick={onDownloadExcel}
                                title="Export Excel"
                                className="flex items-center justify-center rounded-md border border-tremor-border bg-tremor-background-muted p-1.5 text-tremor-content-subtle hover:bg-tremor-background dark:border-dark-tremor-border dark:bg-dark-tremor-background-muted dark:text-dark-tremor-content-subtle"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>

                {/* Mobile dropdowns - single sticky row */}
                <div className="sticky top-0 z-10 mt-3 flex gap-1.5 md:hidden bg-white dark:bg-gray-950 pb-1.5 -mx-1 px-1">
                    <select
                        value={activeSubTab}
                        onChange={e => { setActiveSubTab(e.target.value as ReportType); setStatementWindow('4'); }}
                        className="flex-1 min-w-0 rounded-md border border-tremor-border bg-tremor-background-muted px-2 py-1.5 text-xs text-tremor-content dark:border-dark-tremor-border dark:bg-dark-tremor-background-muted dark:text-dark-tremor-content"
                    >
                        {TABS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                    <select
                        value={displayMode}
                        onChange={e => setDisplayMode(e.target.value as DisplayMode)}
                        className="w-16 shrink-0 rounded-md border border-tremor-border bg-tremor-background-muted px-2 py-1.5 text-xs text-tremor-content dark:border-dark-tremor-border dark:bg-dark-tremor-background-muted dark:text-dark-tremor-content"
                    >
                        <option value="annual">Năm</option>
                        <option value="quarterly">Quý</option>
                    </select>
                    {activeSubTab !== 'ratio' && activeSubTab !== 'key_stats' && (
                        <select
                            value={statementWindow}
                            onChange={e => setStatementWindow(e.target.value as StatementWindow)}
                            className="w-14 shrink-0 rounded-md border border-tremor-border bg-tremor-background-muted px-1.5 py-1.5 text-xs text-tremor-content dark:border-dark-tremor-border dark:bg-dark-tremor-background-muted dark:text-dark-tremor-content"
                        >
                            <option value="4">4</option>
                            <option value="8">8</option>
                            <option value="12">12</option>
                            <option value="all">All</option>
                        </select>
                    )}
                    {onDownloadExcel && (
                        <button
                            onClick={onDownloadExcel}
                            title="Export Excel"
                            className="shrink-0 flex items-center justify-center rounded-md border border-tremor-border bg-tremor-background-muted p-1.5 text-tremor-content-subtle dark:border-dark-tremor-border dark:bg-dark-tremor-background-muted dark:text-dark-tremor-content-subtle"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                        </button>
                    )}
                </div>
            </Card>

            {/* ── Key Stats Tab ───────────────────────────────────────────── */}
            {activeSubTab === 'key_stats' && (
                <Card>
                    <Title>{isBank ? 'Chỉ số Ngân hàng' : 'Chỉ số Tài chính'}</Title>
                    <Text className="mb-4">{isBank ? 'Các chỉ số đặc thù ngân hàng' : 'Các chỉ số tài chính chính'}</Text>
                    {reportLoading ? (
                        <div className="flex items-center justify-center p-8">
                            <div className="spinner" />
                        </div>
                    ) : (
                        <>
                            {/* Desktop: horizontal table */}
                            <div className="hidden md:block overflow-x-auto">
                                <Table>
                                    <TableHead>
                                        <TableRow>
                                            <TableHeaderCell>Chỉ số</TableHeaderCell>
                                            {(isBank ? BANK_KEY_METRICS : NORMAL_KEY_METRICS).map(m => (
                                                <TableHeaderCell key={m.key} className="text-right">{m.label}</TableHeaderCell>
                                            ))}
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        <TableRow>
                                            <TableCell className="font-medium">Giá trị gần nhất</TableCell>
                                            {(isBank ? BANK_KEY_METRICS : NORMAL_KEY_METRICS).map(m => {
                                                const rows = m.key === 'pe' || m.key === 'pb' || m.key === 'roe' || m.key === 'roa' || m.key === 'nim' || m.key === 'cir' || m.key === 'npl' || m.key === 'casa' || m.key === 'car' || m.key === 'net_margin'
                                                    ? (reportData.ratio.length > 0 ? reportData.ratio : [overviewData])
                                                    : reportData.income.length > 0 ? reportData.income : [];
                                                const val = getMetricValue(m, 0, rows);
                                                return (
                                                    <TableCell key={m.key} className="text-right font-semibold">
                                                        {m.isPct ? fmtPct(val) : fmt(val)}
                                                    </TableCell>
                                                );
                                            })}
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Mobile: 2-column grid cards */}
                            <div className="md:hidden grid grid-cols-3 gap-2">
                                {(isBank ? BANK_KEY_METRICS : NORMAL_KEY_METRICS).map(m => {
                                    const rows = m.key === 'pe' || m.key === 'pb' || m.key === 'roe' || m.key === 'roa' || m.key === 'nim' || m.key === 'cir' || m.key === 'npl' || m.key === 'casa' || m.key === 'car' || m.key === 'net_margin'
                                        ? (reportData.ratio.length > 0 ? reportData.ratio : [overviewData])
                                        : reportData.income.length > 0 ? reportData.income : [];
                                    const val = getMetricValue(m, 0, rows);
                                    return (
                                        <div key={m.key} className="rounded-xl border border-tremor-border bg-gradient-to-b from-white to-tremor-background-muted p-2.5 text-center dark:border-dark-tremor-border dark:from-gray-900 dark:to-dark-tremor-background-muted shadow-sm">
                                            <div className="text-[9px] text-tremor-content-subtle dark:text-dark-tremor-content-subtle font-semibold uppercase tracking-wider truncate" title={m.label}>
                                                {m.label}
                                            </div>
                                            <div className="mt-0.5 text-base font-extrabold text-tremor-brand dark:text-dark-tremor-brand">
                                                {m.isPct ? fmtPct(val) : fmt(val)}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </Card>
            )}

            {/* ── Ratios Tab ──────────────────────────────────────────────── */}
            {activeSubTab === 'ratio' && (
                <Card>
                    <Title>Tỷ số tài chính</Title>
                    <Text className="mb-4">ROE, ROA, P/E, P/B, Biên lợi nhuận...</Text>
                    {reportLoading || reportData.ratio.length === 0 ? (
                        <div className="flex items-center justify-center p-8">
                            <div className="spinner" />
                        </div>
                    ) : (
                        <>
                            {/* Desktop: horizontal table */}
                            <div className="hidden md:block overflow-x-auto">
                                <Table>
                                    <TableHead>
                                        <TableRow>
                                            <TableHeaderCell>Chỉ số</TableHeaderCell>
                                            {reportData.ratio.slice(0, windowSize).map((row, i) => (
                                                <TableHeaderCell key={i} className="text-right">{renderPeriod(row)}</TableHeaderCell>
                                            ))}
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {Object.entries({
                                            roe: 'ROE',
                                            roa: 'ROA',
                                            price_to_earnings: 'P/E',
                                            price_to_book: 'P/B',
                                            net_profit_margin: 'Biên LN ròng',
                                            gross_margin: 'Biên LN gộp',
                                            ebit_margin: 'Biên EBIT',
                                            debt_to_equity: 'D/E',
                                            current_ratio: 'Current Ratio',
                                            quick_ratio: 'Quick Ratio',
                                            asset_turnover: 'Vòng quay TS',
                                            inventory_turnover: 'Vòng quay HTK',
                                        }).map(([key, label]) => (
                                            <TableRow key={key}>
                                                <TableCell className="font-medium">{label}</TableCell>
                                                {reportData.ratio.slice(0, windowSize).map((row, i) => {
                                                    const v = Number(row[key]);
                                                    const isPct = ['roe', 'roa', 'net_profit_margin', 'gross_margin', 'ebit_margin'].includes(key);
                                                    return (
                                                        <TableCell key={i} className="text-right font-semibold">
                                                            {Number.isNaN(v) || v === 0 ? '-' : (isPct ? fmtPct(v) : fmt(v, 2))}
                                                        </TableCell>
                                                    );
                                                })}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Mobile: vertical card list */}
                            <div className="md:hidden space-y-1.5">
                                {Object.entries({
                                    roe: 'ROE',
                                    roa: 'ROA',
                                    price_to_earnings: 'P/E',
                                    price_to_book: 'P/B',
                                    net_profit_margin: 'Biên LN ròng',
                                    gross_margin: 'Biên LN gộp',
                                    ebit_margin: 'Biên EBIT',
                                    debt_to_equity: 'D/E',
                                    current_ratio: 'Current Ratio',
                                    quick_ratio: 'Quick Ratio',
                                    asset_turnover: 'Vòng quay TS',
                                    inventory_turnover: 'Vòng quay HTK',
                                }).map(([key, label]) => {
                                    const latestRow = reportData.ratio[0];
                                    const v = latestRow ? Number(latestRow[key]) : null;
                                    const isPct = ['roe', 'roa', 'net_profit_margin', 'gross_margin', 'ebit_margin'].includes(key);
                                    const displayVal = (!v || Number.isNaN(v) || v === 0) ? '-' : (isPct ? fmtPct(v) : fmt(v, 2));

                                    return (
                                        <div key={key} className="flex items-center justify-between rounded-xl border border-tremor-border bg-gradient-to-r from-white to-tremor-background-muted/50 px-3 py-2 dark:border-dark-tremor-border dark:from-gray-900 dark:to-dark-tremor-background-muted/50 shadow-sm">
                                            <span className="text-sm font-medium text-tremor-content dark:text-dark-tremor-content">{label}</span>
                                            <span className="text-base font-extrabold text-tremor-brand dark:text-dark-tremor-brand">{displayVal}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </Card>
            )}

            {/* ── Income / Balance / Cashflow / Note Tabs ─────────────────── */}
            {['income', 'balance', 'cashflow', 'note'].includes(activeSubTab) && (
                <Card>
                    <Title>
                        {activeSubTab === 'income' && 'Báo cáo Kết quả kinh doanh'}
                        {activeSubTab === 'balance' && 'Bảng Cân đối kế toán'}
                        {activeSubTab === 'cashflow' && 'Báo cáo Lưu chuyển tiền tệ'}
                        {activeSubTab === 'note' && 'Thuyết minh BCTC'}
                    </Title>
                    <Text className="mb-4">Dữ liệu {effectivePeriod === 'year' ? 'năm' : 'quý'}</Text>
                    {reportLoading ? (
                        <div className="flex items-center justify-center p-8">
                            <div className="spinner" />
                        </div>
                    ) : (
                        <ReportTable
                            rows={reportData[activeSubTab as keyof typeof reportData] || []}
                            windowSize={windowSize}
                            isBank={isBank}
                            fieldLabels={fieldLabels}
                            tabType={activeSubTab as 'income' | 'balance' | 'cashflow' | 'note'}
                        />
                    )}
                </Card>
            )}
        </div>
    );
}

// ── Report Table Sub-component ────────────────────────────────────────────────

function ReportTable({ rows, windowSize, isBank, fieldLabels, tabType }: {
    rows: any[];
    windowSize: number;
    isBank: boolean;
    fieldLabels?: Record<string, string>;
    tabType?: 'income' | 'balance' | 'cashflow' | 'note';
}) {
    if (!rows || rows.length === 0) {
        return <Text className="text-center py-8 text-tremor-content-subtle">Không có dữ liệu</Text>;
    }

    // Get all metric keys (exclude year/quarter fields)
    const metricKeys = Object.keys(rows[0] || {}).filter(k =>
        !['symbol', 'ticker', 'year', 'quarter', 'year_report', 'quarter_report', 'yearReport', 'quarterReport', 'data_json', 'id', 'organ_code', 'organCode', 'source', 'period', 'create_date', 'update_date', 'public_date', 'created_at', 'updated_at'].includes(k)
    );

    // Show only non-zero metrics
    const significantKeys = metricKeys.filter(key => {
        return rows.some(row => {
            const v = Number(row[key]);
            return !Number.isNaN(v) && Math.abs(v) > 0.01;
        });
    });

    // For cashflow and note, use predefined key metrics on mobile
    const keyMetrics = tabType === 'cashflow' ? CASHFLOW_KEY_METRICS :
                       tabType === 'note' ? NOTE_KEY_METRICS : null;

    // For bank stocks, prioritize bank-specific metrics
    const displayKeys = significantKeys.slice(0, isBank ? 25 : 30);

    const formatLabel = (key: string): string => {
        // Try field label map first (isa1 → "Doanh thu bán hàng...")
        if (fieldLabels && fieldLabels[key]) return fieldLabels[key];
        // Fallback: convert snake_case to Title Case
        return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    };

    const isPercentKey = (key: string): boolean => {
        const k = key.toLowerCase();
        return k.includes('margin') || k.includes('roe') || k.includes('roa') ||
            k.includes('ratio') || k.includes('nim') || k.includes('cir') ||
            k.includes('npl') || k.includes('casa') || k.includes('car') ||
            k.includes('growth') || k.includes('turnover');
    };

    // Desktop: full horizontal table with all periods
    const DesktopTable = (
        <div className="hidden md:block overflow-x-auto">
            <Table>
                <TableHead>
                    <TableRow>
                        <TableHeaderCell className="sticky left-0 bg-white dark:bg-gray-900 z-10 min-w-[200px]">Chỉ tiêu</TableHeaderCell>
                        {rows.slice(0, windowSize).map((row, i) => (
                            <TableHeaderCell key={i} className="text-right">{renderPeriod(row)}</TableHeaderCell>
                        ))}
                    </TableRow>
                </TableHead>
                <TableBody>
                    {displayKeys.map(key => {
                        const hasAnyValue = rows.some(row => {
                            const v = Number(row[key]);
                            return !Number.isNaN(v) && Math.abs(v) > 0.01;
                        });
                        if (!hasAnyValue) return null;

                        const isPct = isPercentKey(key);

                        return (
                            <TableRow key={key}>
                                <TableCell className="sticky left-0 bg-white dark:bg-gray-900 z-10 font-medium text-sm break-words" style={{ minWidth: '180px', maxWidth: '250px' }}>
                                    {formatLabel(key)}
                                </TableCell>
                                {rows.slice(0, windowSize).map((row, i) => {
                                    const v = Number(row[key]);
                                    return (
                                        <TableCell key={i} className="text-right text-sm">
                                            {Number.isNaN(v) || Math.abs(v) < 0.01 ? '-' : (isPct ? fmtPct(v) : fmt(v))}
                                        </TableCell>
                                    );
                                })}
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );

    // Mobile: show only latest period (index 0), scroll horizontally for other periods
    const latestRow = rows[0] || {};

    const MobileCards = keyMetrics ? (
        <div className="md:hidden space-y-1.5">
            {keyMetrics.map(metric => {
                const v = latestRow ? Number(latestRow[metric.key]) : null;
                if (!v || Number.isNaN(v) || Math.abs(v) < 0.01) return null;
                return (
                    <div key={metric.key} className="flex items-center justify-between rounded-xl border border-tremor-border bg-gradient-to-r from-white to-tremor-background-muted/50 px-3 py-2 dark:border-dark-tremor-border dark:from-gray-900 dark:to-dark-tremor-background-muted/50 shadow-sm">
                        <span className="text-sm font-medium text-tremor-content dark:text-dark-tremor-content break-words flex-1 mr-2">{metric.label}</span>
                        <span className="text-base font-extrabold text-tremor-brand dark:text-dark-tremor-brand shrink-0">{fmt(v)}</span>
                    </div>
                );
            })}
        </div>
    ) : (
        <div className="md:hidden overflow-x-auto">
            <Table>
                <TableHead>
                    <TableRow>
                        <TableHeaderCell className="sticky left-0 bg-white dark:bg-gray-900 z-10 min-w-[180px] max-w-[250px] break-words">Chỉ tiêu</TableHeaderCell>
                        <TableHeaderCell className="text-right">{renderPeriod(latestRow)}</TableHeaderCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {displayKeys.map(key => {
                        const hasAnyValue = rows.some(row => {
                            const v = Number(row[key]);
                            return !Number.isNaN(v) && Math.abs(v) > 0.01;
                        });
                        if (!hasAnyValue) return null;

                        const isPct = isPercentKey(key);
                        const v = Number(latestRow[key]);

                        return (
                            <TableRow key={key}>
                                <TableCell className="sticky left-0 bg-white dark:bg-gray-900 z-10 font-medium text-sm break-words" style={{ minWidth: '180px', maxWidth: '250px' }}>
                                    {formatLabel(key)}
                                </TableCell>
                                <TableCell className="text-right text-sm font-semibold">
                                    {Number.isNaN(v) || Math.abs(v) < 0.01 ? '-' : (isPct ? fmtPct(v) : fmt(v))}
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );

    return (
        <>
            {DesktopTable}
            {MobileCards}
        </>
    );
}
