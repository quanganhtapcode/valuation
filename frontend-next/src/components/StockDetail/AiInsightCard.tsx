'use client';

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
    analysisJson?: string | null;
    newsJson?: string | null;
    quarter?: string;
    generatedAt?: string;
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

function formatGeneratedAt(value?: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(date);
}

// ── Component ────────────────────────────────────────────────────────────

export default function AiInsightCard({ analysisJson, newsJson, quarter, generatedAt }: AiInsightCardProps) {
    if (!analysisJson && !newsJson) return null;

    let analysis: CombinedAnalysis | null = null;
    let news: NewsThesis | null = null;
    try { if (analysisJson) analysis = JSON.parse(analysisJson); } catch {}
    try { if (newsJson) news = JSON.parse(newsJson); } catch {}
    if (!analysis && !news) return null;

    const tech = analysis?.technical;
    const hasBull = (news?.bull_case?.length ?? 0) > 0;
    const hasBear = (news?.bear_case?.length ?? 0) > 0;
    const hasNews = hasBull || hasBear || (news?.key_events?.length ?? 0) > 0 || !!news?.watch_out;
    const badge = sentimentBadge(news?.overall_sentiment);
    const generatedLabel = formatGeneratedAt(generatedAt);

    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900" aria-labelledby="ai-insight-title">

            {/* ── Header ─────────────────────────────────────────────── */}
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <div className="flex items-center gap-1.5">
                    <span id="ai-insight-title" className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                        Phân tích AI
                    </span>
                    {quarter && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {quarter}
                        </span>
                    )}
                </div>
                {generatedLabel && <span className="text-[10px] text-slate-400 dark:text-slate-500">Cập nhật {generatedLabel}</span>}
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800">

                {/* ── Zone 1: Current technical read ───────────────────── */}
                {tech && (
                    <div className="px-4 py-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Tín hiệu kỹ thuật</p>
                            {analysis?.timing && <span className="text-[10px] text-slate-400 dark:text-slate-500">{analysis.timing}</span>}
                        </div>
                        {tech.signal && (
                            <p className={`text-[11px] font-semibold ${signalColor(tech.signal)}`}>
                                {tech.signal}
                            </p>
                        )}
                        {tech.trend && (
                            <p className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
                                {tech.trend}
                            </p>
                        )}
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                            {tech.support != null && (
                                <p className="text-gray-500 dark:text-gray-400">
                                    Hỗ trợ:{' '}
                                    <strong className="text-emerald-600 dark:text-emerald-400">
                                        {tech.support.toLocaleString('vi-VN')}
                                    </strong>
                                </p>
                            )}
                            {tech.resistance != null && (
                                <p className="text-gray-500 dark:text-gray-400">
                                    Kháng cự:{' '}
                                    <strong className="text-rose-500 dark:text-rose-400">
                                        {tech.resistance.toLocaleString('vi-VN')}
                                    </strong>
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Zone 2: News Thesis ──────────────────────────────── */}
                {news && hasNews && (
                    <div className="px-4 py-3 space-y-2">
                        {/* Header */}
                        <div className="flex items-center gap-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Luận điểm từ tin tức</p>
                            <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${badge.cls}`}>
                                {badge.label}
                            </span>
                        </div>

                        {news.summary && (
                            <p className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
                                {news.summary}
                            </p>
                        )}

                        {/* Bull / Bear grid */}
                        {(hasBull || hasBear) && (
                            <div className="grid grid-cols-2 gap-2">
                                {hasBull && (
                                    <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 p-2 space-y-1">
                                        <span className="text-[9px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/50 rounded px-1.5 py-0.5">
                                            Hỗ trợ
                                        </span>
                                        {news.bull_case!.slice(0, 3).map((item, i) => (
                                            <div key={i} className="flex gap-1">
                                                <span className="text-emerald-500 text-[9px] mt-0.5 shrink-0">▸</span>
                                                <p className="text-[10px] leading-relaxed text-gray-700 dark:text-gray-300">
                                                    {item.point}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {hasBear && (
                                    <div className="rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 p-2 space-y-1">
                                        <span className="text-[9px] font-bold text-rose-700 dark:text-rose-400 bg-rose-100 dark:bg-rose-900/50 rounded px-1.5 py-0.5">
                                            Rủi ro
                                        </span>
                                        {news.bear_case!.slice(0, 3).map((item, i) => (
                                            <div key={i} className="flex gap-1">
                                                <span className="text-rose-400 text-[9px] mt-0.5 shrink-0">▸</span>
                                                <p className="text-[10px] leading-relaxed text-gray-700 dark:text-gray-300">
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
                                    <span key={i} className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-full px-2 py-0.5">
                                        {e}
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Watch out */}
                        {news.watch_out && (
                            <div className="flex gap-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30 px-3 py-1.5">
                                <span className="text-amber-500 shrink-0 text-[11px] mt-0.5">⚠</span>
                                <p className="text-[10px] leading-relaxed text-amber-800 dark:text-amber-300">
                                    {news.watch_out}
                                </p>
                            </div>
                        )}
                    </div>
                )}

            </div>
            <p className="border-t border-slate-100 px-4 py-2 text-[10px] leading-relaxed text-slate-400 dark:border-slate-800 dark:text-slate-500">
                Nội dung mang tính tham khảo, không phải khuyến nghị đầu tư.
            </p>
        </section>
    );
}
