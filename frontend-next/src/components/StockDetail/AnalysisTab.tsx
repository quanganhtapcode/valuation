'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
    Card,
    Title,
    Text,
    Table,
    TableHead,
    TableRow,
    TableHeaderCell,
    TableBody,
    TableCell,
} from '@tremor/react';
import { LineChart } from '@tremor/react';
import { formatNumber } from '@/lib/api';
import { cx } from '@/lib/utils';

interface Peer {
    symbol: string;
    name: string;
    industry?: string | null;
    pe: number | null;
    pb: number | null;
    roe: number | null;
    roa: number | null;
    marketCap: number | null;
    netMargin: number | null;
    profitGrowth: number | null;
    isCurrent: boolean;
}

interface AnalysisTabProps {
    symbol: string;
    sector: string;
    initialPeers?: any;
    initialHistory?: any;
    isLoading?: boolean;
}

type MetricKey = 'marketCap' | 'pe' | 'pb' | 'roe' | 'roa' | 'netMargin' | 'profitGrowth';
type MetricTone = 'best' | 'worst' | 'neutral';

const PERCENT_METRICS = new Set<MetricKey>(['roe', 'roa', 'netMargin', 'profitGrowth']);
const METRIC_DIRECTION: Record<MetricKey, 'higher' | 'lower'> = {
    marketCap: 'higher', pe: 'lower', pb: 'lower',
    roe: 'higher', roa: 'higher', netMargin: 'higher', profitGrowth: 'higher',
};

function toNumberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMetricValue(key: MetricKey, value: unknown): number | null {
    const parsed = toNumberOrNull(value);
    if (parsed === null) return null;
    if (PERCENT_METRICS.has(key) && Math.abs(parsed) < 1) return parsed * 100;
    return parsed;
}

function formatPercentByKey(key: MetricKey, value: unknown, digits: number = 1): string {
    const normalized = normalizeMetricValue(key, value);
    if (normalized === null) return '-';
    return `${normalized.toFixed(digits)}%`;
}

function normalizePeer(rawPeer: any): Peer {
    return {
        symbol: String(rawPeer?.symbol || '').toUpperCase(),
        name: rawPeer?.name || rawPeer?.symbol || '-',
        industry: rawPeer?.industry || null,
        pe: toNumberOrNull(rawPeer?.pe),
        pb: toNumberOrNull(rawPeer?.pb),
        roe: toNumberOrNull(rawPeer?.roe),
        roa: toNumberOrNull(rawPeer?.roa),
        marketCap: toNumberOrNull(rawPeer?.marketCap ?? rawPeer?.market_cap),
        netMargin: toNumberOrNull(rawPeer?.netMargin ?? rawPeer?.net_profit_margin),
        profitGrowth: toNumberOrNull(rawPeer?.profitGrowth ?? rawPeer?.profit_growth ?? rawPeer?.netProfitGrowth ?? rawPeer?.net_profit_growth),
        isCurrent: Boolean(rawPeer?.isCurrent),
    };
}

function getMetricTone(
    metricExtremes: Record<MetricKey, { best: number | null; worst: number | null }>,
    key: MetricKey,
    value: unknown,
): MetricTone {
    const normalized = normalizeMetricValue(key, value);
    const extremes = metricExtremes[key];
    if (normalized === null || extremes.best === null || extremes.worst === null) return 'neutral';
    if (Math.abs(extremes.best - extremes.worst) < 1e-9) return 'neutral';
    if (Math.abs(normalized - extremes.best) < 1e-9) return 'best';
    if (Math.abs(normalized - extremes.worst) < 1e-9) return 'worst';
    return 'neutral';
}

function metricToneClass(tone: MetricTone): string {
    if (tone === 'best') return 'text-emerald-600 dark:text-emerald-400';
    if (tone === 'worst') return 'text-rose-600 dark:text-rose-400';
    return 'text-tremor-content-strong dark:text-dark-tremor-content-strong';
}

/** Convert API response (new array-of-objects or legacy parallel-arrays) to chart rows. */
function topeHistory(res: any): { period: string; 'P/E': number; 'P/B': number }[] {
    if (Array.isArray(res?.data)) {
        return (res.data as any[])
            .filter(r => (r.pe || r['P/E']) > 0)
            .map(r => ({ period: r.period, 'P/E': r.pe ?? r['P/E'] ?? 0, 'P/B': r.pb ?? r['P/B'] ?? 0 }));
    }
    if (Array.isArray(res?.records)) {
        return res.records
            .filter((r: any) => r.pe > 0)
            .map((r: any) => ({ period: r.period, 'P/E': r.pe, 'P/B': r.pb ?? 0 }));
    }
    const d = res?.data ?? res;
    if (Array.isArray(d?.years)) {
        return (d.years as string[])
            .map((p: string, i: number) => ({ period: p, 'P/E': d.pe_ratio_data?.[i] || 0, 'P/B': d.pb_ratio_data?.[i] || 0 }))
            .filter((r: any) => r['P/E'] > 0);
    }
    return [];
}

// ── component ─────────────────────────────────────────────────────────────────

const AnalysisTab = ({ symbol, sector, initialPeers, initialHistory, isLoading = false }: AnalysisTabProps) => {
    const [peers, setPeers] = useState<Peer[]>((initialPeers?.data || initialPeers?.peers || []).map(normalizePeer));
    const [peHistory, setPeHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(!initialPeers && !initialHistory);
    const [medianPe, setMedianPe] = useState<number | null>(toNumberOrNull(initialPeers?.medianPe));

    useEffect(() => {
        if ((initialPeers?.data || initialPeers?.peers) && peers.length === 0) {
            setPeers((initialPeers.data || initialPeers.peers).map(normalizePeer));
            setMedianPe(toNumberOrNull(initialPeers.medianPe));
            if (peHistory.length > 0) setLoading(false);
        }
    }, [initialPeers]);

    useEffect(() => {
        if (initialHistory && peHistory.length === 0) {
            setPeHistory(topeHistory(initialHistory));
            if (peers.length > 0) setLoading(false);
        }
    }, [initialHistory]);

    useEffect(() => {
        const fetchData = async () => {
            if (isLoading) return;
            if (peers.length > 0 && peHistory.length > 0) { setLoading(false); return; }
            setLoading(true);
            try {
                const [peersRes, historyRes] = await Promise.all([
                    peers.length === 0
                        ? fetch(`/api/stock/peers/${symbol}?industry=${encodeURIComponent(sector)}`).then(r => r.json())
                        : Promise.resolve({ success: true, peers, medianPe }),
                    (peHistory.length === 0 && !initialHistory)
                        ? fetch(`/api/historical-chart-data/${symbol}?period=quarter`).then(r => r.json())
                        : Promise.resolve(null),
                ]);
                if (peersRes.success) {
                    setPeers((peersRes.data || peersRes.peers || []).map(normalizePeer));
                    setMedianPe(toNumberOrNull(peersRes.medianPe));
                }
                if (historyRes?.success) {
                    setPeHistory(topeHistory(historyRes));
                }
            } catch (error) {
                console.error('Error fetching analysis data:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [symbol, sector, isLoading, initialHistory]);

    const metricExtremes = useMemo(() => {
        const metricKeys: MetricKey[] = ['marketCap', 'pe', 'pb', 'roe', 'roa', 'netMargin', 'profitGrowth'];
        return metricKeys.reduce((acc, key) => {
            const values = peers
                .map(peer => normalizeMetricValue(key, peer[key]))
                .filter((value): value is number => value !== null);
            if (values.length === 0) { acc[key] = { best: null, worst: null }; return acc; }
            const minValue = Math.min(...values);
            const maxValue = Math.max(...values);
            const higherIsBetter = METRIC_DIRECTION[key] === 'higher';
            acc[key] = { best: higherIsBetter ? maxValue : minValue, worst: higherIsBetter ? minValue : maxValue };
            return acc;
        }, {} as Record<MetricKey, { best: number | null; worst: number | null }>);
    }, [peers]);

    const displayIndustry = useMemo(() => {
        const rawSector = String(sector || '').trim();
        if (rawSector && rawSector.toLowerCase() !== 'unknown') return rawSector;
        return peers.map(p => String(p.industry || '').trim()).find(v => v && v.toLowerCase() !== 'unknown') || 'Unknown';
    }, [sector, peers]);

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12">
                <div className="spinner" />
                <span className="ml-3 text-tremor-default text-tremor-content">Loading analysis...</span>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Historical valuation */}
            <Card className="p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
                    <div>
                        <Title>Valuation History</Title>
                        <Text>Historical P/E and P/B ratios over time</Text>
                    </div>
                    {peHistory.length > 0 && (
                        <div className="flex gap-4">
                            <div className="text-right">
                                <Text className="text-xs uppercase font-semibold text-tremor-content-subtle">Current P/E</Text>
                                <Title className="text-blue-600">{peHistory[peHistory.length - 1]['P/E'].toFixed(2)}</Title>
                            </div>
                            <div className="text-right">
                                <Text className="text-xs uppercase font-semibold text-tremor-content-subtle">Current P/B</Text>
                                <Title className="text-violet-600">{peHistory[peHistory.length - 1]['P/B'].toFixed(2)}</Title>
                            </div>
                        </div>
                    )}
                </div>
                <div className="h-80">
                    <LineChart
                        className="h-full"
                        data={peHistory}
                        index="period"
                        categories={['P/E', 'P/B']}
                        colors={['blue', 'violet']}
                        valueFormatter={(number: number) => number.toFixed(2)}
                        showAnimation={false}
                        showLegend={true}
                        showTooltip={true}
                        autoMinValue={true}
                        yAxisWidth={40}
                    />
                </div>
            </Card>

            {/* Peer comparison */}
            <Card className="p-0 overflow-hidden">
                <div className="p-6 border-b border-tremor-border dark:border-dark-tremor-border bg-tremor-background-muted/50 dark:bg-dark-tremor-background-muted/20">
                    <div className="sm:flex sm:items-center sm:justify-between sm:space-x-10">
                        <div>
                            <h3 className="text-lg font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                Industry Comparison
                            </h3>
                            <p className="mt-1 text-tremor-default leading-6 text-tremor-content dark:text-dark-tremor-content">
                                Comparison with top {displayIndustry} peers ranked by Market Cap.
                            </p>
                        </div>
                        {medianPe !== null && (
                            <div className="mt-4 sm:mt-0">
                                <span className="inline-flex items-center rounded-tremor-small bg-blue-50 px-3 py-1.5 text-tremor-default font-bold text-blue-700 ring-1 ring-inset ring-blue-600/20 dark:bg-blue-400/10 dark:text-blue-400 dark:ring-blue-400/20">
                                    Industry Median P/E: {medianPe.toFixed(2)}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
                <div className="px-4 pb-4">
                    <Table className="h-[450px] [&>table]:border-separate [&>table]:border-spacing-0">
                        <TableHead>
                            <TableRow>
                                <TableHeaderCell className="sticky top-0 z-10 border-b border-tremor-border bg-white text-tremor-content-strong dark:border-dark-tremor-border dark:bg-gray-900 dark:text-dark-tremor-content-strong">Symbol</TableHeaderCell>
                                <TableHeaderCell className="sticky top-0 z-10 border-b border-tremor-border bg-white text-right text-tremor-content-strong dark:border-dark-tremor-border dark:bg-gray-900 dark:text-dark-tremor-content-strong">Market Cap (B)</TableHeaderCell>
                                <TableHeaderCell className="sticky top-0 z-10 border-b border-tremor-border bg-white text-right text-tremor-content-strong dark:border-dark-tremor-border dark:bg-gray-900 dark:text-dark-tremor-content-strong">P/E</TableHeaderCell>
                                <TableHeaderCell className="sticky top-0 z-10 border-b border-tremor-border bg-white text-right text-tremor-content-strong dark:border-dark-tremor-border dark:bg-gray-900 dark:text-dark-tremor-content-strong">P/B</TableHeaderCell>
                                <TableHeaderCell className="sticky top-0 z-10 border-b border-tremor-border bg-white text-right text-tremor-content-strong dark:border-dark-tremor-border dark:bg-gray-900 dark:text-dark-tremor-content-strong">ROE (%)</TableHeaderCell>
                                <TableHeaderCell className="sticky top-0 z-10 border-b border-tremor-border bg-white text-right text-tremor-content-strong dark:border-dark-tremor-border dark:bg-gray-900 dark:text-dark-tremor-content-strong">ROA (%)</TableHeaderCell>
                                <TableHeaderCell className="sticky top-0 z-10 border-b border-tremor-border bg-white text-right text-tremor-content-strong dark:border-dark-tremor-border dark:bg-gray-900 dark:text-dark-tremor-content-strong">Net Margin (%)</TableHeaderCell>
                                <TableHeaderCell className="sticky top-0 z-10 border-b border-tremor-border bg-white text-right text-tremor-content-strong dark:border-dark-tremor-border dark:bg-gray-900 dark:text-dark-tremor-content-strong">Growth (%)</TableHeaderCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {peers.map((item) => {
                                const marketCap = toNumberOrNull(item.marketCap);
                                const pe = toNumberOrNull(item.pe);
                                const pb = toNumberOrNull(item.pb);
                                const roe = toNumberOrNull(item.roe);
                                const roa = toNumberOrNull(item.roa);
                                const netMargin = toNumberOrNull(item.netMargin);
                                const profitGrowth = toNumberOrNull(item.profitGrowth);

                                const marketCapTone = getMetricTone(metricExtremes, 'marketCap', marketCap);
                                const peTone = getMetricTone(metricExtremes, 'pe', pe);
                                const pbTone = getMetricTone(metricExtremes, 'pb', pb);
                                const roeTone = getMetricTone(metricExtremes, 'roe', roe);
                                const roaTone = getMetricTone(metricExtremes, 'roa', roa);
                                const netMarginTone = getMetricTone(metricExtremes, 'netMargin', netMargin);
                                const growthTone = getMetricTone(metricExtremes, 'profitGrowth', profitGrowth);

                                return (
                                    <TableRow key={item.symbol} className={cx(
                                        item.isCurrent ? 'bg-blue-50/50 dark:bg-blue-900/10' : 'hover:bg-gray-50/50 dark:hover:bg-gray-800/20'
                                    )}>
                                        <TableCell className="border-b border-tremor-border dark:border-dark-tremor-border">
                                            <div className="flex flex-col">
                                                {item.isCurrent ? (
                                                    <span className="font-bold text-tremor-default text-blue-600 dark:text-blue-400">
                                                        {item.symbol}
                                                        <span className="ml-2 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full dark:bg-blue-800 dark:text-blue-200 uppercase">Current</span>
                                                    </span>
                                                ) : (
                                                    <Link href={`/stock/${item.symbol}`}
                                                        className="font-bold text-tremor-default text-tremor-content-strong dark:text-dark-tremor-content-strong hover:text-blue-600 dark:hover:text-blue-400 hover:underline transition-colors">
                                                        {item.symbol}
                                                    </Link>
                                                )}
                                                <span className="text-xs text-tremor-content-subtle truncate max-w-[150px]">{item.name}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className={cx('text-right font-bold border-b border-tremor-border dark:border-dark-tremor-border', metricToneClass(marketCapTone))}>
                                            {marketCap !== null ? `${formatNumber(marketCap / 1e9)}B` : '-'}
                                        </TableCell>
                                        <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                            <span className={cx('font-medium', metricToneClass(peTone))}>{pe !== null ? pe.toFixed(2) : '-'}</span>
                                        </TableCell>
                                        <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                            <span className={cx('font-medium', metricToneClass(pbTone))}>{pb !== null ? pb.toFixed(2) : '-'}</span>
                                        </TableCell>
                                        <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                            <span className={cx('font-medium', metricToneClass(roeTone))}>{formatPercentByKey('roe', roe)}</span>
                                        </TableCell>
                                        <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                            <span className={cx('font-medium', metricToneClass(roaTone))}>{formatPercentByKey('roa', roa)}</span>
                                        </TableCell>
                                        <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                            <span className={cx('font-medium', metricToneClass(netMarginTone))}>{formatPercentByKey('netMargin', netMargin)}</span>
                                        </TableCell>
                                        <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                            <span className={cx(
                                                'inline-flex items-center rounded-tremor-small px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
                                                growthTone === 'best'
                                                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-emerald-400/20'
                                                    : growthTone === 'worst'
                                                        ? 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-400/10 dark:text-rose-400 dark:ring-rose-400/20'
                                                        : 'bg-gray-50 text-gray-700 ring-gray-600/20 dark:bg-gray-400/10 dark:text-gray-400 dark:ring-gray-400/20'
                                            )}>
                                                {formatPercentByKey('profitGrowth', profitGrowth)}
                                            </span>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            </Card>
        </div>
    );
};

export default React.memo(AnalysisTab, (prev, next) =>
    prev.symbol === next.symbol && prev.sector === next.sector && prev.isLoading === next.isLoading
);
