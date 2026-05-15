'use client';

import { useEffect, useState } from 'react';
import { fetchAiAnalysis, AiAnalysisData } from '@/lib/api';

// ── Type definitions ─────────────────────────────────────────────────────

/** Schema from build_combined_prompt (current backend) */
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
        pe_commentary?: string;
        pb_commentary?: string;
    };
}

/** Schema from build_financial_prompt (7-section, future) */
interface RichAnalysis {
    summary?: string;
    technical?: { trend?: string; support?: number | null; resistance?: number | null };
    recommendation?: { action?: string; target_price?: number | null; upside_pct?: number | null };
    growth_table?: { period: string; revenue_growth?: number | null; profit_growth?: number | null; is_forecast?: boolean }[];
    valuation?: {
        pe_ttm?: number | null; pb_ttm?: number | null;
        pe_2yr_avg?: number | null; pb_2yr_avg?: number | null;
        pe_5yr_avg?: number | null; pb_5yr_avg?: number | null;
        pe_sector?: number | null; pb_sector?: number | null;
        pe_commentary?: string; pb_commentary?: string;
    };
    risks?: string[];
    analysis?: string;
    long_term?: { eps_cagr_3yr?: number | null; eps_cagr_label?: string; roe_avg?: number | null; roe_label?: string; dividend_yield_avg?: number | null; dividend_yield_label?: string };
    key_issues?: { issue: string; positive_view: string; negative_view: string }[];
}

type ParsedAnalysis = CombinedAnalysis & RichAnalysis;

// ── Helpers ──────────────────────────────────────────────────────────────

function fmtPct(v: number | null | undefined) {
    if (v == null) return '—';
    const sign = v >= 0 ? '+' : '';
    return `${sign}${v.toFixed(1)}%`;
}

function fmtX(v: number | null | undefined) {
    if (v == null) return '—';
    return `${v.toFixed(1)}x`;
}

function actionColor(action: string | undefined) {
    if (!action) return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
    if (action === 'Mua') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
    if (action === 'Tích lũy') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
    if (action === 'Giảm tỷ trọng') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300';
    return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
}

function assessmentColor(v: string | undefined) {
    if (v === 'rẻ') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
    if (v === 'đắt') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300';
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
}

function timingColor(v: string | undefined) {
    if (v === 'Ngay bây giờ') return 'text-emerald-600 dark:text-emerald-400';
    if (v === 'Chờ pullback') return 'text-amber-600 dark:text-amber-400';
    return 'text-gray-500 dark:text-gray-400';
}

// ── Sub-components ───────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-blue-500 dark:text-blue-400 mb-1.5">
            {children}
        </h4>
    );
}

function ValuationGrid({ v }: { v: NonNullable<CombinedAnalysis['valuation_table']> }) {
    const rows = [
        { label: 'P/E', val: fmtX(v.pe_ttm), avg2: fmtX(v.pe_2yr_avg), avg5: fmtX(v.pe_5yr_avg), sector: fmtX(v.pe_sector), note: v.pe_commentary },
        { label: 'P/B', val: fmtX(v.pb_ttm), avg2: fmtX(v.pb_2yr_avg), avg5: fmtX(v.pb_5yr_avg), sector: fmtX(v.pb_sector), note: v.pb_commentary },
    ];
    return (
        <div className="space-y-2">
            {rows.map(r => (
                <div key={r.label} className="rounded-lg bg-white/50 dark:bg-white/5 border border-blue-100/60 dark:border-blue-900/30 p-2.5">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">{r.label} TTM</span>
                        <span className="text-[13px] font-bold text-blue-700 dark:text-blue-300">{r.val}</span>
                    </div>
                    <div className="flex gap-3 text-[10px] text-gray-500 dark:text-gray-400">
                        <span>TB 2 năm: <strong>{r.avg2}</strong></span>
                        <span>TB 5 năm: <strong>{r.avg5}</strong></span>
                        <span>Ngành: <strong>{r.sector}</strong></span>
                    </div>
                    {r.note && <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">{r.note}</p>}
                </div>
            ))}
        </div>
    );
}

function GrowthTable({ rows }: { rows: NonNullable<RichAnalysis['growth_table']> }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
                <thead>
                    <tr className="text-gray-400 dark:text-gray-500">
                        <th className="text-left pb-1 pr-3 font-medium">Kỳ</th>
                        <th className="text-right pb-1 pr-3 font-medium">Tăng trưởng DT</th>
                        <th className="text-right pb-1 font-medium">Tăng trưởng LNST</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={i} className={r.is_forecast ? 'text-gray-400 dark:text-gray-500 italic' : 'text-gray-700 dark:text-gray-300'}>
                            <td className="py-0.5 pr-3 font-medium">
                                {r.period}
                                {r.is_forecast && <span className="ml-1 text-[9px] not-italic bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded px-1">F</span>}
                            </td>
                            <td className={`py-0.5 pr-3 text-right ${r.revenue_growth != null && r.revenue_growth >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                                {fmtPct(r.revenue_growth)}
                            </td>
                            <td className={`py-0.5 text-right ${r.profit_growth != null && r.profit_growth >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                                {fmtPct(r.profit_growth)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ── Combined schema renderer ─────────────────────────────────────────────

function CombinedCard({ p }: { p: CombinedAnalysis }) {
    const tech = p.technical;
    const vt = p.valuation_table;
    const recAction = p.recommendation;
    const tp = p.target_price;
    const upside = p.upside_pct;

    return (
        <>
            {/* Summary */}
            {p.valuation_summary && (
                <p className="text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">
                    {p.valuation_summary}
                </p>
            )}

            {/* Recommendation + Assessment */}
            {(recAction || tp != null) && (
                <div>
                    <SectionTitle>Khuyến nghị</SectionTitle>
                    <div className="flex items-center gap-2 flex-wrap">
                        {recAction && (
                            <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${actionColor(recAction)}`}>
                                {recAction}
                            </span>
                        )}
                        {tp != null && (
                            <span className="text-[12px] font-semibold text-gray-700 dark:text-gray-200">
                                TP: {tp.toLocaleString('vi-VN')}
                            </span>
                        )}
                        {upside != null && (
                            <span className={`text-[12px] font-semibold ${upside >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                                ({fmtPct(upside)})
                            </span>
                        )}
                        {p.timing && (
                            <span className={`text-[11px] font-medium ${timingColor(p.timing)}`}>
                                · {p.timing}
                            </span>
                        )}
                    </div>
                    {(p.pe_assessment || p.pb_assessment) && (
                        <div className="mt-1.5 flex gap-2">
                            {p.pe_assessment && (
                                <span className={`text-[10px] rounded px-1.5 py-0.5 font-semibold ${assessmentColor(p.pe_assessment)}`}>
                                    P/E {p.pe_assessment}
                                </span>
                            )}
                            {p.pb_assessment && (
                                <span className={`text-[10px] rounded px-1.5 py-0.5 font-semibold ${assessmentColor(p.pb_assessment)}`}>
                                    P/B {p.pb_assessment}
                                </span>
                            )}
                        </div>
                    )}
                    {p.target_rationale && (
                        <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                            {p.target_rationale}
                        </p>
                    )}
                </div>
            )}

            {/* Technical */}
            {tech?.trend && (
                <div>
                    <SectionTitle>Kỹ thuật</SectionTitle>
                    <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">{tech.trend}</p>
                    {(tech.support || tech.resistance) && (
                        <div className="mt-1.5 flex gap-3 text-[11px]">
                            {tech.support && (
                                <span className="text-gray-500 dark:text-gray-400">
                                    Hỗ trợ: <strong className="text-emerald-600 dark:text-emerald-400">{tech.support.toLocaleString('vi-VN')}</strong>
                                </span>
                            )}
                            {tech.resistance && (
                                <span className="text-gray-500 dark:text-gray-400">
                                    Kháng cự: <strong className="text-rose-500 dark:text-rose-400">{tech.resistance.toLocaleString('vi-VN')}</strong>
                                </span>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Valuation table */}
            {vt && (
                <div>
                    <SectionTitle>So sánh định giá</SectionTitle>
                    <ValuationGrid v={vt} />
                </div>
            )}

            {/* Model consensus */}
            {p.model_consensus && (
                <div>
                    <SectionTitle>Đồng thuận mô hình</SectionTitle>
                    <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">{p.model_consensus}</p>
                </div>
            )}
        </>
    );
}

// ── Main component ───────────────────────────────────────────────────────

export default function AiAnalysisCard({ symbol }: { symbol: string }) {
    const [data, setData] = useState<AiAnalysisData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setData(null);
        fetchAiAnalysis(symbol).then(d => {
            if (!cancelled) { setData(d); setLoading(false); }
        });
        return () => { cancelled = true; };
    }, [symbol]);

    if (loading) {
        return (
            <div className="animate-pulse rounded-xl bg-gray-50 dark:bg-gray-800/50 p-4">
                <div className="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
                <div className="space-y-2">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-3 bg-gray-200 dark:bg-gray-700 rounded" style={{ width: `${90 - i * 10}%` }} />
                    ))}
                </div>
            </div>
        );
    }

    if (!data?.available || !data.analysis_vi) return null;

    let parsed: ParsedAnalysis | null = null;
    if (data.analysis_json) {
        try {
            parsed = JSON.parse(data.analysis_json) as ParsedAnalysis;
        } catch {
            parsed = null;
        }
    }

    // Detect schema: combined (valuation_summary) vs 7-section (summary/growth_table) vs legacy (key_issues)
    const isCombined = parsed && !!parsed.valuation_summary;
    const isSevenSection = parsed && !isCombined && (parsed.growth_table || parsed.analysis || (parsed.recommendation && typeof parsed.recommendation === 'object'));
    const isLegacy = parsed && !!parsed.key_issues;

    return (
        <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-100 dark:border-blue-900/40 p-4 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
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

            {isCombined ? (
                <CombinedCard p={parsed as CombinedAnalysis} />
            ) : isSevenSection ? (
                <>
                    {parsed?.summary && (
                        <p className="text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">{parsed.summary}</p>
                    )}
                    {parsed?.technical?.trend && (
                        <div>
                            <SectionTitle>Kỹ thuật</SectionTitle>
                            <p className="text-[12px] text-gray-600 dark:text-gray-400">{parsed.technical.trend}</p>
                        </div>
                    )}
                    {typeof parsed?.recommendation === 'object' && parsed.recommendation && (
                        <div>
                            <SectionTitle>Khuyến nghị</SectionTitle>
                            <div className="flex items-center gap-2">
                                <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${actionColor(parsed.recommendation.action)}`}>
                                    {parsed.recommendation.action}
                                </span>
                                {parsed.recommendation.target_price && (
                                    <span className="text-[12px] font-semibold text-gray-700 dark:text-gray-200">
                                        {parsed.recommendation.target_price.toLocaleString('vi-VN')}
                                    </span>
                                )}
                                {parsed.recommendation.upside_pct != null && (
                                    <span className={`text-[12px] font-semibold ${parsed.recommendation.upside_pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                                        ({fmtPct(parsed.recommendation.upside_pct)})
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
                    {parsed?.growth_table && parsed.growth_table.length > 0 && (
                        <div>
                            <SectionTitle>Tăng trưởng</SectionTitle>
                            <GrowthTable rows={parsed.growth_table} />
                        </div>
                    )}
                    {parsed?.valuation && (
                        <div>
                            <SectionTitle>So sánh định giá</SectionTitle>
                            <ValuationGrid v={parsed.valuation} />
                        </div>
                    )}
                    {parsed?.risks && parsed.risks.length > 0 && (
                        <div>
                            <SectionTitle>Rủi ro</SectionTitle>
                            <ul className="space-y-1">
                                {parsed.risks.map((r, i) => (
                                    <li key={i} className="flex gap-1.5 text-[12px] text-gray-600 dark:text-gray-400">
                                        <span className="text-rose-400 mt-0.5 shrink-0">▸</span>{r}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {parsed?.analysis && (
                        <div>
                            <SectionTitle>Phân tích</SectionTitle>
                            <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">{parsed.analysis}</p>
                        </div>
                    )}
                </>
            ) : isLegacy && parsed?.key_issues ? (
                <div className="space-y-3">
                    {parsed.key_issues.map((item, i) => (
                        <div key={i} className="rounded-lg bg-white/60 dark:bg-white/5 border border-blue-100/60 dark:border-blue-900/30 p-3 space-y-2">
                            <p className="text-[12px] font-semibold text-gray-800 dark:text-gray-200">{item.issue}</p>
                            <div className="flex gap-1.5 items-start">
                                <span className="mt-0.5 shrink-0 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 rounded px-1.5 py-0.5">Bull</span>
                                <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">{item.positive_view}</p>
                            </div>
                            <div className="flex gap-1.5 items-start">
                                <span className="mt-0.5 shrink-0 text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/30 rounded px-1.5 py-0.5">Bear</span>
                                <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">{item.negative_view}</p>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">
                    {data.analysis_vi}
                </p>
            )}
        </div>
    );
}
