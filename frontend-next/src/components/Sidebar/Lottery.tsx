'use client';

import { useState, useEffect } from 'react';
import { Card } from '@tremor/react';
import { fetchLottery, LotteryResult } from '@/lib/api';

const REGIONS = [
    { key: 'mb', label: 'Bắc' },
    { key: 'mt', label: 'Trung' },
    { key: 'mn', label: 'Nam' },
] as const;

const prizeLabels: Record<string, string> = {
    'DB': 'G.ĐB', 'G1': 'G.1', 'G2': 'G.2', 'G3': 'G.3',
    'G4': 'G.4', 'G5': 'G.5', 'G6': 'G.6', 'G7': 'G.7', 'G8': 'G.8',
};

const NORTHERN_PRIZES = ['DB', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'];
const SOUTHERN_PRIZES = ['DB', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8'];

export default function Lottery() {
    const [region, setRegion] = useState<'mb' | 'mn' | 'mt'>('mb');
    const [data, setData] = useState<LotteryResult | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [provIndex, setProvIndex] = useState(0);

    useEffect(() => {
        setProvIndex(0);
        setIsLoading(true);
        fetchLottery(region)
            .then(setData)
            .catch(console.error)
            .finally(() => setIsLoading(false));
    }, [region]);

    return (
        <Card className="mt-4 p-0 overflow-hidden bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm rounded-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-2">
                    <span className="text-xl">🎰</span>
                    <span className="text-base font-bold text-gray-900 dark:text-gray-100">Xổ Số</span>
                </div>
                {data?.pubDate && (
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 italic">{data.pubDate}</span>
                )}
            </div>

            {/* Region tabs */}
            <div className="px-5 pb-3">
                <div className="flex gap-1.5">
                    {REGIONS.map((r) => (
                        <button
                            key={r.key}
                            onClick={() => setRegion(r.key as 'mb' | 'mn' | 'mt')}
                            className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                                region === r.key
                                    ? 'bg-rose-500 text-white shadow-sm'
                                    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                            }`}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="pb-2">
                {isLoading ? (
                    <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-rose-200 border-t-rose-500" />
                    </div>
                ) : !data ? (
                    <p className="text-center py-6 text-xs text-gray-400 italic px-5">Không tìm thấy kết quả</p>
                ) : (
                    <>
                        {/* Northern (MB) */}
                        {region === 'mb' && data.results && (
                            <div className="flex flex-col px-5">
                                {NORTHERN_PRIZES.map((key) => {
                                    const prizes = data.results[key as keyof typeof data.results];
                                    if (!prizes || !Array.isArray(prizes)) return null;
                                    const isDB = key === 'DB';
                                    return (
                                        <div
                                            key={key}
                                            className={`flex items-center gap-3 py-2.5 border-b border-gray-50 dark:border-gray-800/50 last:border-0 ${
                                                isDB ? '-mx-5 px-5 bg-rose-50/60 dark:bg-rose-500/5' : ''
                                            }`}
                                        >
                                            <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
                                                <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400">
                                                    {prizeLabels[key]}
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap gap-x-2 gap-y-0.5 flex-1">
                                                {prizes.map((p, i) => (
                                                    <span
                                                        key={i}
                                                        className={`font-bold tabular-nums ${
                                                            isDB
                                                                ? 'text-[18px] text-rose-500'
                                                                : 'text-[13px] text-gray-700 dark:text-gray-200'
                                                        }`}
                                                    >
                                                        {typeof p === 'string' ? p : String(p)}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Central / Southern (MT/MN) */}
                        {(region === 'mn' || region === 'mt') && data.results?.provinces && (
                            <div>
                                {data.results.provinces.length > 1 && (
                                    <div className="flex gap-1.5 overflow-x-auto px-5 pb-3 no-scrollbar">
                                        {data.results.provinces.map((prov, i) => (
                                            <button
                                                key={i}
                                                onClick={() => setProvIndex(i)}
                                                className={`shrink-0 px-3 py-1 text-[11px] font-semibold rounded-lg transition-all ${
                                                    provIndex === i
                                                        ? 'bg-rose-500 text-white'
                                                        : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                                                }`}
                                            >
                                                {prov.name}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {data.results.provinces[provIndex] && (
                                    <div className="flex flex-col px-5">
                                        {SOUTHERN_PRIZES.map((key) => {
                                            const prizes = data.results.provinces![provIndex].prizes[key];
                                            if (!prizes?.length) return null;
                                            const isDB = key === 'DB';
                                            return (
                                                <div
                                                    key={key}
                                                    className={`flex items-center gap-3 py-2.5 border-b border-gray-50 dark:border-gray-800/50 last:border-0 ${
                                                        isDB ? '-mx-5 px-5 bg-rose-50/60 dark:bg-rose-500/5' : ''
                                                    }`}
                                                >
                                                    <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
                                                        <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400">
                                                            {prizeLabels[key]}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 flex-1">
                                                        {prizes.map((p, i) => (
                                                            <span
                                                                key={i}
                                                                className={`font-bold tabular-nums ${
                                                                    isDB
                                                                        ? 'text-[18px] text-rose-500'
                                                                        : 'text-[13px] text-gray-700 dark:text-gray-200'
                                                                }`}
                                                            >
                                                                {p}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </Card>
    );
}
