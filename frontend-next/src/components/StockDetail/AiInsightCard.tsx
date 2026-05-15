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
    model?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function fmtX(v: number | null | undefined) {
    return v != null ? `${v.toFixed(1)}x` : '—';
}

function fmtPct(v: number | null | undefined) {
    if (v == null) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

function actionColor(a: string | undefined) {
    if (a === 'Mua') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
    if (a === 'Tích lũy') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
    if (a === 'Giảm tỷ trọng') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300';
    return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
}

function assessmentColor(a: string | undefined) {
    if (a === 'rẻ') return 'text-emerald-600 dark:text-emerald-400';
    if (a === 'đắt') return 'text-rose-500 dark:text-rose-400';
    return 'text-amber-600 dark:text-amber-400';
}

function timingColor(t: string | undefined) {
    if (t === 'Ngay bây giờ') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
    if (t === 'Chờ pullback') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
    return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400';
}

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

// ── Component ────────────────────────────────────────────────────────────

export default function AiInsightCard({ analysisJson, newsJson, quarter, model }: AiInsightCardProps) {
    if (!analysisJson && !newsJson) return null;

    let analysis: CombinedAnalysis | null = null;
    let news: NewsThesis | null = null;
    try { if (analysisJson) analysis = JSON.parse(analysisJson); } catch {}
    try { if (newsJson) news = JSON.parse(newsJson); } catch {}
    if (!analysis && !news) return null;

    const rec = analysis?.recommendation;
    const tp = analysis?.target_price;
    const upside = analysis?.upside_pct;
    const tech = analysis?.technical;
    const vt = analysis?.valuation_table;
    const hasBull = (news?.bull_case?.length ?? 0) > 0;
    const hasBear = (news?.bear_case?.length ?? 0) > 0;
    const hasNews = hasBull || hasBear || (news?.key_events?.length ?? 0) > 0 || !!news?.watch_out;
    const badge = sentimentBadge(news?.overall_sentiment);

    const hasZone1 = rec || tp != null || analysis?.valuation_summary;
    const hasZone2 = tech || vt;

    return (
        <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-100 dark:border-blue-900/40 overflow-hidden">

            {/* ── Header ─────────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide">
                        AI Insight
                    </span>
                    {quarter && (
                        <span className="rounded-full bg-blue-100 dark:bg-blue-900/50 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-300">
                            {quarter}
                        </span>
                    )}
                </div>
                {model && <span className="text-[10px] text-blue-400 dark:text-blue-500">Gemma 4</span>}
            </div>

            <div className="divide-y divide-blue-100 dark:divide-blue-900/30">

                {/* ── Zone 1: Recommendation ─────────────────────────── */}
                {hasZone1 && (
                    <div className="px-4 py-3 space-y-2">
                        {/* Action row */}
                        <div className="flex items-center gap-2 flex-wrap">
                            {rec && (
                                <span className={`text-[12px] font-bold rounded-full px-3 py-1 ${actionColor(rec)}`}>
                                    {rec}
                                </span>
                            )}
                            {tp != null && (
                                <span className="text-[14px] font-bold text-gray-800 dark:text-gray-100">
                                    {tp.toLocaleString('vi-VN')}
                                </span>
                            )}
                            {upside != null && (
                                <span className={`text-[13px] font-semibold ${upside >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                                    ({fmtPct(upside)})
                                </span>
                            )}
                            {analysis?.timing && (
                                <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${timingColor(analysis.timing)}`}>
                                    {analysis.timing}
                                </span>
                            )}
                        </div>

                        {/* Summary */}
                        {analysis?.valuation_summary && (
                            <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
                                {analysis.valuation_summary}
                            </p>
                        )}

                        {/* PE / PB assessment badges */}
                        {(analysis?.pe_assessment || analysis?.pb_assessment) && (
                            <div className="flex gap-2 flex-wrap">
                                {analysis?.pe_assessment && (
                                    <span className="text-[11px] rounded-lg bg-white/60 dark:bg-white/5 border border-blue-100/60 dark:border-blue-900/30 px-2 py-1">
                                        <span className="text-gray-500 dark:text-gray-400">P/E </span>
                                        <span className={`font-semibold ${assessmentColor(analysis.pe_assessment)}`}>
                                            {analysis.pe_assessment}
                                        </span>
                                    </span>
                                )}
                                {analysis?.pb_assessment && (
                                    <span className="text-[11px] rounded-lg bg-white/60 dark:bg-white/5 border border-blue-100/60 dark:border-blue-900/30 px-2 py-1">
                                        <span className="text-gray-500 dark:text-gray-400">P/B </span>
                                        <span className={`font-semibold ${assessmentColor(analysis.pb_assessment)}`}>
                                            {analysis.pb_assessment}
                                        </span>
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ── Zone 2: Technical + Valuation table (2-col) ──────── */}
                {hasZone2 && (
                    <div className="px-4 py-3 grid grid-cols-2 gap-4">

                        {/* Left: Technical */}
                        {tech && (
                            <div className="space-y-1.5 min-w-0">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-500 dark:text-blue-400">
                                    Kỹ thuật
                                </p>
                                {tech.signal && (
                                    <p className={`text-[11px] font-semibold ${signalColor(tech.signal)}`}>
                                        {tech.signal}
                                    </p>
                                )}
                                {tech.trend && (
                                    <p className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-400 line-clamp-3">
                                        {tech.trend}
                                    </p>
                                )}
                                <div className="space-y-0.5 text-[11px]">
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

                        {/* Right: Valuation mini-table */}
                        {vt && (
                            <div className="space-y-1.5 min-w-0">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-500 dark:text-blue-400">
                                    Định giá
                                </p>
                                <table className="w-full text-[10px] border-collapse">
                                    <thead>
                                        <tr className="text-gray-400 dark:text-gray-500">
                                            <th className="text-left font-medium pb-1 w-6" />
                                            <th className="text-right font-medium pb-1">TTM</th>
                                            <th className="text-right font-medium pb-1">2yr</th>
                                            <th className="text-right font-medium pb-1">5yr</th>
                                            <th className="text-right font-medium pb-1">Ngành</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td className="text-gray-500 dark:text-gray-400 pr-1 py-0.5">P/E</td>
                                            <td className="text-right font-semibold text-gray-700 dark:text-gray-300 py-0.5">{fmtX(vt.pe_ttm)}</td>
                                            <td className="text-right text-gray-500 dark:text-gray-400 py-0.5">{fmtX(vt.pe_2yr_avg)}</td>
                                            <td className="text-right text-gray-500 dark:text-gray-400 py-0.5">{fmtX(vt.pe_5yr_avg)}</td>
                                            <td className="text-right text-gray-500 dark:text-gray-400 py-0.5">{fmtX(vt.pe_sector)}</td>
                                        </tr>
                                        <tr>
                                            <td className="text-gray-500 dark:text-gray-400 pr-1 py-0.5">P/B</td>
                                            <td className="text-right font-semibold text-gray-700 dark:text-gray-300 py-0.5">{fmtX(vt.pb_ttm)}</td>
                                            <td className="text-right text-gray-500 dark:text-gray-400 py-0.5">{fmtX(vt.pb_2yr_avg)}</td>
                                            <td className="text-right text-gray-500 dark:text-gray-400 py-0.5">{fmtX(vt.pb_5yr_avg)}</td>
                                            <td className="text-right text-gray-500 dark:text-gray-400 py-0.5">{fmtX(vt.pb_sector)}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Zone 3: News Thesis ──────────────────────────────── */}
                {news && hasNews && (
                    <div className="px-4 py-3 space-y-2">
                        {/* Header */}
                        <div className="flex items-center gap-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-500 dark:text-blue-400">
                                News Thesis
                            </p>
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
                                            Bull
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
                                            Bear
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
        </div>
    );
}
