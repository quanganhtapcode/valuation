'use client';

import { Card } from '@tremor/react';
import { cx } from '@/lib/utils';
import React, { useState, useEffect } from 'react';
import { RiHistoryLine } from '@remixicon/react';
import IndexHistoryModal from './IndexHistoryModal';

interface IndexCardProps {
    id: string;
    name: string;
    value: number;
    change: number;
    percentChange: number;
    chartData?: number[];
    advances?: number;
    declines?: number;
    noChanges?: number;
    ceilings?: number;
    floors?: number;
    totalShares?: number;
    totalValue?: number;
    isLoading?: boolean;
}

type BreadthDirection = 'up' | 'unchanged' | 'down';

function breadthIconUrls(direction: BreadthDirection): { light: string; dark: string } {
    const base = 'https://trading.vietcap.com.vn/vietcap-priceboard/images';
    if (direction === 'up') {
        return {
            light: `${base}/light/arrow-top-right.svg`,
            dark: `${base}/dark/arrow-top-right.svg`,
        };
    }
    if (direction === 'down') {
        return {
            light: `${base}/light/arrow-bottom-left.svg`,
            dark: `${base}/dark/arrow-bottom-left.svg`,
        };
    }
    return {
        light: `${base}/light/unchanged.svg`,
        dark: `${base}/dark/unchanged.svg`,
    };
}

function BreadthIcon({ direction, alt }: { direction: BreadthDirection; alt: string }) {
    const icon = breadthIconUrls(direction);
    return (
        <span className="inline-flex items-center mr-1">
            <img src={icon.light} alt={alt} className="block dark:hidden w-3 h-3" loading="lazy" decoding="async" />
            <img src={icon.dark} alt={alt} className="hidden dark:block w-3 h-3" loading="lazy" decoding="async" />
        </span>
    );
}

function formatShares(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + ' Tr';
    if (n >= 1_000) return (n / 1_000).toFixed(0) + ' N';
    return n.toString();
}

function formatValue(n: number): string {
    // API returns value in unit that when divided by 1000 gives Tỷ
    // e.g. 460960.81 → 460.96 Tỷ
    const ty = n / 1000;
    if (ty >= 1000) return (ty / 1000).toFixed(2) + ' Nghìn Tỷ';
    return ty.toFixed(2) + ' Tỷ';
}

export default React.memo(function IndexCard({
    id,
    name,
    value,
    change,
    percentChange,
    chartData = [],
    advances = 0,
    declines = 0,
    noChanges = 0,
    ceilings = 0,
    floors = 0,
    totalShares = 0,
    totalValue = 0,
    isLoading = false,
}: IndexCardProps) {
    const isUp = change >= 0;
    const changeType = isUp ? 'positive' : 'negative';
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [marketStatus, setMarketStatus] = useState({ text: 'Đang tải...', color: 'text-tremor-content-subtle', dotColor: 'text-tremor-content-subtle', animate: false });

    useEffect(() => {
        const updateStatus = () => {
            const now = new Date();
            const vnTimeString = now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" });
            const vnTime = new Date(vnTimeString);
            const day = vnTime.getDay();
            const hours = vnTime.getHours();
            const minutes = vnTime.getMinutes();
            const timeNum = hours * 100 + minutes;

            if (day >= 1 && day <= 5) {
                if (timeNum >= 845 && timeNum <= 900) { setMarketStatus({ text: 'ATO', color: 'text-amber-500 font-medium', dotColor: 'text-amber-500', animate: true }); return; }
                if (timeNum > 900 && timeNum < 1130) { setMarketStatus({ text: 'Đang giao dịch', color: 'text-emerald-500 font-medium', dotColor: 'text-emerald-500', animate: true }); return; }
                if (timeNum >= 1130 && timeNum <= 1300) { setMarketStatus({ text: 'Nghỉ trưa', color: 'text-amber-500 font-medium', dotColor: 'text-amber-500', animate: false }); return; }
                if (timeNum > 1300 && timeNum < 1430) { setMarketStatus({ text: 'Đang giao dịch', color: 'text-emerald-500 font-medium', dotColor: 'text-emerald-500', animate: true }); return; }
                if (timeNum >= 1430 && timeNum <= 1445) { setMarketStatus({ text: 'ATC', color: 'text-violet-500 font-medium', dotColor: 'text-violet-500', animate: true }); return; }
                if (timeNum > 1445 && timeNum <= 1500) { setMarketStatus({ text: 'Đóng cửa (TT)', color: 'text-tremor-content-subtle', dotColor: 'text-tremor-content-subtle', animate: false }); return; }
            }
            setMarketStatus({ text: 'Đóng cửa', color: 'text-tremor-content-subtle', dotColor: 'text-tremor-content-subtle', animate: false });
        };

        updateStatus();
        const interval = setInterval(updateStatus, 60000);
        return () => clearInterval(interval);
    }, []);

    if (isLoading) {
        return (
            <Card className="p-3 md:p-4">
                <div className="animate-pulse">
                    {/* Header row: name visible immediately + price placeholder */}
                    <div className="flex items-start justify-between gap-2">
                        <span className="text-xs md:text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                            {name || <span className="block h-4 w-24 rounded bg-tremor-background-muted" />}
                        </span>
                        <div className="h-5 w-20 rounded bg-tremor-background-muted" />
                    </div>
                    {/* Subtitle row */}
                    <div className="mt-1 flex items-center justify-between">
                        <div className="h-3 w-16 rounded bg-tremor-background-muted/60" />
                        <div className="h-3 w-24 rounded bg-tremor-background-muted/60" />
                    </div>
                    {/* KL/GT row */}
                    <div className="mt-2 h-3 w-40 rounded bg-tremor-background-muted/60" />
                    {/* Breadth row */}
                    <div className="mt-3 border-t border-tremor-border dark:border-dark-tremor-border pt-2">
                        <div className="h-4 w-36 rounded bg-tremor-background-muted/60" />
                    </div>
                </div>
            </Card>
        );
    }

    return (
        <>
            <Card
                className="group p-3 md:p-4 cursor-pointer hover:bg-tremor-background-subtle dark:hover:bg-dark-tremor-background-muted transition-colors"
                onClick={() => setIsModalOpen(true)}
            >
                {/* Header: name + price */}
                <div className="flex items-start justify-between gap-2">
                    <dt className="text-xs md:text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong truncate flex items-center gap-1.5 group-hover:text-tremor-brand transition-colors">
                        {name}
                        <RiHistoryLine className="w-3.5 h-3.5 text-tremor-content-subtle group-hover:text-tremor-brand" />
                    </dt>
                    <dd
                        className={cx(
                            'font-bold tracking-tight text-sm md:text-base whitespace-nowrap',
                            changeType === 'positive' ? 'text-emerald-500' : 'text-red-500',
                        )}
                    >
                        {value.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </dd>
                </div>

                {/* Subtitle: Market Status + change */}
                <div className="mt-0.5 flex items-center justify-between">
                    <span className={cx("text-[10px] md:text-xs flex items-center gap-1", marketStatus.color)}>
                        <span className={cx("text-[8px] md:text-[10px]", marketStatus.dotColor, marketStatus.animate && "animate-pulse")}>●</span> {marketStatus.text}
                    </span>
                    <dd className={cx(
                        'text-[11px] md:text-xs font-medium',
                        changeType === 'positive' ? 'text-emerald-500' : 'text-red-500'
                    )}>
                        {isUp ? '+' : ''}{change.toFixed(2)}({isUp ? '+' : ''}{percentChange.toFixed(2)}%)
                    </dd>
                </div>

                {/* KL & GT + Breadth (Compact) */}
                <div className="mt-2 pt-2 border-t border-tremor-border dark:border-dark-tremor-border">
                    {/* KL & GT */}
                    {(totalShares > 0 || totalValue > 0) && (
                        <div className="text-[11px] text-tremor-content-subtle dark:text-dark-tremor-content-subtle font-medium">
                            <span className="text-tremor-content dark:text-dark-tremor-content">KL: {totalShares.toLocaleString('en-US')}</span>
                            <span className="mx-1.5">•</span>
                            <span className="text-tremor-content dark:text-dark-tremor-content">GT: {formatValue(totalValue)}</span>
                        </div>
                    )}

                    {/* Breadth: Tăng(Trần) ◾ Đứng ↙ Giảm(Sàn) */}
                    <div className="mt-1 flex items-center text-[11px] font-bold gap-3">
                        <div className="flex items-center text-emerald-500">
                            <BreadthIcon direction="up" alt="Tăng" />
                            {advances}
                            <span className="text-violet-500 ml-0.5">({ceilings})</span>
                        </div>
                        <div className="flex items-center text-amber-500">
                            <BreadthIcon direction="unchanged" alt="Đứng giá" />
                            {noChanges}
                        </div>
                        <div className="flex items-center text-red-500">
                            <BreadthIcon direction="down" alt="Giảm" />
                            {declines}
                            <span className="text-cyan-500 ml-0.5">({floors})</span>
                        </div>
                    </div>
                </div>
            </Card>

            {isModalOpen && (
                <IndexHistoryModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    indexId={id}
                    indexName={name}
                />
            )}
        </>
    );
});
