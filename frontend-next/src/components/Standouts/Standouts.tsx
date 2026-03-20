'use client';

import React from 'react';
import { Card, Title } from '@tremor/react';
import { cx } from '@/lib/utils';
import { RiFlashlightLine, RiArrowRightUpLine } from '@remixicon/react';
import Link from 'next/link';

interface StandoutsProps {
    data: any[];
    isLoading: boolean;
}

function formatPrice(num: number): string {
    if (!num) return '-';
    return (num / 1000).toFixed(2);
}

function formatLargeNum(num: number): string {
    if (!num) return '-';
    if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toFixed(0);
}

function StockCardSkeleton() {
    return (
        <div className="rounded-xl border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-4 animate-pulse">
            <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-tremor-background-muted flex-shrink-0" />
                <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 bg-tremor-background-muted rounded" />
                    <div className="h-3 w-20 bg-tremor-background-muted/60 rounded" />
                </div>
                <div className="text-right space-y-2">
                    <div className="h-4 w-16 bg-tremor-background-muted rounded" />
                    <div className="h-5 w-14 bg-tremor-background-muted rounded" />
                </div>
            </div>
            <div className="h-16 bg-tremor-background-muted/40 rounded-lg mb-3" />
            <div className="grid grid-cols-2 gap-1.5">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className="flex justify-between">
                        <div className="h-3 w-16 bg-tremor-background-muted/60 rounded" />
                        <div className="h-3 w-12 bg-tremor-background-muted rounded" />
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function Standouts({ data, isLoading }: StandoutsProps) {
    if (isLoading) {
        return (
            <Card className="mt-6 p-4">
                <div className="flex items-center gap-2 mb-4">
                    <div className="h-5 w-5 rounded bg-tremor-background-muted" />
                    <div className="h-5 w-28 bg-tremor-background-muted rounded" />
                </div>
                <div className="space-y-3">
                    {[1, 2, 3].map(i => <StockCardSkeleton key={i} />)}
                </div>
            </Card>
        );
    }

    if (!data || data.length === 0) return null;

    return (
        <Card className="mt-6 p-4">
            {/* Header */}
            <Title className="mb-4 text-tremor-content-strong dark:text-dark-tremor-content-strong flex items-center gap-2">
                <RiFlashlightLine className="text-amber-400 w-5 h-5" />
                Standouts
                <span className="ml-auto text-xs font-normal text-emerald-500">↑ Positive AI Picks</span>
            </Title>

            {/* Cards */}
            <div className="space-y-3">
                {data.map((stock) => {
                    const isUp = stock.dailyPriceChangePercent > 0;
                    const isDown = stock.dailyPriceChangePercent < 0;
                    const pct = stock.dailyPriceChangePercent ?? 0;
                    const hasLogo = !!stock.logo;

                    return (
                        <Link key={stock.ticker} href={`/stock/${stock.ticker}`} className="block group">
                            <div className="rounded-xl border border-tremor-border dark:border-dark-tremor-border bg-tremor-background dark:bg-dark-tremor-background p-4 hover:border-emerald-400 dark:hover:border-emerald-500 hover:shadow-sm transition-all duration-200">
                                {/* Top: logo + name + price */}
                                <div className="flex items-start gap-3 mb-3">
                                    {/* Logo / Badge */}
                                    {hasLogo ? (
                                        <img
                                            src={stock.logo}
                                            alt={stock.ticker}
                                            className="w-10 h-10 rounded-lg object-contain bg-white flex-shrink-0 border border-tremor-border dark:border-dark-tremor-border"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
                                            }}
                                        />
                                    ) : (
                                        <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-xs flex-shrink-0">
                                            {stock.ticker.slice(0, 3)}
                                        </div>
                                    )}

                                    {/* Name + exchange */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong truncate" title={stock.viOrganName || stock.enOrganName}>
                                            {stock.viOrganShortName || stock.viOrganName || stock.enOrganShortName || stock.enOrganName}
                                        </p>
                                        <p className="text-xs text-tremor-content-subtle">
                                            {stock.ticker} · {stock.exchange}
                                        </p>
                                    </div>

                                    {/* Price + change */}
                                    <div className="text-right flex-shrink-0">
                                        <p className="text-sm font-bold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                            {formatPrice(stock.marketPrice)}
                                        </p>
                                        <span className={cx(
                                            "inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-md mt-0.5",
                                            isUp
                                                ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
                                                : isDown
                                                    ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
                                                    : "bg-tremor-background-muted text-tremor-content-subtle"
                                        )}>
                                            {isUp ? '↑' : isDown ? '↓' : '→'} {Math.abs(pct).toFixed(2)}%
                                        </span>
                                    </div>
                                </div>

                                {/* Stats grid */}
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs border-t border-tremor-border/60 dark:border-dark-tremor-border/60 pt-3">
                                    <div className="flex justify-between">
                                        <span className="text-tremor-content-subtle">Volume</span>
                                        <span className="font-medium text-tremor-content dark:text-dark-tremor-content">
                                            {formatLargeNum(stock.accumulatedVolume)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-tremor-content-subtle">Mkt Cap</span>
                                        <span className="font-medium text-tremor-content dark:text-dark-tremor-content">
                                            {formatLargeNum(stock.marketCap)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-tremor-content-subtle">P/E</span>
                                        <span className="font-medium text-tremor-content dark:text-dark-tremor-content">
                                            {stock.ttmPe ? stock.ttmPe.toFixed(2) : '-'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-tremor-content-subtle">AI Score</span>
                                        <span className="font-semibold text-emerald-500">
                                            ⚡ {stock.stockStrength?.toFixed(2) ?? '-'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </Link>
                    );
                })}
            </div>
        </Card>
    );
}
