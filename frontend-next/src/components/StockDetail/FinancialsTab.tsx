'use client';

import React, { useEffect, useRef, useState } from 'react';
import { formatNumber } from '@/lib/api';
import type { HistoricalChartData, HistoricalChartRecord, StockApiData } from '@/lib/types';
import { LineChart, type CustomTooltipProps as TremorCustomTooltipProps } from '@tremor/react';
import { cx } from '@/lib/utils';


interface FinancialsTabProps {
    symbol: string;
    period?: 'quarter' | 'year';
    setPeriod?: (p: 'quarter' | 'year') => void;
    initialChartData?: HistoricalChartData | null;
    initialOverviewData?: StockApiData | null;
    isLoading?: boolean;
}

type ReportType = 'income' | 'balance' | 'cashflow' | 'note' | 'ratio';
type StatementWindow = '4' | '8' | '12' | 'all';
type MetricMeta = { label: string; parent?: string | null; level?: number | null };
const PLUS_ICON_URL = 'https://trading.vietcap.com.vn/vietcap-iq/assets/images/plus-grid2e52f954fdf3abbd8683.svg';
const MINUS_ICON_URL = 'https://trading.vietcap.com.vn/vietcap-iq/assets/images/minus-grid0cc75a8b4abe6c3b23c9.svg';

// ── helpers ───────────────────────────────────────────────────────────────────

function parseChartResponse(res: any): HistoricalChartData | null {
    if (!res) return null;
    // Handle full API response envelope {success, data}
    if (res.success !== undefined && !res.success) return null;
    if (Array.isArray(res.data)) {
        return { symbol: res.symbol ?? '', period: res.period ?? 'quarter', count: res.count ?? res.data.length, records: res.data };
    }
    // Legacy parallel-arrays: may be res.data dict or res itself
    const d = res.data ?? res;
    if (!d?.years) return null;
    const records: HistoricalChartRecord[] = (d.years as string[]).map((period: string, i: number) => ({
        period,
        roe: d.roe_data?.[i] ?? null, roa: d.roa_data?.[i] ?? null,
        pe: d.pe_ratio_data?.[i] ?? null, pb: d.pb_ratio_data?.[i] ?? null,
        currentRatio: d.current_ratio_data?.[i] ?? null, quickRatio: d.quick_ratio_data?.[i] ?? null,
        cashRatio: d.cash_ratio_data?.[i] ?? null, nim: d.nim_data?.[i] ?? null,
        netMargin: d.net_profit_margin_data?.[i] ?? null,
    }));
    return { symbol: '', period: 'quarter', count: records.length, records };
}

function latest(records: HistoricalChartRecord[], key: keyof HistoricalChartRecord): number | null {
    for (let i = records.length - 1; i >= 0; i--) {
        const v = records[i][key];
        if (v !== null && v !== undefined && !Number.isNaN(Number(v))) return Number(v);
    }
    return null;
}

// ── original UI components ────────────────────────────────────────────────────

const MetricRow = ({ label, value, unit = '' }: { label: string; value: string | number | null | undefined; unit?: string }) => (
    <div className="flex items-center justify-between border-b border-tremor-border px-4 py-2.5 text-tremor-default dark:border-dark-tremor-border">
        <span className="text-tremor-content-subtle dark:text-dark-tremor-content-subtle">{label}</span>
        <span className="font-semibold text-tremor-brand dark:text-dark-tremor-brand">
            {value !== null && value !== undefined ? `${formatNumber(Number(value))}${unit}` : '-'}
        </span>
    </div>
);

const MetricCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="rounded-tremor-small border border-tremor-border bg-white shadow-sm dark:border-dark-tremor-border dark:bg-dark-tremor-background">
        <div className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
            {title}
        </div>
        <div className="pb-2">{children}</div>
    </div>
);

const ChartCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="flex flex-col overflow-hidden rounded-tremor-small border border-tremor-border bg-white shadow-sm dark:border-dark-tremor-border dark:bg-dark-tremor-background" style={{ height: '380px' }}>
        <div className="flex items-center justify-center border-b border-tremor-border px-4 py-3 text-tremor-default font-semibold text-tremor-content-strong dark:border-dark-tremor-border dark:text-dark-tremor-content-strong">
            {title}
        </div>
        <div className="flex-1 px-4 pb-2 pt-3" style={{ position: 'relative', minHeight: '240px' }}>
            {children}
        </div>
    </div>
);

function renderPeriod(row: Record<string, any>) {
    const year = row?.year ?? row?.year_report ?? row?.yearReport;
    const quarter = row?.quarter ?? row?.quarter_report ?? row?.quarterReport;
    if (quarter && Number(quarter) > 0) return `Q${quarter} ${year ?? ''}`.trim();
    if (year) return String(year);
    return '-';
}

function periodSortKey(row: Record<string, any>): number {
    const year = Number(row?.year ?? row?.year_report ?? row?.yearReport ?? 0);
    const quarter = Number(row?.quarter ?? row?.quarter_report ?? row?.quarterReport ?? 0);
    return year * 10 + quarter;
}

function pickColumns(rows: Record<string, any>[]): string[] {
    if (!rows.length) return [];
    const excluded = new Set([
        'symbol',
        'ticker',
        'organ_code',
        'organCode',
        'source',
        'period',
        'data_json',
        'created_at',
        'updated_at',
        'create_date',
        'update_date',
        'public_date',
        'id',
        'year',
        'quarter',
        'year_report',
        'quarter_report',
        'yearReport',
        'quarterReport',
    ]);
    const keys = new Set<string>();
    for (const row of rows) {
        Object.keys(row || {}).forEach((k) => {
            if (!excluded.has(k)) keys.add(k);
        });
    }
    return Array.from(keys).sort();
}

function formatCell(value: unknown): string {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'number') {
        if (Math.abs(value) < 1) return value.toFixed(4);
        return formatNumber(value);
    }
    return String(value);
}

function isZeroLike(value: unknown): boolean {
    if (value === null || value === undefined || value === '') return true;
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    return Math.abs(n) < 1e-12;
}

function formatMetricLabel(key: string): string {
    if (!key) return '';
    if (/^[a-z]{3}\d+$/i.test(key)) return key.toUpperCase(); // isa1/bsa1/cfa1/noc1
    const text = key.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function isImportantMetric(metric: string, label: string, tab: ReportType): boolean {
    const m = metric.toLowerCase();
    const l = label.toLowerCase();
    if (tab === 'income') {
        if (['isa1', 'isa3', 'isa5', 'isa16', 'isa20', 'isa22'].includes(m)) return true;
    }
    if (tab === 'cashflow') {
        if (['cfa1', 'cfa20', 'cfa30'].includes(m)) return true;
    }
    if (tab === 'balance') {
        if ([
            'tài sản ngắn hạn', 'tiền và tương đương tiền', 'đầu tư ngắn hạn', 'các khoản phải thu',
            'hàng tồn kho', 'tài sản lưu động khác', 'tài sản dài hạn', 'phải thu dài hạn',
            'tài sản cố định', 'gtcl tscđ hữu hình', 'gtcl tài sản thuê tài chính', 'gtcl tài sản cố định vô hình',
            'giá trị ròng tài sản đầu tư', 'tài sản dở dang dài hạn', 'đầu tư dài hạn', 'tài sản dài hạn khác',
            'tổng cộng tài sản', 'nợ phải trả', 'nợ ngắn hạn', 'nợ dài hạn', 'vốn chủ sở hữu',
            'vốn và các quỹ', 'vốn ngân sách nhà nước và quỹ khác', 'lợi ích của cổ đông thiểu số', 'tổng cộng nguồn vốn',
        ].includes(l)) return true;
    }
    return /doanh thu|lợi nhuận|revenue|profit|cash flow|dòng tiền/.test(l);
}

function metricCodeSortKey(metric: string): [number, number, string] {
    const m = metric.toLowerCase().match(/^([a-z]+)(\d+)$/);
    if (!m) return [99, Number.MAX_SAFE_INTEGER, metric];
    const prefix = m[1];
    const num = Number(m[2]);
    const prefixOrder: Record<string, number> = {
        isa: 1, isb: 2,
        bsa: 3, bsb: 4,
        cfa: 5, cfb: 6,
        noa: 7, nob: 8, noc: 9,
    };
    return [prefixOrder[prefix] ?? 98, num, metric];
}

function getSortedMetricKeys(tab: ReportType, metricKeys: string[]): string[] {
    if (tab === 'balance') {
        return [...metricKeys].sort((a, b) => {
            const ka = metricCodeSortKey(a);
            const kb = metricCodeSortKey(b);
            if (ka[0] !== kb[0]) return ka[0] - kb[0];
            if (ka[1] !== kb[1]) return ka[1] - kb[1];
            return ka[2].localeCompare(kb[2]);
        });
    }
    return [...metricKeys].sort((a, b) => {
        const ka = metricCodeSortKey(a);
        const kb = metricCodeSortKey(b);
        if (ka[0] !== kb[0]) return ka[0] - kb[0];
        if (ka[1] !== kb[1]) return ka[1] - kb[1];
        return ka[2].localeCompare(kb[2]);
    });
}

// ── main ──────────────────────────────────────────────────────────────────────

export default function FinancialsTab({
    symbol,
    period,
    initialChartData,
    initialOverviewData,
    isLoading: isParentLoading = false,
}: FinancialsTabProps) {
    const effectivePeriod: 'quarter' | 'year' = period ?? 'year';
    const [chartData, setChartData] = useState<HistoricalChartData | null>(() => parseChartResponse(initialChartData) || null);
    const [overviewData, setOverviewData] = useState<any>(initialOverviewData || null);
    const [loading, setLoading] = useState<boolean>(!initialChartData && !isParentLoading);
    const [bankingHistory, setBankingHistory] = useState<any[]>([]);
    const [activeSubTab, setActiveSubTab] = useState<'ratio' | 'income' | 'balance' | 'cashflow' | 'note'>('ratio');
    const [reportLoading, setReportLoading] = useState(false);
    const [reportData, setReportData] = useState<Record<ReportType, Record<string, any>[]>>({
        income: [],
        balance: [],
        cashflow: [],
        note: [],
        ratio: [],
    });
    const [metricMaps, setMetricMaps] = useState<Record<'income' | 'balance' | 'cashflow' | 'note', Record<string, string>>>({
        income: {},
        balance: {},
        cashflow: {},
        note: {},
    });
    const [metricMetaMaps, setMetricMetaMaps] = useState<Record<'income' | 'balance' | 'cashflow' | 'note', Record<string, MetricMeta>>>({
        income: {},
        balance: {},
        cashflow: {},
        note: {},
    });
    const [statementWindow, setStatementWindow] = useState<StatementWindow>('4');
    const [mobilePeriodIndex, setMobilePeriodIndex] = useState(0);
    const [collapsedRows, setCollapsedRows] = useState<Set<string>>(new Set());
    const isInitialMount = useRef(true);

    const BANK_SYMBOLS = new Set(['VCB','BID','CTG','TCB','MBB','ACB','VPB','HDB','SHB','STB','TPB','LPB','MSB','OCB','EIB','ABB','NAB','PGB','VAB','VIB','SSB','BAB','KLB','BVB','KBS','SGB','NVB']);
    const nimValue = overviewData?.nim ?? overviewData?.net_interest_margin ?? null;
    const isBank = nimValue !== null && nimValue !== undefined ? Number(nimValue) > 0 : BANK_SYMBOLS.has(symbol);

    useEffect(() => {
        if (initialChartData && effectivePeriod === 'quarter') {
            const parsed = parseChartResponse(initialChartData);
            if (parsed) queueMicrotask(() => setChartData(parsed));
        }
    }, [initialChartData, effectivePeriod]);

    useEffect(() => {
        if (initialOverviewData) queueMicrotask(() => setOverviewData(initialOverviewData));
    }, [initialOverviewData]);

    useEffect(() => {
        const controller = new AbortController();
        const { signal } = controller;

        if (isInitialMount.current) {
            isInitialMount.current = false;
            if (effectivePeriod === 'quarter' && initialChartData) {
                const parsed = parseChartResponse(initialChartData);
                if (parsed) { queueMicrotask(() => { setLoading(false); setChartData(parsed); }); return; }
            }
        }
        if (effectivePeriod === 'quarter' && isParentLoading) {
            queueMicrotask(() => setLoading(true));
            return;
        }

        queueMicrotask(() => setLoading(true));
        const stockPromise = initialOverviewData
            ? Promise.resolve({ success: true, data: initialOverviewData })
            : fetch(`/api/stock/${symbol}?period=${effectivePeriod}`, { signal }).then(r => r.json());

        Promise.allSettled([
            fetch(`/api/historical-chart-data/${symbol}?period=${effectivePeriod}`, { signal }).then(r => r.json()),
            stockPromise,
        ])
            .then(([chartResult, stockResult]) => {
                if (signal.aborted) return;
                const raw = chartResult.status === 'fulfilled' ? chartResult.value : null;
                const parsed = parseChartResponse(raw);
                if (parsed) setChartData(parsed);
                const stockRes = stockResult.status === 'fulfilled' ? stockResult.value : null;
                if (stockRes?.success || stockRes?.data) setOverviewData(stockRes.data || stockRes);
            })
            .catch(err => { if (err.name !== 'AbortError') console.error(err); })
            .finally(() => { if (!signal.aborted) setLoading(false); });

        return () => controller.abort();
    }, [symbol, effectivePeriod, isParentLoading, initialChartData, initialOverviewData]);

    useEffect(() => {
        if (!isBank) return;
        const controller = new AbortController();
        fetch(`/api/banking-kpi-history/${symbol}?period=${effectivePeriod}`, { signal: controller.signal })
            .then(r => r.json())
            .then(res => { if (res?.success && Array.isArray(res.data)) setBankingHistory(res.data); })
            .catch(() => {});
        return () => controller.abort();
    }, [symbol, isBank, effectivePeriod]);

    useEffect(() => {
        const controller = new AbortController();
        queueMicrotask(() => setReportLoading(true));
        Promise.allSettled([
            fetch(`/api/financial-report/${symbol}?type=income&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report/${symbol}?type=balance&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report/${symbol}?type=cashflow&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report/${symbol}?type=note&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report/${symbol}?type=ratio&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
        ])
            .then(([income, balance, cashflow, note, ratio]) => {
                if (controller.signal.aborted) return;
                const unwrap = (res: PromiseSettledResult<any>) => {
                    if (res.status !== 'fulfilled') return [];
                    const payload = res.value;
                    if (Array.isArray(payload)) return payload;
                    if (Array.isArray(payload?.data)) return payload.data;
                    return [];
                };
                setReportData({
                    income: unwrap(income),
                    balance: unwrap(balance),
                    cashflow: unwrap(cashflow),
                    note: unwrap(note),
                    ratio: unwrap(ratio),
                });
                setCollapsedRows(new Set());
            })
            .finally(() => {
                if (!controller.signal.aborted) setReportLoading(false);
            });
        return () => controller.abort();
    }, [symbol, effectivePeriod]);

    useEffect(() => {
        const controller = new AbortController();
        Promise.allSettled([
            fetch(`/api/financial-report-metrics/${symbol}?type=income`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report-metrics/${symbol}?type=balance`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report-metrics/${symbol}?type=cashflow`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report-metrics/${symbol}?type=note`, { signal: controller.signal }).then(r => r.json()),
        ]).then(([income, balance, cashflow, note]) => {
            if (controller.signal.aborted) return;
            const unwrapLabels = (res: PromiseSettledResult<any>) => {
                if (res.status !== 'fulfilled') return {};
                return (res.value?.field_map ?? {}) as Record<string, string>;
            };
            const unwrapMeta = (res: PromiseSettledResult<any>) => {
                if (res.status !== 'fulfilled') return {};
                const data = Array.isArray(res.value?.data) ? res.value.data : [];
                const out: Record<string, MetricMeta> = {};
                for (const row of data) {
                    const field = String(row?.field || '').toLowerCase().trim();
                    if (!field) continue;
                    out[field] = {
                        label: String(row?.label || '').trim() || field.toUpperCase(),
                        parent: row?.parent ? String(row.parent).toLowerCase().trim() : null,
                        level: row?.level ?? null,
                    };
                }
                return out;
            };
            setMetricMaps({
                income: unwrapLabels(income),
                balance: unwrapLabels(balance),
                cashflow: unwrapLabels(cashflow),
                note: unwrapLabels(note),
            });
            setMetricMetaMaps({
                income: unwrapMeta(income),
                balance: unwrapMeta(balance),
                cashflow: unwrapMeta(cashflow),
                note: unwrapMeta(note),
            });
        });
        return () => controller.abort();
    }, [symbol]);

    // ── data helpers ──────────────────────────────────────────────────────────

    // Fallback: use overviewData.history (from /api/stock SQLite) when VCI chart fetch failed
    const records: HistoricalChartRecord[] = chartData?.records ?? (() => {
        const hist = (overviewData as any)?.history;
        if (!Array.isArray(hist) || hist.length === 0) return [];
        return hist.map((r: any) => ({
            period:       r.period,
            roe:          r.roe   ?? null,
            roa:          r.roa   ?? null,
            pe:           r.pe    ?? null,
            pb:           r.pb    ?? null,
            nim:          r.nim   ?? null,
            netMargin:    r.netMargin ?? r.net_margin ?? null,
            currentRatio: r.currentRatio ?? null,
            quickRatio:   r.quickRatio  ?? null,
            cashRatio:    null,
        }));
    })();
    const shouldBlockWithSpinner = loading && !chartData && !overviewData;

    const buildSeries = (mapPoint: (r: HistoricalChartRecord) => Record<string, string | number | null>) =>
        records.map(mapPoint);

    const pickOverview = (...keys: string[]): number | null => {
        if (!overviewData) return null;
        for (const key of keys) {
            const value = overviewData?.[key];
            if (value === null || value === undefined || value === '') continue;
            const numeric = Number(value);
            if (!Number.isNaN(numeric)) return numeric;
        }
        return null;
    };

    const computedEvEbitda = () => pickOverview('ev_to_ebitda', 'ev_ebitda', 'evEbitda', 'enterprise_to_ebitda');
    const getEpsForPeriod = () =>
        effectivePeriod === 'quarter'
            ? (pickOverview('eps', 'earnings_per_share', 'basic_eps', 'eps_quarter') ?? pickOverview('eps_ttm'))
            : pickOverview('eps_ttm', 'eps', 'earnings_per_share', 'basic_eps');

    const hasNetMarginData = records.some(r => r.netMargin !== null && r.netMargin !== 0);

    // ── custom tooltip ────────────────────────────────────────────────────────

    const CustomTooltip = ({ payload, active, label }: TremorCustomTooltipProps) => {
        if (!active || !payload || payload.length === 0) return null;
        return (
            <>
                <div className="w-56 rounded-md border border-gray-500/10 bg-blue-500 px-4 py-1.5 text-sm shadow-md dark:border-gray-400/20 dark:bg-gray-900 z-[100]">
                    <p className="flex items-center justify-between">
                        <span className="text-gray-50 dark:text-gray-50">Kỳ</span>
                        <span className="font-medium text-gray-50 dark:text-gray-50">{label ?? ''}</span>
                    </p>
                </div>
                <div className="mt-1 w-56 space-y-1 rounded-md border border-gray-500/10 bg-white px-4 py-2 text-sm shadow-md dark:border-gray-400/20 dark:bg-gray-900 z-[100]">
                    {payload.map((item, index) => {
                        const color = item.color || item.payload?.fill || item.stroke;
                        const isHex = color?.startsWith('#') || color?.startsWith('rgb');
                        return (
                            <div key={index} className="flex items-center space-x-2.5">
                                <span
                                    className={cx(!isHex ? `bg-${color}-500` : '', 'size-2.5 shrink-0 rounded-sm')}
                                    style={isHex ? { backgroundColor: color } : {}}
                                    aria-hidden={true}
                                />
                                <div className="flex w-full justify-between items-center space-x-2">
                                    <span className="text-gray-700 dark:text-gray-300 truncate">{item.name}</span>
                                    <span className="font-medium text-gray-900 dark:text-gray-50 whitespace-nowrap">
                                        {typeof item.value === 'number'
                                            ? (['ROE', 'ROA', 'NIM', 'Net Margin (%)'].includes(String(item.name)) || String(item.name).includes('%') || item.unit === '%')
                                                ? `${item.value}%`
                                                : formatNumber(item.value)
                                            : item.value}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </>
        );
    };

    // ── render ────────────────────────────────────────────────────────────────

    return (
        <div className="w-full text-tremor-content-strong dark:text-dark-tremor-content-strong" style={{ boxSizing: 'border-box' }}>
            {shouldBlockWithSpinner ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: '#9ca3af' }}>
                    <div className="spinner" style={{ margin: '0 auto', marginBottom: '12px' }} />
                    <span style={{ fontSize: '12px' }}>Loading data...</span>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-tremor-border bg-white p-2 shadow-sm dark:border-dark-tremor-border dark:bg-gray-950">
                        <div className="hidden items-center gap-2 md:flex">
                            {[
                                { id: 'ratio', label: 'Ratios' },
                                { id: 'income', label: 'Income Statement' },
                                { id: 'balance', label: 'Balance Sheet' },
                                { id: 'cashflow', label: 'Cash Flow' },
                                { id: 'note', label: 'Note' },
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => {
                                        setActiveSubTab(tab.id as 'ratio' | 'income' | 'balance' | 'cashflow' | 'note');
                                        setStatementWindow('4');
                                        setMobilePeriodIndex(0);
                                    }}
                                    className={cx(
                                        'rounded-tremor-small border border-tremor-border px-3 py-1.5 text-sm font-medium transition-colors dark:border-dark-tremor-border',
                                        activeSubTab === tab.id
                                            ? 'bg-tremor-brand-muted text-tremor-brand dark:bg-dark-tremor-brand-muted dark:text-dark-tremor-brand'
                                            : 'bg-white text-tremor-content-strong hover:bg-tremor-background-muted dark:bg-dark-tremor-background dark:text-dark-tremor-content-strong hover:dark:bg-gray-900'
                                    )}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        <div className="flex flex-1 flex-wrap items-center gap-2 md:flex-none md:justify-end">
                            <select
                                value={activeSubTab}
                                onChange={(e) => {
                                    setActiveSubTab(e.target.value as 'ratio' | 'income' | 'balance' | 'cashflow' | 'note');
                                    setStatementWindow('4');
                                    setMobilePeriodIndex(0);
                                }}
                                className="w-full rounded-tremor-small border border-tremor-border bg-white px-2.5 py-2 text-sm text-tremor-content-strong dark:border-dark-tremor-border dark:bg-gray-950 dark:text-dark-tremor-content-strong md:hidden"
                            >
                                <option value="ratio">Ratios</option>
                                <option value="income">Income Statement</option>
                                <option value="balance">Balance Sheet</option>
                                <option value="cashflow">Cash Flow</option>
                                <option value="note">Note</option>
                            </select>

                            <select
                                value={statementWindow}
                                onChange={(e) => {
                                    setStatementWindow(e.target.value as StatementWindow);
                                    setMobilePeriodIndex(0);
                                }}
                                disabled={activeSubTab === 'ratio'}
                                className="w-full rounded-tremor-small border border-tremor-border bg-white px-2.5 py-2 text-sm text-tremor-content-strong disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-tremor-border dark:bg-gray-950 dark:text-dark-tremor-content-strong md:w-auto"
                            >
                                <option value="4">4 kỳ gần nhất</option>
                                <option value="8">8 kỳ</option>
                                <option value="12">12 kỳ</option>
                                <option value="all">Tất cả</option>
                            </select>
                        </div>
                    </div>

                    {activeSubTab !== 'ratio' && (
                        <div className="rounded-xl border border-tremor-border bg-white p-0 shadow-sm dark:border-dark-tremor-border dark:bg-gray-950">
                            {reportLoading ? (
                                <div className="p-4 text-sm text-tremor-content dark:text-dark-tremor-content">Loading report...</div>
                            ) : (
                                (() => {
                                    const rawRows = reportData[activeSubTab] || [];
                                    const sortedPeriodRows = [...rawRows].sort((a, b) => periodSortKey(b) - periodSortKey(a));
                                    const periodRows = statementWindow === 'all'
                                        ? sortedPeriodRows
                                        : sortedPeriodRows.slice(0, Number(statementWindow));
                                    const metricKeys = pickColumns(periodRows).filter((metric) =>
                                        !periodRows.every((row) => isZeroLike(row[metric]))
                                    );
                                    const currentMap = activeSubTab === 'income'
                                        ? metricMaps.income
                                        : activeSubTab === 'balance'
                                            ? metricMaps.balance
                                            : activeSubTab === 'cashflow'
                                            ? metricMaps.cashflow
                                            : metricMaps.note;
                                    const currentMeta = activeSubTab === 'income'
                                        ? metricMetaMaps.income
                                        : activeSubTab === 'balance'
                                            ? metricMetaMaps.balance
                                            : activeSubTab === 'cashflow'
                                                ? metricMetaMaps.cashflow
                                                : metricMetaMaps.note;
                                    if (!periodRows.length || !metricKeys.length) {
                                        return <div className="p-4 text-sm text-tremor-content dark:text-dark-tremor-content">No data.</div>;
                                    }
                                    const orderedMetricKeys = getSortedMetricKeys(activeSubTab, metricKeys);
                                    const childrenMap = new Map<string, string[]>();
                                    for (const key of orderedMetricKeys) {
                                        const parent = currentMeta[key.toLowerCase()]?.parent?.toLowerCase();
                                        if (!parent) continue;
                                        if (!childrenMap.has(parent)) childrenMap.set(parent, []);
                                        childrenMap.get(parent)!.push(key);
                                    }
                                    const hasCollapsedAncestor = (metric: string): boolean => {
                                        let cursor = currentMeta[metric.toLowerCase()]?.parent?.toLowerCase();
                                        while (cursor) {
                                            if (collapsedRows.has(cursor)) return true;
                                            cursor = currentMeta[cursor]?.parent?.toLowerCase();
                                        }
                                        return false;
                                    };
                                    const displayMetricKeys = orderedMetricKeys.filter((metric) => !hasCollapsedAncestor(metric));
                                    const parentSumStatus = (metric: string, row: Record<string, any>): boolean | null => {
                                        const children = childrenMap.get(metric.toLowerCase()) || [];
                                        if (!children.length) return null;
                                        const parentVal = Number(row[metric]);
                                        if (!Number.isFinite(parentVal)) return null;
                                        const childVals = children.map((k) => Number(row[k]));
                                        if (childVals.some((v) => !Number.isFinite(v))) return null;
                                        const sum = childVals.reduce((a, b) => a + b, 0);
                                        const tolerance = Math.max(1, Math.abs(parentVal), Math.abs(sum)) * 1e-6;
                                        return Math.abs(parentVal - sum) <= tolerance;
                                    };
                                    const safeMobileIndex = Math.min(mobilePeriodIndex, Math.max(0, periodRows.length - 1));
                                    const mobileRow = periodRows[safeMobileIndex];
                                    return (
                                        <>
                                        <div className="p-3 md:hidden">
                                            <select
                                                value={String(safeMobileIndex)}
                                                onChange={(e) => setMobilePeriodIndex(Number(e.target.value))}
                                                className="w-full rounded-tremor-small border border-tremor-border bg-white px-2.5 py-2 text-sm text-tremor-content-strong dark:border-dark-tremor-border dark:bg-gray-950 dark:text-dark-tremor-content-strong"
                                            >
                                                {periodRows.map((row, idx) => (
                                                    <option key={`mobile-period-${idx}`} value={String(idx)}>
                                                        {renderPeriod(row)}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="hidden md:block w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                                            <table className="min-w-full w-max border-collapse text-sm">
                                                <thead className="bg-gray-50/50 dark:bg-gray-900/50">
                                                    <tr>
                                                        <th className="sticky left-0 z-10 min-w-[260px] border-b border-tremor-border bg-gray-50/50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-tremor-content dark:border-dark-tremor-border dark:bg-gray-900/50 dark:text-dark-tremor-content">
                                                            {activeSubTab === 'income' ? 'Income Statement' : activeSubTab === 'balance' ? 'Balance Sheet' : activeSubTab === 'cashflow' ? 'Cash Flow' : 'Note'}
                                                        </th>
                                                        {periodRows.map((row, idx) => (
                                                            <th key={`${renderPeriod(row)}-${idx}`} className="whitespace-nowrap border-b border-tremor-border px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-tremor-content dark:border-dark-tremor-border dark:text-dark-tremor-content">
                                                                {renderPeriod(row)}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                                    {displayMetricKeys.map((metric) => (
                                                        (() => {
                                                            const label = currentMap[metric.toLowerCase()] || formatMetricLabel(metric);
                                                            const important = isImportantMetric(metric, label, activeSubTab);
                                                            const level = Number(currentMeta[metric.toLowerCase()]?.level ?? 0);
                                                            const hasChildren = (childrenMap.get(metric.toLowerCase()) || []).length > 0;
                                                            const isCollapsed = collapsedRows.has(metric.toLowerCase());
                                                            const relation = parentSumStatus(metric, periodRows[0] || {});
                                                            return (
                                                        <tr key={metric} className={cx("hover:bg-gray-50/50 dark:hover:bg-gray-900/50 transition-colors", important && "bg-amber-50/30 dark:bg-amber-900/10")}>
                                                            <td className={cx("sticky left-0 z-[1] min-w-[260px] bg-white px-4 py-3 text-sm font-medium text-tremor-content-strong dark:bg-gray-950 dark:text-dark-tremor-content-strong", important && "text-amber-700 dark:text-amber-300 font-semibold")}>
                                                                <div className="flex items-center gap-1.5" style={{ paddingLeft: `${Math.max(0, level - 1) * 12}px` }}>
                                                                    {hasChildren ? (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                const key = metric.toLowerCase();
                                                                                setCollapsedRows((prev) => {
                                                                                    const next = new Set(prev);
                                                                                    if (next.has(key)) next.delete(key);
                                                                                    else next.add(key);
                                                                                    return next;
                                                                                });
                                                                            }}
                                                                            className="inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900"
                                                                            aria-label={isCollapsed ? 'Expand row' : 'Collapse row'}
                                                                        >
                                                                            <img src={isCollapsed ? PLUS_ICON_URL : MINUS_ICON_URL} alt="" className="h-2.5 w-2.5" />
                                                                        </button>
                                                                    ) : (
                                                                        <span className="inline-block w-4" />
                                                                    )}
                                                                    <span>{label}</span>
                                                                    {relation !== null && (
                                                                        <span className={cx("ml-1 inline-block h-1.5 w-1.5 rounded-full", relation ? "bg-emerald-500" : "bg-amber-500")} />
                                                                    )}
                                                                </div>
                                                            </td>
                                                            {periodRows.map((row, idx) => (
                                                                <td key={`${metric}-${idx}`} className="whitespace-nowrap px-4 py-3 text-right text-sm text-tremor-content dark:text-dark-tremor-content">
                                                                    {formatCell(row[metric])}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                            );
                                                        })()
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="md:hidden w-full overflow-hidden px-0">
                                            <table className="w-full border-collapse text-sm">
                                                <thead className="bg-gray-50/50 dark:bg-gray-900/50">
                                                    <tr>
                                                        <th className="w-[58%] border-b border-tremor-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-tremor-content dark:border-dark-tremor-border dark:text-dark-tremor-content">Metric</th>
                                                        <th className="border-b border-tremor-border px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-tremor-content dark:border-dark-tremor-border dark:text-dark-tremor-content">{renderPeriod(mobileRow)}</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                                    {displayMetricKeys.map((metric) => {
                                                        const label = currentMap[metric.toLowerCase()] || formatMetricLabel(metric);
                                                        const important = isImportantMetric(metric, label, activeSubTab);
                                                        const level = Number(currentMeta[metric.toLowerCase()]?.level ?? 0);
                                                        const hasChildren = (childrenMap.get(metric.toLowerCase()) || []).length > 0;
                                                        const isCollapsed = collapsedRows.has(metric.toLowerCase());
                                                        const relation = parentSumStatus(metric, mobileRow || {});
                                                        return (
                                                            <tr key={`mobile-${metric}`} className={cx(important && "bg-amber-50/30 dark:bg-amber-900/10")}>
                                                                <td className={cx("px-3 py-2 text-xs text-tremor-content-strong dark:text-dark-tremor-content-strong align-top break-words", important && "text-amber-700 dark:text-amber-300 font-semibold")}>
                                                                    <div className="flex items-center gap-1.5" style={{ paddingLeft: `${Math.max(0, level - 1) * 10}px` }}>
                                                                        {hasChildren ? (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => {
                                                                                    const key = metric.toLowerCase();
                                                                                    setCollapsedRows((prev) => {
                                                                                        const next = new Set(prev);
                                                                                        if (next.has(key)) next.delete(key);
                                                                                        else next.add(key);
                                                                                        return next;
                                                                                    });
                                                                                }}
                                                                                className="inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900"
                                                                                aria-label={isCollapsed ? 'Expand row' : 'Collapse row'}
                                                                            >
                                                                                <img src={isCollapsed ? PLUS_ICON_URL : MINUS_ICON_URL} alt="" className="h-2.5 w-2.5" />
                                                                            </button>
                                                                        ) : (
                                                                            <span className="inline-block w-4" />
                                                                        )}
                                                                        <span>{label}</span>
                                                                        {relation !== null && (
                                                                            <span className={cx("ml-1 inline-block h-1.5 w-1.5 rounded-full", relation ? "bg-emerald-500" : "bg-amber-500")} />
                                                                        )}
                                                                    </div>
                                                                </td>
                                                                <td className="px-3 py-2 text-right text-xs text-tremor-content dark:text-dark-tremor-content align-top break-all">{formatCell(mobileRow?.[metric])}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                        </>
                                    );
                                })()
                            )}
                        </div>
                    )}

                    {/* Metric cards */}
                    {activeSubTab === 'ratio' && (
                    <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <MetricCard title="Valuation">
                            <MetricRow label={effectivePeriod === 'quarter' ? 'EPS (Quarter)' : 'EPS (TTM)'} value={getEpsForPeriod()} />
                            <MetricRow label="P/E" value={records.length ? latest(records, 'pe') : pickOverview('pe', 'pe_ratio', 'PE')} />
                            <MetricRow label="P/B" value={records.length ? latest(records, 'pb') : pickOverview('pb', 'pb_ratio', 'PB')} />
                            <MetricRow label="P/S" value={pickOverview('ps', 'p_s', 'price_to_sales')} />
                            <MetricRow label="P/CF" value={pickOverview('p_cash_flow', 'pcf_ratio', 'price_to_cash_flow')} />
                            <MetricRow label="EV/EBITDA" value={computedEvEbitda()} />
                        </MetricCard>

                        <MetricCard title="Profitability">
                            <MetricRow label="ROE" value={pickOverview('roe', 'ROE')} unit=" %" />
                            <MetricRow label="ROA" value={pickOverview('roa', 'ROA')} unit=" %" />
                            <MetricRow label="ROIC" value={pickOverview('roic')} unit=" %" />
                            <MetricRow label="Gross Margin" value={pickOverview('gross_margin', 'grossProfitMargin')} unit=" %" />
                            <MetricRow label="Net Margin" value={pickOverview('net_profit_margin', 'net_margin', 'netProfitMargin')} unit=" %" />
                        </MetricCard>

                        {!isBank && (
                            <MetricCard title="Financial Health">
                                <MetricRow label="Current Ratio" value={pickOverview('current_ratio', 'currentRatio')} />
                                <MetricRow label="Quick Ratio" value={pickOverview('quick_ratio', 'quickRatio')} />
                                <MetricRow label="Cash Ratio" value={pickOverview('cash_ratio', 'cashRatio')} />
                                <MetricRow label="D/E Ratio" value={pickOverview('debt_to_equity', 'debtToEquity', 'de')} />
                                <MetricRow label="Asset Turnover" value={pickOverview('asset_turnover')} />
                                <MetricRow label="Dividend Yield" value={pickOverview('dividend_yield')} unit=" %" />
                            </MetricCard>
                        )}

                        {isBank && (
                            <MetricCard title="Banking KPIs">
                                <MetricRow label="NIM" value={overviewData?.nim ?? overviewData?.net_interest_margin ?? null} unit=" %" />
                                <MetricRow label="CASA" value={overviewData?.casa ?? overviewData?.casa_ratio ?? null} unit=" %" />
                                <MetricRow label="CAR" value={overviewData?.car ?? null} unit=" %" />
                                <MetricRow label="NPL" value={overviewData?.npl ?? overviewData?.npl_ratio ?? null} unit=" %" />
                                <MetricRow label="LDR" value={overviewData?.ldr ?? null} unit=" %" />
                                <MetricRow label="CIR" value={overviewData?.cir ?? null} unit=" %" />
                                <MetricRow label="Cost of Funds" value={overviewData?.cof ?? null} unit=" %" />
                                <MetricRow label="Fee Income" value={overviewData?.fee_income_ratio ?? null} unit=" %" />
                                <MetricRow label="LLR Coverage" value={overviewData?.llr_coverage ?? null} unit=" x" />
                                <MetricRow label="Yield on Assets" value={overviewData?.yield_on_assets ?? null} unit=" %" />
                            </MetricCard>
                        )}
                    </div>

                    {/* Charts */}
                    {records.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                            <ChartCard title="ROE & ROA (%)">
                                <LineChart
                                    className="h-full w-full"
                                    style={{ height: '100%', width: '100%' }}
                                    data={buildSeries(r => ({ year: r.period, ROE: r.roe ?? 0, ROA: r.roa ?? 0 }))}
                                    index="year"
                                    categories={['ROE', 'ROA']}
                                    colors={['blue', 'emerald']}
                                    valueFormatter={formatNumber}
                                    yAxisWidth={40}
                                    customTooltip={CustomTooltip}
                                    showLegend={true}
                                    showAnimation={false}
                                />
                            </ChartCard>

                            <ChartCard title="P/E & P/B">
                                <LineChart
                                    className="h-full w-full"
                                    style={{ height: '100%', width: '100%' }}
                                    data={buildSeries(r => ({ year: r.period, 'P/E': r.pe ?? 0, 'P/B': r.pb ?? 0 }))}
                                    index="year"
                                    categories={['P/E', 'P/B']}
                                    colors={['red', 'violet']}
                                    valueFormatter={formatNumber}
                                    yAxisWidth={40}
                                    customTooltip={CustomTooltip}
                                    showLegend={true}
                                    showAnimation={false}
                                />
                            </ChartCard>

                            {!isBank && (
                                <ChartCard title="Current Ratio & Quick Ratio">
                                    <LineChart
                                        className="h-full w-full"
                                        style={{ height: '100%', width: '100%' }}
                                        data={buildSeries(r => ({ year: r.period, 'Current Ratio': r.currentRatio, 'Quick Ratio': r.quickRatio }))}
                                        index="year"
                                        categories={['Current Ratio', 'Quick Ratio']}
                                        colors={['amber', 'cyan']}
                                        valueFormatter={formatNumber}
                                        yAxisWidth={40}
                                        customTooltip={CustomTooltip}
                                        showLegend={true}
                                        showAnimation={false}
                                    />
                                </ChartCard>
                            )}

                            {hasNetMarginData && (
                                <ChartCard title="Net Profit Margin (%)">
                                    <LineChart
                                        className="h-full w-full"
                                        style={{ height: '100%', width: '100%' }}
                                        data={buildSeries(r => ({ year: r.period, 'Net Margin (%)': r.netMargin }))}
                                        index="year"
                                        categories={['Net Margin (%)']}
                                        colors={['teal']}
                                        valueFormatter={v => `${formatNumber(v)}%`}
                                        yAxisWidth={48}
                                        customTooltip={CustomTooltip}
                                        showLegend={true}
                                        showAnimation={false}
                                    />
                                </ChartCard>
                            )}

                            {isBank && bankingHistory.length > 0 && (
                                <ChartCard title="NIM & CIR (%)">
                                    <LineChart
                                        className="h-full w-full"
                                        style={{ height: '100%', width: '100%' }}
                                        data={bankingHistory.map(r => ({ year: r.label, 'NIM (%)': r.nim, 'CIR (%)': r.cir }))}
                                        index="year"
                                        categories={['NIM (%)', 'CIR (%)']}
                                        colors={['blue', 'orange']}
                                        valueFormatter={v => `${formatNumber(v)}%`}
                                        yAxisWidth={48}
                                        customTooltip={CustomTooltip}
                                        showLegend={true}
                                        showAnimation={false}
                                    />
                                </ChartCard>
                            )}

                            {isBank && bankingHistory.length > 0 && (
                                <ChartCard title="NPL & CAR (%)">
                                    <LineChart
                                        className="h-full w-full"
                                        style={{ height: '100%', width: '100%' }}
                                        data={bankingHistory.map(r => ({ year: r.label, 'NPL (%)': r.npl, 'CAR (%)': r.car }))}
                                        index="year"
                                        categories={['NPL (%)', 'CAR (%)']}
                                        colors={['red', 'emerald']}
                                        valueFormatter={v => `${formatNumber(v)}%`}
                                        yAxisWidth={48}
                                        customTooltip={CustomTooltip}
                                        showLegend={true}
                                        showAnimation={false}
                                    />
                                </ChartCard>
                            )}

                            {isBank && bankingHistory.length > 0 && (
                                <ChartCard title="CASA & LDR (%)">
                                    <LineChart
                                        className="h-full w-full"
                                        style={{ height: '100%', width: '100%' }}
                                        data={bankingHistory.map(r => ({ year: r.label, 'CASA (%)': r.casa, 'LDR (%)': r.ldr }))}
                                        index="year"
                                        categories={['CASA (%)', 'LDR (%)']}
                                        colors={['violet', 'cyan']}
                                        valueFormatter={v => `${formatNumber(v)}%`}
                                        yAxisWidth={48}
                                        customTooltip={CustomTooltip}
                                        showLegend={true}
                                        showAnimation={false}
                                    />
                                </ChartCard>
                            )}

                        </div>
                    )}
                    </>
                    )}
                </div>
            )}
        </div>
    );
}
