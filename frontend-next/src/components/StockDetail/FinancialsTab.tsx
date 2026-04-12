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
    { key: 'pe', label: 'P/E', fields: ['pe'] },
    { key: 'pb', label: 'P/B', fields: ['pb'] },
    { key: 'eps', label: 'EPS', fields: ['eps'] },
    { key: 'roe', label: 'ROE', fields: ['roe'], isPct: true },
    { key: 'roa', label: 'ROA', fields: ['roa'], isPct: true },
    { key: 'net_margin', label: 'Biên LN ròng', fields: ['net_profit_margin'], isPct: true },
    { key: 'pre_tax_margin', label: 'Biên LN trước thuế', fields: ['pre_tax_margin'], isPct: true },
    { key: 'debt_to_equity', label: 'D/E', fields: ['debt_to_equity'] },
    { key: 'ebit_margin', label: 'Biên EBIT', fields: ['ebit_margin'], isPct: true },
    { key: 'revenue_growth', label: 'Tăng trưởng DT', fields: ['revenue_growth_yoy'], isPct: true },
];

const BANK_KEY_METRICS = [
    { key: 'pe', label: 'P/E', fields: ['pe'] },
    { key: 'pb', label: 'P/B', fields: ['pb'] },
    { key: 'eps', label: 'EPS', fields: ['eps'] },
    { key: 'nim', label: 'NIM', fields: ['nim', 'net_interest_margin'], isPct: true },
    { key: 'cir', label: 'CIR', fields: ['cir'], isPct: true },
    { key: 'casa', label: 'CASA', fields: ['casa', 'casa_ratio'], isPct: true },
    { key: 'npl', label: 'NPL', fields: ['npl'], isPct: true },
    { key: 'roe', label: 'ROE', fields: ['roe'], isPct: true },
    { key: 'roa', label: 'ROA', fields: ['roa'], isPct: true },
    { key: 'car', label: 'CAR', fields: ['car'], isPct: true },
    { key: 'ldr', label: 'LDR', fields: ['ldr'], isPct: true },
    { key: 'net_margin', label: 'Biên LN ròng', fields: ['net_profit_margin'], isPct: true },
    { key: 'debt_to_equity', label: 'D/E', fields: ['debt_to_equity'] },
];

// Key metrics for Cash Flow (only important items)
const CASHFLOW_KEY_METRICS = [
    { key: 'cfa1', label: 'LN trước thuế' },
    { key: 'cfa18', label: 'LC tiền từ HĐKD' },
    { key: 'cfa19', label: 'Tiền mua sắm TSCĐ' },
    { key: 'cfa26', label: 'LC tiền từ HĐĐT' },
    { key: 'cfa34', label: 'LC tiền từ HĐTC' },
    { key: 'cfa35', label: 'LC tiền thuần trong kỳ' },
    { key: 'cfa38', label: 'Tiền và TĐT cuối kỳ' },
];

// Key metrics for Note (only important items)
const NOTE_KEY_METRICS = [
    { key: 'noc1', label: 'Thuế TNDN phải nộp' },
    { key: 'noc2', label: 'Chi phí lãi vay' },
    { key: 'noc3', label: 'Khấu hao TSCĐ' },
    { key: 'noc4', label: 'Chi phí nhân viên' },
    { key: 'noc5', label: 'Doanh thu bán hàng' },
];

// ── Unified Table Component ───────────────────────────────────────────────────

function UnifiedTable({
    rows,
    windowSize,
    metrics,
    fieldLabels,
    useRowLabels,
    isPctKey,
    valueFormatter,
}: {
    rows: any[];
    windowSize: number;
    metrics: { key: string; label: string; isPct?: boolean }[];
    fieldLabels?: Record<string, string>;
    useRowLabels?: boolean;
    isPctKey?: (key: string) => boolean;
    valueFormatter?: (key: string, row: any) => string;
}) {
    if (!rows || rows.length === 0) {
        return <Text className="text-center py-8 text-tremor-content-subtle">Không có dữ liệu</Text>;
    }

    const formatLabel = (key: string): string => {
        if (fieldLabels && fieldLabels[key]) return fieldLabels[key];
        return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    };

    const fmtValue = (key: string, row: any, isPct?: boolean): string => {
        if (valueFormatter) return valueFormatter(key, row);
        const v = Number(row[key]);
        if (Number.isNaN(v) || Math.abs(v) < 0.01) return '-';
        return isPct ? fmtPct(v) : fmt(v);
    };

    const getPctFlag = (key: string): boolean => {
        if (isPctKey) return isPctKey(key);
        return metrics.find(m => m.key === key)?.isPct || false;
    };

    // Get all metric keys for dynamic tables (income/balance/cashflow/note)
    const dynamicKeys = useRowLabels
        ? Object.keys(rows[0] || {}).filter(k =>
            !['symbol', 'ticker', 'year', 'quarter', 'year_report', 'quarter_report', 'yearReport', 'quarterReport', 'data_json', 'id', 'organ_code', 'organCode', 'source', 'period', 'create_date', 'update_date', 'public_date', 'created_at', 'updated_at'].includes(k)
          )
        : metrics.map(m => m.key);

    // Filter to only non-zero keys for dynamic tables
    const displayKeys = useRowLabels
        ? dynamicKeys.filter(key => rows.some(row => { const v = Number(row[key]); return !Number.isNaN(v) && Math.abs(v) > 0.01; }))
        : metrics.map(m => m.key);

    // Limit columns for dynamic tables
    const finalKeys = useRowLabels ? displayKeys.slice(0, 30) : displayKeys;

    return (
        <div className="overflow-x-auto">
            <Table>
                <TableHead>
                    <TableRow>
                        <TableHeaderCell className="sticky left-0 bg-white dark:bg-gray-900 z-10 min-w-[140px] md:min-w-[200px] text-xs md:text-sm whitespace-nowrap">
                            Chỉ tiêu
                        </TableHeaderCell>
                        {rows.slice(0, windowSize).map((row, i) => (
                            <TableHeaderCell key={i} className="text-right text-xs md:text-sm whitespace-nowrap">{renderPeriod(row)}</TableHeaderCell>
                        ))}
                    </TableRow>
                </TableHead>
                <TableBody>
                    {finalKeys.map((key, idx) => {
                        const metric = metrics.find(m => m.key === key);
                        const label = metric?.label || formatLabel(key);
                        const isPct = metric?.isPct || getPctFlag(key);

                        return (
                            <TableRow key={key}>
                                <TableCell className="sticky left-0 bg-white dark:bg-gray-900 z-10 font-medium text-xs md:text-sm break-words whitespace-normal" style={{ minWidth: '140px', maxWidth: '250px' }}>
                                    {label}
                                </TableCell>
                                {rows.slice(0, windowSize).map((row, i) => (
                                    <TableCell key={i} className="text-right text-xs md:text-sm font-semibold tabular-nums whitespace-nowrap">
                                        {fmtValue(key, row, isPct)}
                                    </TableCell>
                                ))}
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}

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

    // Fetch field labels
    useEffect(() => {
        Promise.allSettled([
            fetch(`/api/financial-report-metrics/${symbol}?type=income`).then(r => r.json()),
            fetch(`/api/financial-report-metrics/${symbol}?type=balance`).then(r => r.json()),
            fetch(`/api/financial-report-metrics/${symbol}?type=cashflow`).then(r => r.json()),
        ]).then(([incomeMeta, balanceMeta, cashflowMeta]) => {
            const unwrap = (res: PromiseSettledResult<any>) => {
                if (res.status !== 'fulfilled' || !res.value) return {};
                return res.value.field_map || res.value.field_map_en || {};
            };
            const labels: Record<string, string> = {};
            Object.assign(labels, unwrap(incomeMeta), unwrap(balanceMeta), unwrap(cashflowMeta));
            setFieldLabels(labels);
        }).catch(() => {});
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
        }).catch(() => {}).finally(() => {
            if (!controller.signal.aborted) setReportLoading(false);
        });

        return () => controller.abort();
    }, [symbol, effectivePeriod, windowSize]);

    // ── Render ────────────────────────────────────────────────────────────────

    if (loading || parentLoading) {
        return (
            <div className="flex items-center justify-center p-12">
                <div className="spinner" />
                <span className="ml-3 text-tremor-default text-tremor-content">Loading data...</span>
            </div>
        );
    }

    const getMetricValue = (metric: any): string => {
        const src = overviewData || {};
        for (const field of metric.fields) {
            const v = src[field];
            if (v !== null && v !== undefined && !Number.isNaN(Number(v))) {
                return metric.isPct ? fmtPct(Number(v)) : fmt(Number(v));
            }
        }
        return '-';
    };

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

                    {/* Right controls (desktop) */}
                    <div className="hidden md:flex ml-auto items-center gap-2">
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
                    <Text className="mb-4">{isBank ? 'Các chỉ số đặc thù ngân hàng (TTM)' : 'Các chỉ số tài chính chính (TTM)'}</Text>
                    {reportLoading ? (
                        <div className="flex items-center justify-center p-8">
                            <div className="spinner" />
                        </div>
                    ) : (
                        <UnifiedTable
                            rows={[overviewData || {}]}
                            windowSize={1}
                            metrics={isBank ? BANK_KEY_METRICS : NORMAL_KEY_METRICS}
                            valueFormatter={(key) => getMetricValue({ key, fields: (isBank ? BANK_KEY_METRICS : NORMAL_KEY_METRICS).find(m => m.key === key)?.fields || [], isPct: (isBank ? BANK_KEY_METRICS : NORMAL_KEY_METRICS).find(m => m.key === key)?.isPct })}
                        />
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
                        <UnifiedTable
                            rows={reportData.ratio}
                            windowSize={windowSize}
                            metrics={[
                                { key: 'roe', label: 'ROE', isPct: true },
                                { key: 'roa', label: 'ROA', isPct: true },
                                { key: 'price_to_earnings', label: 'P/E' },
                                { key: 'price_to_book', label: 'P/B' },
                                { key: 'net_profit_margin', label: 'Biên LN ròng', isPct: true },
                                { key: 'gross_margin', label: 'Biên LN gộp', isPct: true },
                                { key: 'ebit_margin', label: 'Biên EBIT', isPct: true },
                                { key: 'debt_to_equity', label: 'D/E' },
                                { key: 'current_ratio', label: 'Current Ratio' },
                                { key: 'quick_ratio', label: 'Quick Ratio' },
                                { key: 'asset_turnover', label: 'Vòng quay TS' },
                                { key: 'inventory_turnover', label: 'Vòng quay HTK' },
                            ]}
                        />
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

    // For cashflow and note, use predefined key metrics
    const keyMetrics = tabType === 'cashflow' ? CASHFLOW_KEY_METRICS :
                       tabType === 'note' ? NOTE_KEY_METRICS : null;

    if (keyMetrics) {
        return (
            <UnifiedTable
                rows={rows}
                windowSize={windowSize}
                metrics={keyMetrics}
                fieldLabels={fieldLabels}
            />
        );
    }

    // For income/balance, use dynamic row labels
    return (
        <UnifiedTable
            rows={rows}
            windowSize={windowSize}
            metrics={[]}
            fieldLabels={fieldLabels}
            useRowLabels={true}
        />
    );
}
