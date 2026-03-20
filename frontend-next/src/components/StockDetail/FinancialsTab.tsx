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

// ── main ──────────────────────────────────────────────────────────────────────

export default function FinancialsTab({
    symbol,
    period,
    setPeriod: _setPeriod,
    initialChartData,
    initialOverviewData,
    isLoading: isParentLoading = false,
}: FinancialsTabProps) {
    void _setPeriod;
    const effectivePeriod: 'quarter' | 'year' = period ?? 'quarter';
    const [chartData, setChartData] = useState<HistoricalChartData | null>(() => parseChartResponse(initialChartData) || null);
    const [overviewData, setOverviewData] = useState<any>(initialOverviewData || null);
    const [loading, setLoading] = useState<boolean>(!initialChartData && !isParentLoading);
    const [bankingHistory, setBankingHistory] = useState<any[]>([]);
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

                    {/* Metric cards */}
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
                </div>
            )}
        </div>
    );
}
