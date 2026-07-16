'use client';

import { useEffect, useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────────

interface CombinedAnalysis {
    valuation_summary?: string;
    pe_assessment?: string;
    pb_assessment?: string;
    model_consensus?: string;
    target_price?: number | null;
    target_rationale?: string;
    recommendation?: string;
    upside_pct?: number | null;
    timing?: string;
    technical?: {
        trend?: string;
        support?: number | null;
        resistance?: number | null;
        signal?: string;
    };
    valuation_table?: {
        pe_ttm?: number | null;
        pe_2yr_avg?: number | null;
        pe_5yr_avg?: number | null;
        pe_sector?: number | null;
        pb_ttm?: number | null;
        pb_2yr_avg?: number | null;
        pb_5yr_avg?: number | null;
        pb_sector?: number | null;
    };
}

interface NewsThesis {
    overall_sentiment?: 'bullish' | 'mixed' | 'bearish';
    summary?: string;
    bull_case?: { point: string; news_ids?: (string | number)[] }[];
    bear_case?: { point: string; news_ids?: (string | number)[] }[];
    key_events?: string[];
    watch_out?: string;
}

interface AiInsightCardProps {
    symbol: string;
    analysisJson?: string | null;
    newsJson?: string | null;
    quarter?: string;
}

interface LiveTechnicalSnapshot {
    rating?: string;
    price?: number | null;
    ema200?: number | null;
    support?: number | null;
    resistance?: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function signalColor(s: string | undefined) {
    if (s === 'Tích cực') return 'text-emerald-600 dark:text-emerald-400';
    if (s === 'Tiêu cực') return 'text-rose-500 dark:text-rose-400';
    return 'text-gray-500 dark:text-gray-400';
}

function sentimentBadge(s: string | undefined) {
    if (s === 'bullish') return { label: 'Tích cực', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' };
    if (s === 'bearish') return { label: 'Tiêu cực', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' };
    return { label: 'Trung lập', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' };
}

function technicalSignal(rating?: string): string {
    const value = rating?.toUpperCase() || '';
    if (value.includes('VERY_GOOD') || value.includes('GOOD') || value.includes('BUY')) return 'Tích cực';
    if (value.includes('VERY_BAD') || value.includes('BAD') || value.includes('SELL')) return 'Tiêu cực';
    return 'Trung tính';
}

function toLiveTechnicalSnapshot(payload: unknown): LiveTechnicalSnapshot | null {
    if (!payload || typeof payload !== 'object') return null;
    const response = payload as {
        success?: boolean;
        fetched_at_utc?: string;
        data?: {
            price?: number | null;
            gaugeSummary?: { rating?: string };
            movingAverages?: { name?: string; value?: number | null }[];
            pivot?: { support1?: number | null; resistance1?: number | null };
        };
    };
    if (!response.success || !response.data) return null;

    const ema200 = response.data.movingAverages?.find((item) => item.name?.toLowerCase() === 'ema200')?.value;
    return {
        rating: response.data.gaugeSummary?.rating,
        price: response.data.price,
        ema200,
        support: response.data.pivot?.support1,
        resistance: response.data.pivot?.resistance1,
    };
}

function liveTrend(snapshot: LiveTechnicalSnapshot): string {
    if (snapshot.price != null && snapshot.ema200 != null) {
        return snapshot.price < snapshot.ema200
            ? 'Giá đang dưới EMA200.'
            : 'Giá đang trên EMA200.';
    }
    return 'Tổng hợp từ trung bình động và dao động.';
}

function formatTechnicalLevel(value: number): string {
    return (Math.round(value / 1_000) * 1_000).toLocaleString('vi-VN');
}

function LiveTechnicalSection({ snapshot }: { snapshot: LiveTechnicalSnapshot }) {
    const signal = technicalSignal(snapshot.rating);

    return (
        <div className="space-y-1.5 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Tín hiệu kỹ thuật</p>
            </div>
            <p className={`text-sm font-semibold ${signalColor(signal)}`}>{signal}</p>
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">{liveTrend(snapshot)}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                {snapshot.support != null && (
                    <p className="text-gray-500 dark:text-gray-400">Hỗ trợ: <strong className="text-emerald-600 dark:text-emerald-400">{formatTechnicalLevel(snapshot.support)}</strong></p>
                )}
                {snapshot.resistance != null && (
                    <p className="text-gray-500 dark:text-gray-400">Kháng cự: <strong className="text-rose-500 dark:text-rose-400">{formatTechnicalLevel(snapshot.resistance)}</strong></p>
                )}
            </div>
        </div>
    );
}

// ── Component ────────────────────────────────────────────────────────────

export default function AiInsightCard({ symbol, analysisJson, newsJson, quarter }: AiInsightCardProps) {
    const [liveTechnical, setLiveTechnical] = useState<LiveTechnicalSnapshot | null>(null);

    useEffect(() => {
        if (!symbol) return;

        const controller = new AbortController();
        const loadTechnical = async () => {
            try {
                const response = await fetch(`/api/stock/${symbol}/technical/ONE_DAY`, { signal: controller.signal });
                if (!response.ok) return;
                const next = toLiveTechnicalSnapshot(await response.json());
                if (next) setLiveTechnical(next);
            } catch (error) {
                if ((error as Error).name !== 'AbortError') setLiveTechnical(null);
            }
        };

        void loadTechnical();
        const refreshId = window.setInterval(loadTechnical, 60_000);
        return () => {
            controller.abort();
            window.clearInterval(refreshId);
        };
    }, [symbol]);

    let analysis: CombinedAnalysis | null = null;
    let news: NewsThesis | null = null;
    try { if (analysisJson) analysis = JSON.parse(analysisJson); } catch {}
    try { if (newsJson) news = JSON.parse(newsJson); } catch {}

    if (!analysis && !news) {
        return (
            <section className="flex h-full min-h-[260px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900" aria-labelledby="ai-insight-title">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                    <span id="ai-insight-title" className="text-base font-semibold text-slate-800 dark:text-slate-100">Phân tích tin tức AI</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">Đang cập nhật</span>
                </div>
                {liveTechnical && <LiveTechnicalSection snapshot={liveTechnical} />}
                <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-lg dark:bg-blue-950/40">✦</div>
                    <h3 className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">Phân tích tin tức đang được chuẩn bị</h3>
                    <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">AI sẽ tóm tắt các tin tức mới thành yếu tố tích cực, rủi ro và điểm cần theo dõi.</p>
                </div>
                <p className="border-t border-slate-100 px-4 py-2 text-xs leading-relaxed text-slate-400 dark:border-slate-800 dark:text-slate-500">Nội dung mang tính tham khảo, không phải khuyến nghị đầu tư.</p>
            </section>
        );
    }

    const hasBull = (news?.bull_case?.length ?? 0) > 0;
    const hasBear = (news?.bear_case?.length ?? 0) > 0;
    // A rule-based analysis deliberately stores an empty-news sentinel with only
    // a generic summary/watch-out. It is not a real news thesis and should not
    // be presented as one.
    const hasNews = hasBull || hasBear || (news?.key_events?.length ?? 0) > 0;
    const badge = sentimentBadge(news?.overall_sentiment);

    return (
        <section className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900" aria-labelledby="ai-insight-title">

            {/* ── Header ─────────────────────────────────────────────── */}
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <div className="flex items-center gap-1.5">
                    <span id="ai-insight-title" className="text-base font-semibold text-slate-800 dark:text-slate-100">
                        Phân tích tin tức AI
                    </span>
                    {quarter && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {quarter}
                        </span>
                    )}
                </div>
            </div>

            <div className="flex-1 divide-y divide-slate-100 dark:divide-slate-800">

                {/* Live snapshot from the same source as the Technical tab; never generated by AI. */}
                {liveTechnical && <LiveTechnicalSection snapshot={liveTechnical} />}

                {/* ── Zone 2: News Thesis ──────────────────────────────── */}
                {news && hasNews && (
                    <div className="px-4 py-3 space-y-2">
                        {/* Header */}
                        <div className="flex items-center gap-2">
                            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Luận điểm từ tin tức</p>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.cls}`}>
                                {badge.label}
                            </span>
                        </div>

                        {news.summary && (
                            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                                {news.summary}
                            </p>
                        )}

                        {/* Bull / Bear grid */}
                        {(hasBull || hasBear) && (
                            <div className="grid grid-cols-2 gap-2">
                                {hasBull && (
                                    <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 p-2 space-y-1">
                                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                                            Hỗ trợ
                                        </span>
                                        {news.bull_case!.slice(0, 3).map((item, i) => (
                                            <div key={i} className="flex gap-1">
                                                <span className="text-emerald-500 text-[9px] mt-0.5 shrink-0">▸</span>
                                                <p className="text-xs leading-relaxed text-gray-700 dark:text-gray-300">
                                                    {item.point}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {hasBear && (
                                    <div className="rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 p-2 space-y-1">
                                        <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-900/50 dark:text-rose-400">
                                            Rủi ro
                                        </span>
                                        {news.bear_case!.slice(0, 3).map((item, i) => (
                                            <div key={i} className="flex gap-1">
                                                <span className="text-rose-400 text-[9px] mt-0.5 shrink-0">▸</span>
                                                <p className="text-xs leading-relaxed text-gray-700 dark:text-gray-300">
                                                    {item.point}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Key events */}
                        {news.key_events && news.key_events.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                                {news.key_events.map((e, i) => (
                                    <span key={i} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                        {e}
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Watch out */}
                        {news.watch_out && (
                            <div className="flex gap-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30 px-3 py-1.5">
                                <span className="text-amber-500 shrink-0 text-[11px] mt-0.5">⚠</span>
                                <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                                    {news.watch_out}
                                </p>
                            </div>
                        )}
                    </div>
                )}

            </div>
            <p className="border-t border-slate-100 px-4 py-2 text-xs leading-relaxed text-slate-400 dark:border-slate-800 dark:text-slate-500">
                Nội dung mang tính tham khảo, không phải khuyến nghị đầu tư.
            </p>
        </section>
    );
}
