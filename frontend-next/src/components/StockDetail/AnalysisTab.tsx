'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import BankingPeerTable from './BankingPeerTable';

interface Peer {
    symbol: string;
    name: string;
    pe: number | null;
    pb: number | null;
    roe: number | null;
    roa: number | null;
    evEbitda: number | null;
    marketCap: number | null;
    isCurrent: boolean;
}

interface AnalysisTabProps {
    symbol: string;
    sector: string;
    initialPeers?: any;
    initialHistory?: any;
    isLoading?: boolean;
}

type MetricKey = 'marketCap' | 'pe' | 'pb' | 'roe' | 'roa' | 'evEbitda';
type MetricTone = 'best' | 'worst' | 'neutral';

const PERCENT_METRICS = new Set<MetricKey>(['roe', 'roa']);
const METRIC_DIRECTION: Record<MetricKey, 'higher' | 'lower'> = {
    marketCap: 'higher', pe: 'lower', pb: 'lower',
    roe: 'higher', roa: 'higher', evEbitda: 'lower',
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
        pe: toNumberOrNull(rawPeer?.pe),
        pb: toNumberOrNull(rawPeer?.pb),
        roe: toNumberOrNull(rawPeer?.roe),
        roa: toNumberOrNull(rawPeer?.roa),
        evEbitda: toNumberOrNull(rawPeer?.evEbitda ?? rawPeer?.ev_to_ebitda ?? rawPeer?.evToEbitda),
        marketCap: toNumberOrNull(rawPeer?.marketCap ?? rawPeer?.market_cap),
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

const AnalysisTab = ({ symbol, sector, initialHistory, isLoading = false }: AnalysisTabProps) => {
    const [peers, setPeers] = useState<Peer[]>([]);
    const [peHistory, setPeHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [medianPe, setMedianPe] = useState<number | null>(null);
    const [industryName, setIndustryName] = useState<string>('');
    const [rawPeersRes, setRawPeersRes] = useState<any>(null);
    const fetchedSymbolRef = useRef<string>('');

    // Populate from initialHistory prop when it arrives
    useEffect(() => {
        if (initialHistory && peHistory.length === 0) {
            setPeHistory(topeHistory(initialHistory));
        }
    }, [initialHistory]); // eslint-disable-line react-hooks/exhaustive-deps

    // Main fetch: runs when symbol changes, uses VCI data source for peers
    useEffect(() => {
        if (isLoading) return;
        if (fetchedSymbolRef.current === symbol) return;
        fetchedSymbolRef.current = symbol;

        let cancelled = false;
        setLoading(true);

        const peersPromise = fetch(`/api/stock/peers-vci/${symbol}`).then(r => r.json());

        const historyPromise = (initialHistory == null)
            ? fetch(`/api/stock/${symbol}/historical-chart-data?period=quarter`).then(r => r.json())
            : Promise.resolve(null);

        Promise.all([peersPromise, historyPromise])
            .then(([peersRes, historyRes]) => {
                if (cancelled) return;
                if (peersRes?.success) {
                    setRawPeersRes(peersRes);
                    setPeers((peersRes.data || []).map(normalizePeer));
                    setMedianPe(toNumberOrNull(peersRes.medianPe));
                    if (peersRes.industry) setIndustryName(peersRes.industry);
                }
                if (historyRes?.success) {
                    setPeHistory(topeHistory(historyRes));
                }
            })
            .catch(err => console.error('AnalysisTab fetch error:', err))
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [symbol, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

    const metricExtremes = useMemo(() => {
        const metricKeys: MetricKey[] = ['marketCap', 'pe', 'pb', 'roe', 'roa', 'evEbitda'];
        return metricKeys.reduce((acc, key) => {
            const values = peers
                .map(peer => normalizeMetricValue(key, peer[key]))
                .filter((value): value is number => value !== null && value > 0);
            if (values.length === 0) { acc[key] = { best: null, worst: null }; return acc; }
            const minValue = Math.min(...values);
            const maxValue = Math.max(...values);
            const higherIsBetter = METRIC_DIRECTION[key] === 'higher';
            acc[key] = { best: higherIsBetter ? maxValue : minValue, worst: higherIsBetter ? minValue : maxValue };
            return acc;
        }, {} as Record<MetricKey, { best: number | null; worst: number | null }>);
    }, [peers]);

    const displayIndustry = industryName || sector || 'Unknown';

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
            {industryName === 'Ngân hàng' ? (
                <BankingPeerTable
                    symbol={symbol}
                    industry={industryName}
                    initialPeers={rawPeersRes}
                    initialPeriod={rawPeersRes?.period ?? null}
                />
            ) : (
                <Card className="p-0 overflow-hidden">
                    <div className="p-6 border-b border-tremor-border dark:border-dark-tremor-border bg-tremor-background-muted/50 dark:bg-dark-tremor-background-muted/20">
                        <div className="sm:flex sm:items-center sm:justify-between sm:space-x-10">
                            <div>
                                <h3 className="text-lg font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                    So sánh ngành
                                </h3>
                                <p className="mt-1 text-tremor-default leading-6 text-tremor-content dark:text-dark-tremor-content">
                                    {peers.length} công ty · {displayIndustry} · sắp xếp theo vốn hóa
                                </p>
                            </div>
                            {medianPe !== null && (
                                <div className="mt-4 sm:mt-0">
                                    <span className="inline-flex items-center rounded-tremor-small bg-blue-50 px-3 py-1.5 text-tremor-default font-bold text-blue-700 ring-1 ring-inset ring-blue-600/20 dark:bg-blue-400/10 dark:text-blue-400 dark:ring-blue-400/20">
                                        Median P/E ngành: {medianPe.toFixed(2)}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="px-4 pb-4">
                        <Table className="h-[450px] [&>table]:border-separate [&>table]:border-spacing-0">
                            <TableHead>
                                <TableRow>
                                    <TableHeaderCell className="sticky top-0 z-10 border-b border-tremor-border bg-white text-tremor-content-strong dark:border-dark-tremor-border dark:bg-gray-900 dark:text-dark-tremor-content-strong">Mã CK</TableHeaderCell>
                                    <TableHeaderCell className="sticky top-0 z-10 border-b border-tremor-border bg-white text-right text-tremor-content-strong dark:border-dark-tremor-border dark:bg-gray-900 dark:text-dark-tremor-content-strong">Vốn hóa</TableHeaderCell>
                                    <TableHeaderCell className="sticky top-0 z-10 border-b border-tremor-border bg-white text-right text-tremor-content-strong dark:border-dark-tremor-border dark:bg-gray-900 dark:text-dark-tremor-content-strong">P/E</TableHeaderCell>
                                    <TableHeaderCell className="sticky top-0 z-10 border-b border-tremor-border bg-white text-right text-tremor-content-strong dark:border-dark-tremor-border dark:bg-gray-900 dark:text-dark-tremor-content-strong">P/B</TableHeaderCell>
                                    <TableHeaderCell className="sticky top-0 z-10 border-b border-tremor-border bg-white text-right text-tremor-content-strong dark:border-dark-tremor-border dark:bg-gray-900 dark:text-dark-tremor-content-strong">ROE (%)</TableHeaderCell>
                                    <TableHeaderCell className="sticky top-0 z-10 border-b border-tremor-border bg-white text-right text-tremor-content-strong dark:border-dark-tremor-border dark:bg-gray-900 dark:text-dark-tremor-content-strong">ROA (%)</TableHeaderCell>
                                    <TableHeaderCell className="sticky top-0 z-10 border-b border-tremor-border bg-white text-right text-tremor-content-strong dark:border-dark-tremor-border dark:bg-gray-900 dark:text-dark-tremor-content-strong">EV/EBITDA</TableHeaderCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {peers.map((item) => {
                                    const marketCap = toNumberOrNull(item.marketCap);
                                    const pe = toNumberOrNull(item.pe);
                                    const pb = toNumberOrNull(item.pb);
                                    const roe = toNumberOrNull(item.roe);
                                    const roa = toNumberOrNull(item.roa);
                                    const evEbitda = toNumberOrNull(item.evEbitda);

                                    const marketCapTone = getMetricTone(metricExtremes, 'marketCap', marketCap);
                                    const peTone = getMetricTone(metricExtremes, 'pe', pe);
                                    const pbTone = getMetricTone(metricExtremes, 'pb', pb);
                                    const roeTone = getMetricTone(metricExtremes, 'roe', roe);
                                    const roaTone = getMetricTone(metricExtremes, 'roa', roa);
                                    const evEbitdaTone = getMetricTone(metricExtremes, 'evEbitda', evEbitda);

                                    const fmtCap = (v: number | null) => {
                                        if (v === null || v <= 0) return '-';
                                        if (v >= 1e12) return `${(v / 1e12).toFixed(1)}N`;
                                        if (v >= 1e9) return `${(v / 1e9).toFixed(1)}T`;
                                        return `${(v / 1e6).toFixed(0)}M`;
                                    };

                                    return (
                                        <TableRow key={item.symbol} className={cx(
                                            item.isCurrent ? 'bg-blue-50/50 dark:bg-blue-900/10' : 'hover:bg-gray-50/50 dark:hover:bg-gray-800/20'
                                        )}>
                                            <TableCell className="border-b border-tremor-border dark:border-dark-tremor-border">
                                                <div className="flex flex-col">
                                                    {item.isCurrent ? (
                                                        <span className="font-bold text-tremor-default text-blue-600 dark:text-blue-400">
                                                            {item.symbol}
                                                            <span className="ml-2 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full dark:bg-blue-800 dark:text-blue-200 uppercase">Hiện tại</span>
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
                                                {fmtCap(marketCap)}
                                            </TableCell>
                                            <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                                <span className={cx('font-medium', metricToneClass(peTone))}>{pe !== null && pe > 0 ? `${pe.toFixed(1)}×` : '-'}</span>
                                            </TableCell>
                                            <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                                <span className={cx('font-medium', metricToneClass(pbTone))}>{pb !== null && pb > 0 ? `${pb.toFixed(2)}×` : '-'}</span>
                                            </TableCell>
                                            <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                                <span className={cx('font-medium', metricToneClass(roeTone))}>{formatPercentByKey('roe', roe)}</span>
                                            </TableCell>
                                            <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                                <span className={cx('font-medium', metricToneClass(roaTone))}>{formatPercentByKey('roa', roa)}</span>
                                            </TableCell>
                                            <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                                <span className={cx('font-medium', metricToneClass(evEbitdaTone))}>{evEbitda !== null && evEbitda > 0 ? `${evEbitda.toFixed(1)}×` : '-'}</span>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                </Card>
            )}
        </div>
    );
};

export default React.memo(AnalysisTab, (prev, next) =>
    prev.symbol === next.symbol && prev.isLoading === next.isLoading
);
