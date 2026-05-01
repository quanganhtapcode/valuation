'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
    Card,
    Table,
    TableHead,
    TableRow,
    TableHeaderCell,
    TableBody,
    TableCell,
} from '@tremor/react';
import { cx } from '@/lib/utils';

interface BankPeer {
    symbol: string;
    name: string;
    pe: number | null;
    pb: number | null;
    roe: number | null;
    marketCap: number | null;
    nim: number | null;
    cir: number | null;
    casa: number | null;
    npl: number | null;
    ldr: number | null;
    loansGrowth: number | null;
    isCurrent: boolean;
}

type Mode = 'quarter' | 'year';
type MetricKey = 'marketCap' | 'pe' | 'pb' | 'roe' | 'nim' | 'cir' | 'casa' | 'npl' | 'ldr' | 'loansGrowth';
type MetricTone = 'best' | 'worst' | 'neutral';

const METRIC_DIRECTION: Record<MetricKey, 'higher' | 'lower'> = {
    marketCap: 'higher', pe: 'lower', pb: 'lower',
    roe: 'higher', nim: 'higher', cir: 'lower',
    casa: 'higher', npl: 'lower', ldr: 'lower', loansGrowth: 'higher',
};

function toNum(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
}

function fmtCap(v: number | null): string {
    if (v === null || v <= 0) return '-';
    if (v >= 1e12) return `${(v / 1e12).toFixed(1)}N`;
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}T`;
    return `${(v / 1e6).toFixed(0)}M`;
}

function fmtPct(v: number | null): string {
    if (v === null) return '-';
    return `${(v * 100).toFixed(2)}%`;
}

function fmtRatio(v: number | null): string {
    if (v === null) return '-';
    return v.toFixed(2);
}

function getMetricValue(key: MetricKey, peer: BankPeer): number | null {
    if (key === 'cir') {
        const v = toNum(peer.cir);
        return v !== null ? Math.abs(v) : null;
    }
    return toNum(peer[key]);
}

function buildExtremes(peers: BankPeer[]): Record<MetricKey, { best: number | null; worst: number | null }> {
    const keys: MetricKey[] = ['marketCap', 'pe', 'pb', 'roe', 'nim', 'cir', 'casa', 'npl', 'ldr', 'loansGrowth'];
    return keys.reduce((acc, key) => {
        const values = peers
            .map(p => getMetricValue(key, p))
            .filter((v): v is number => v !== null && isFinite(v) && (key === 'pe' || key === 'pb' ? v > 0 : true));
        if (values.length === 0) { acc[key] = { best: null, worst: null }; return acc; }
        const min = Math.min(...values);
        const max = Math.max(...values);
        const higherBetter = METRIC_DIRECTION[key] === 'higher';
        acc[key] = { best: higherBetter ? max : min, worst: higherBetter ? min : max };
        return acc;
    }, {} as Record<MetricKey, { best: number | null; worst: number | null }>);
}

function getTone(
    extremes: Record<MetricKey, { best: number | null; worst: number | null }>,
    key: MetricKey,
    value: number | null,
): MetricTone {
    if (value === null || extremes[key].best === null) return 'neutral';
    if (value === extremes[key].best) return 'best';
    if (value === extremes[key].worst) return 'worst';
    return 'neutral';
}

function toneClass(tone: MetricTone): string {
    if (tone === 'best') return 'text-emerald-600 dark:text-emerald-400';
    if (tone === 'worst') return 'text-red-500 dark:text-red-400';
    return 'text-tremor-content-strong dark:text-dark-tremor-content-strong';
}

function normalizePeer(raw: any): BankPeer {
    return {
        symbol: raw.symbol ?? raw.ticker ?? '',
        name: raw.name ?? raw.organ_name ?? '',
        pe: toNum(raw.pe),
        pb: toNum(raw.pb),
        roe: toNum(raw.roe),
        marketCap: toNum(raw.marketCap ?? raw.market_cap),
        nim: toNum(raw.nim ?? raw.netInterestMargin),
        cir: toNum(raw.cir),
        casa: toNum(raw.casa ?? raw.casaRatio),
        npl: toNum(raw.npl),
        ldr: toNum(raw.ldr),
        loansGrowth: toNum(raw.loansGrowth ?? raw.loans_growth),
        isCurrent: raw.isCurrent ?? false,
    };
}

interface Props {
    symbol: string;
    industry: string;
    initialPeers?: any;
    initialPeriod?: string | null;
}

const BankingPeerTable = ({ symbol, industry, initialPeers, initialPeriod }: Props) => {
    const [mode, setMode] = useState<Mode>('quarter');
    const [peers, setPeers] = useState<BankPeer[]>([]);
    const [period, setPeriod] = useState<string | null>(initialPeriod ?? null);
    const [medianPe, setMedianPe] = useState<number | null>(null);
    const [loading, setLoading] = useState(!initialPeers);
    const fetchKeyRef = useRef('');

    useEffect(() => {
        if (initialPeers && mode === 'quarter' && peers.length === 0) {
            setPeers((initialPeers.data || []).map(normalizePeer));
            setMedianPe(initialPeers.medianPe ?? null);
            setPeriod(initialPeers.period ?? null);
            setLoading(false);
        }
    }, [initialPeers]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const key = `${symbol}:${mode}`;
        if (fetchKeyRef.current === key) return;
        if (!symbol) return;
        if (mode === 'quarter' && initialPeers && peers.length === 0) return;
        fetchKeyRef.current = key;

        let cancelled = false;
        setLoading(true);
        fetch(`/api/stock/peers-vci/${symbol}?mode=${mode}`)
            .then(r => r.json())
            .then(res => {
                if (cancelled) return;
                if (res?.success) {
                    setPeers((res.data || []).map(normalizePeer));
                    setMedianPe(res.medianPe ?? null);
                    setPeriod(res.period ?? null);
                }
            })
            .catch(err => console.error('BankingPeerTable fetch error:', err))
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [symbol, mode]); // eslint-disable-line react-hooks/exhaustive-deps

    const extremes = useMemo(() => buildExtremes(peers), [peers]);

    return (
        <Card className="p-0 overflow-hidden">
            <div className="p-6 border-b border-tremor-border dark:border-dark-tremor-border bg-tremor-background-muted/50 dark:bg-dark-tremor-background-muted/20">
                <div className="sm:flex sm:items-center sm:justify-between sm:space-x-10">
                    <div>
                        <h3 className="text-lg font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                            So sánh ngành Ngân hàng
                        </h3>
                        <p className="mt-1 text-tremor-default leading-6 text-tremor-content dark:text-dark-tremor-content">
                            {peers.length} ngân hàng · {industry}
                            {period && <span className="ml-2 text-xs font-mono text-tremor-content-subtle">· {period}</span>}
                        </p>
                    </div>
                    <div className="mt-4 sm:mt-0 flex items-center gap-3">
                        {medianPe !== null && (
                            <span className="inline-flex items-center rounded-tremor-small bg-blue-50 px-3 py-1.5 text-tremor-default font-bold text-blue-700 ring-1 ring-inset ring-blue-600/20 dark:bg-blue-400/10 dark:text-blue-400 dark:ring-blue-400/20">
                                Median P/E: {medianPe.toFixed(1)}
                            </span>
                        )}
                        <div className="inline-flex rounded-tremor-small border border-tremor-border dark:border-dark-tremor-border overflow-hidden">
                            <button
                                onClick={() => setMode('quarter')}
                                className={cx(
                                    'px-3 py-1.5 text-sm font-medium transition-colors',
                                    mode === 'quarter'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-white dark:bg-gray-900 text-tremor-content dark:text-dark-tremor-content hover:bg-gray-50 dark:hover:bg-gray-800'
                                )}
                            >
                                Quý
                            </button>
                            <button
                                onClick={() => setMode('year')}
                                className={cx(
                                    'px-3 py-1.5 text-sm font-medium transition-colors border-l border-tremor-border dark:border-dark-tremor-border',
                                    mode === 'year'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-white dark:bg-gray-900 text-tremor-content dark:text-dark-tremor-content hover:bg-gray-50 dark:hover:bg-gray-800'
                                )}
                            >
                                Năm
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center p-12">
                    <div className="spinner" />
                    <span className="ml-3 text-tremor-default text-tremor-content">Đang tải...</span>
                </div>
            ) : (
                <div className="px-4 pb-4">
                    <Table className="h-[450px] [&>table]:border-separate [&>table]:border-spacing-0">
                        <TableHead>
                            <TableRow>
                                {[
                                    'Mã CK', 'Vốn hóa', 'P/E', 'P/B', 'ROE',
                                    'NIM', 'CIR', 'CASA', 'NPL', 'LDR', 'Tăng TD',
                                ].map((label, i) => (
                                    <TableHeaderCell
                                        key={label}
                                        className={cx(
                                            'sticky top-0 z-10 border-b border-tremor-border bg-white text-tremor-content-strong dark:border-dark-tremor-border dark:bg-gray-900 dark:text-dark-tremor-content-strong',
                                            i > 0 ? 'text-right' : ''
                                        )}
                                    >
                                        {label}
                                    </TableHeaderCell>
                                ))}
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {peers.map(peer => {
                                const capVal = toNum(peer.marketCap);
                                const peVal = toNum(peer.pe);
                                const pbVal = toNum(peer.pb);
                                const roeVal = toNum(peer.roe);
                                const nimVal = toNum(peer.nim);
                                const cirRaw = toNum(peer.cir);
                                const cirVal = cirRaw !== null ? Math.abs(cirRaw) : null;
                                const casaVal = toNum(peer.casa);
                                const nplVal = toNum(peer.npl);
                                const ldrVal = toNum(peer.ldr);
                                const loanVal = toNum(peer.loansGrowth);

                                return (
                                    <TableRow
                                        key={peer.symbol}
                                        className={cx(
                                            peer.isCurrent
                                                ? 'bg-blue-50/50 dark:bg-blue-900/10'
                                                : 'hover:bg-gray-50/50 dark:hover:bg-gray-800/20'
                                        )}
                                    >
                                        <TableCell className="border-b border-tremor-border dark:border-dark-tremor-border">
                                            <div className="flex flex-col">
                                                {peer.isCurrent ? (
                                                    <span className="font-bold text-tremor-default text-blue-600 dark:text-blue-400">
                                                        {peer.symbol}
                                                        <span className="ml-2 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full dark:bg-blue-800 dark:text-blue-200 uppercase">Hiện tại</span>
                                                    </span>
                                                ) : (
                                                    <Link
                                                        href={`/stock/${peer.symbol}`}
                                                        className="font-bold text-tremor-default text-tremor-content-strong dark:text-dark-tremor-content-strong hover:text-blue-600 dark:hover:text-blue-400 hover:underline transition-colors"
                                                    >
                                                        {peer.symbol}
                                                    </Link>
                                                )}
                                                <span className="text-xs text-tremor-content-subtle truncate max-w-[150px]">{peer.name}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className={cx('text-right font-bold border-b border-tremor-border dark:border-dark-tremor-border', toneClass(getTone(extremes, 'marketCap', capVal)))}>
                                            {fmtCap(capVal)}
                                        </TableCell>
                                        <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                            <span className={cx('font-medium', toneClass(getTone(extremes, 'pe', peVal)))}>
                                                {peVal !== null && peVal > 0 ? `${peVal.toFixed(1)}×` : '-'}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                            <span className={cx('font-medium', toneClass(getTone(extremes, 'pb', pbVal)))}>
                                                {pbVal !== null && pbVal > 0 ? `${pbVal.toFixed(2)}×` : '-'}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                            <span className={cx('font-medium', toneClass(getTone(extremes, 'roe', roeVal)))}>{fmtPct(roeVal)}</span>
                                        </TableCell>
                                        <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                            <span className={cx('font-medium', toneClass(getTone(extremes, 'nim', nimVal)))}>{fmtPct(nimVal)}</span>
                                        </TableCell>
                                        <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                            <span className={cx('font-medium', toneClass(getTone(extremes, 'cir', cirVal)))}>{fmtPct(cirVal)}</span>
                                        </TableCell>
                                        <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                            <span className={cx('font-medium', toneClass(getTone(extremes, 'casa', casaVal)))}>{fmtPct(casaVal)}</span>
                                        </TableCell>
                                        <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                            <span className={cx('font-medium', toneClass(getTone(extremes, 'npl', nplVal)))}>{fmtPct(nplVal)}</span>
                                        </TableCell>
                                        <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                            <span className={cx('font-medium', toneClass(getTone(extremes, 'ldr', ldrVal)))}>{fmtRatio(ldrVal)}</span>
                                        </TableCell>
                                        <TableCell className="text-right border-b border-tremor-border dark:border-dark-tremor-border">
                                            <span className={cx('font-medium', toneClass(getTone(extremes, 'loansGrowth', loanVal)))}>{fmtPct(loanVal)}</span>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}
        </Card>
    );
};

export default React.memo(BankingPeerTable);
