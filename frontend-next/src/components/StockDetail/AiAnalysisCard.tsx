'use client';

import { useEffect, useState } from 'react';
import { fetchAiAnalysis, AiAnalysisData } from '@/lib/api';

export default function AiAnalysisCard({ symbol }: { symbol: string }) {
    const [data, setData] = useState<AiAnalysisData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchAiAnalysis(symbol).then(d => {
            setData(d);
            setLoading(false);
        });
    }, [symbol]);

    if (loading) {
        return (
            <div className="animate-pulse rounded-xl bg-gray-50 dark:bg-gray-800/50 p-4">
                <div className="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
                <div className="space-y-2">
                    <div className="h-3 w-full bg-gray-200 dark:bg-gray-700 rounded" />
                    <div className="h-3 w-5/6 bg-gray-200 dark:bg-gray-700 rounded" />
                    <div className="h-3 w-4/6 bg-gray-200 dark:bg-gray-700 rounded" />
                </div>
            </div>
        );
    }

    if (!data?.available || !data.analysis_vi) return null;

    return (
        <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-100 dark:border-blue-900/40 p-4">
            <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide">
                        AI Analysis
                    </span>
                    {data.quarter && (
                        <span className="rounded-full bg-blue-100 dark:bg-blue-900/50 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-300">
                            {data.quarter}
                        </span>
                    )}
                </div>
                <span className="text-[10px] text-blue-400 dark:text-blue-500">Gemma 4</span>
            </div>
            <p className="text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">
                {data.analysis_vi}
            </p>
        </div>
    );
}
