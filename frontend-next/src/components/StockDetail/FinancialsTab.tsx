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

type ReportType = 'income' | 'balance' | 'cashflow' | 'ratio';
type StatementWindow = '4' | '8' | '12' | 'all';

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

function formatMetricLabel(key: string): string {
    if (!key) return '';
    if (/^[a-z]{3}\d+$/i.test(key)) return key.toUpperCase(); // isa1/bsa1/cfa1/noc1
    const text = key.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
}

// ── main ──────────────────────────────────────────────────────────────────────

export default function FinancialsTab({
    symbol,
    period,
    setPeriod: _setPeriod,
    initialChartData,
    initialOverviewData,
    isLoading: isParentLoading = false,
}: FinancialsTabProps) {
    const effectivePeriod: 'quarter' | 'year' = period ?? 'year';
    const [chartData, setChartData] = useState<HistoricalChartData | null>(() => parseChartResponse(initialChartData) || null);
    const [overviewData, setOverviewData] = useState<any>(initialOverviewData || null);
    const [loading, setLoading] = useState<boolean>(!initialChartData && !isParentLoading);
    const [bankingHistory, setBankingHistory] = useState<any[]>([]);
    const [activeSubTab, setActiveSubTab] = useState<'ratio' | 'income' | 'balance' | 'cashflow'>('ratio');
    const [reportLoading, setReportLoading] = useState(false);
    const [reportData, setReportData] = useState<Record<ReportType, Record<string, any>[]>>({
        income: [],
        balance: [],
        cashflow: [],
        ratio: [],
    });
    const [metricMaps, setMetricMaps] = useState<Record<'income' | 'balance' | 'cashflow', Record<string, string>>>({
        income: {},
        balance: {},
        cashflow: {},
    });
    const [statementWindow, setStatementWindow] = useState<StatementWindow>('4');
    const periodInitRef = useRef(false);
    const isInitialMount = useRef(true);

    const BANK_SYMBOLS = new Set(['VCB','BID','CTG','TCB','MBB','ACB','VPB','HDB','SHB','STB','TPB','LPB','MSB','OCB','EIB','ABB','NAB','PGB','VAB','VIB','SSB','BAB','KLB','BVB','KBS','SGB','NVB']);
    const nimValue = overviewData?.nim ?? overviewData?.net_interest_margin ?? null;
    const isBank = nimValue !== null && nimValue !== undefined ? Number(nimValue) > 0 : BANK_SYMBOLS.has(symbol);

    useEffect(() => {
        if (periodInitRef.current) return;
        periodInitRef.current = true;
        if (_setPeriod && period !== 'year') _setPeriod('year');
    }, [period, _setPeriod]);

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
            fetch(`/api/financial-report/${symbol}?type=ratio&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
        ])
            .then(([income, balance, cashflow, ratio]) => {
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
                    ratio: unwrap(ratio),
                });
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
        ]).then(([income, balance, cashflow]) => {
            if (controller.signal.aborted) return;
            const unwrap = (res: PromiseSettledResult<any>) => {
                if (res.status !== 'fulfilled') return {};
                return (res.value?.field_map ?? {}) as Record<string, string>;
            };
            setMetricMaps({
                income: unwrap(income),
                balance: unwrap(balance),
                cashflow: unwrap(cashflow),
            });
        });
        return () => controller.abort();
    }, [symbol]);

    const handleDownloadStatementCsv = () => {
        if (activeSubTab === 'ratio') return;
        const rows = reportData[activeSubTab] || [];
        const sorted = [...rows].sort((a, b) => periodSortKey(b) - periodSortKey(a));
        const visibleRows =
            statementWindow === 'all' ? sorted : sorted.slice(0, Number(statementWindow));
        const metricKeys = pickColumns(visibleRows);
        if (!visibleRows.length || !metricKeys.length) return;

        const currentMap = activeSubTab === 'income'
            ? metricMaps.income
            : activeSubTab === 'balance'
                ? metricMaps.balance
                : metricMaps.cashflow;

        const header = ['Metric', ...visibleRows.map((row) => renderPeriod(row))].join(',');
        const body = metricKeys.map((metric) => {
            const label = currentMap[metric.toLowerCase()] || formatMetricLabel(metric);
            const values = visibleRows.map((row) => {
                const value = formatCell(row[metric]).replaceAll(',', '');
                return `"${value}"`;
            });
            return [`"${label}"`, ...values].join(',');
        });
        const csvContent = '\uFEFF' + [header, ...body].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `${symbol}_${activeSubTab}_${effectivePeriod}_${statementWindow}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    <div className="mb-1">
                        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Financials</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Income Statement, Balance Sheet, Cash Flow and Ratios
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-tremor-border bg-white p-2 shadow-sm dark:border-dark-tremor-border dark:bg-gray-950">
                        <div className="flex flex-wrap items-center gap-2">
                            {[
                                { id: 'ratio', label: 'Ratios' },
                                { id: 'income', label: 'Income Statement' },
                                { id: 'balance', label: 'Balance Sheet' },
                                { id: 'cashflow', label: 'Cash Flow' },
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => {
                                        setActiveSubTab(tab.id as 'ratio' | 'income' | 'balance' | 'cashflow');
                                        setStatementWindow('4');
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

                        <div className="flex flex-wrap items-center gap-2">
                            <div className="flex items-center gap-0">
                                <button
                                    type="button"
                                    onClick={() => {
                                        _setPeriod?.('year');
                                        setStatementWindow('4');
                                    }}
                                    className={cx(
                                        'rounded-l-tremor-small border border-tremor-border px-3 py-1.5 text-sm font-medium -mr-px dark:border-dark-tremor-border',
                                        effectivePeriod === 'year'
                                            ? 'bg-tremor-brand-muted text-tremor-brand dark:bg-dark-tremor-brand-muted dark:text-dark-tremor-brand'
                                            : 'bg-white text-tremor-content-strong hover:bg-tremor-background-muted dark:bg-dark-tremor-background dark:text-dark-tremor-content-strong hover:dark:bg-gray-900'
                                    )}
                                >
                                    Annual
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        _setPeriod?.('quarter');
                                        setStatementWindow('4');
                                    }}
                                    className={cx(
                                        'rounded-r-tremor-small border border-tremor-border px-3 py-1.5 text-sm font-medium dark:border-dark-tremor-border',
                                        effectivePeriod === 'quarter'
                                            ? 'bg-tremor-brand-muted text-tremor-brand dark:bg-dark-tremor-brand-muted dark:text-dark-tremor-brand'
                                            : 'bg-white text-tremor-content-strong hover:bg-tremor-background-muted dark:bg-dark-tremor-background dark:text-dark-tremor-content-strong hover:dark:bg-gray-900'
                                    )}
                                >
                                    Quarterly
                                </button>
                            </div>

                            <select
                                value={statementWindow}
                                onChange={(e) => setStatementWindow(e.target.value as StatementWindow)}
                                disabled={activeSubTab === 'ratio'}
                                className="rounded-tremor-small border border-tremor-border bg-white px-2.5 py-2 text-sm text-tremor-content-strong disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-tremor-border dark:bg-gray-950 dark:text-dark-tremor-content-strong"
                            >
                                <option value="4">4 kỳ gần nhất</option>
                                <option value="8">8 kỳ</option>
                                <option value="12">12 kỳ</option>
                                <option value="all">Tất cả</option>
                            </select>

                            <button
                                type="button"
                                onClick={handleDownloadStatementCsv}
                                disabled={activeSubTab === 'ratio'}
                                className="inline-flex items-center justify-center gap-2 rounded-tremor-small border border-tremor-border bg-white px-3 py-2 text-sm font-medium text-tremor-content-strong shadow-sm disabled:cursor-not-allowed disabled:opacity-50 hover:bg-tremor-background-muted dark:border-dark-tremor-border dark:bg-dark-tremor-background dark:text-dark-tremor-content-strong"
                            >
                                <span>Download CSV</span>
                            </button>
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
                                    const metricKeys = pickColumns(periodRows);
                                    const currentMap = activeSubTab === 'income'
                                        ? metricMaps.income
                                        : activeSubTab === 'balance'
                                            ? metricMaps.balance
                                            : metricMaps.cashflow;
                                    if (!periodRows.length || !metricKeys.length) {
                                        return <div className="p-4 text-sm text-tremor-content dark:text-dark-tremor-content">No data.</div>;
                                    }
                                    return (
                                        <div className="w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                                            <table className="min-w-full w-max border-collapse text-sm">
                                                <thead className="bg-gray-50/50 dark:bg-gray-900/50">
                                                    <tr>
                                                        <th className="sticky left-0 z-10 min-w-[260px] border-b border-tremor-border bg-gray-50/50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-tremor-content dark:border-dark-tremor-border dark:bg-gray-900/50 dark:text-dark-tremor-content">
                                                            {activeSubTab === 'income' ? 'Income Statement' : activeSubTab === 'balance' ? 'Balance Sheet' : 'Cash Flow'}
                                                        </th>
                                                        {periodRows.map((row, idx) => (
                                                            <th key={`${renderPeriod(row)}-${idx}`} className="whitespace-nowrap border-b border-tremor-border px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-tremor-content dark:border-dark-tremor-border dark:text-dark-tremor-content">
                                                                {renderPeriod(row)}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                                    {metricKeys.map((metric) => (
                                                        <tr key={metric} className="hover:bg-gray-50/50 dark:hover:bg-gray-900/50 transition-colors">
                                                            <td className="sticky left-0 z-[1] min-w-[260px] bg-white px-4 py-3 text-sm font-medium text-tremor-content-strong dark:bg-gray-950 dark:text-dark-tremor-content-strong">
                                                                {currentMap[metric.toLowerCase()] || formatMetricLabel(metric)}
                                                            </td>
                                                            {periodRows.map((row, idx) => (
                                                                <td key={`${metric}-${idx}`} className="whitespace-nowrap px-4 py-3 text-right text-sm text-tremor-content dark:text-dark-tremor-content">
                                                                    {formatCell(row[metric])}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
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
