'use client';

interface ValuationTable {
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
}

interface Technical {
    trend?: string;
    support?: number | null;
    resistance?: number | null;
    signal?: string;
}

interface RecommendationDetail {
    action?: string;
    target_price?: number | null;
    upside_pct?: number | null;
    rationale?: string;
}

interface GrowthRow {
    period?: string;
    year?: number;
    revenue_growth?: number | null;
    profit_growth?: number | null;
    is_forecast?: boolean;
}

interface LongTerm {
    eps_cagr_3yr?: number | null;
    eps_cagr_label?: string;
    roe_avg?: number | null;
    roe_label?: string;
    dividend_yield_avg?: number | null;
    dividend_yield_label?: string;
}

interface ValuationAnalysis {
    valuation_summary?: string;
    pe_assessment?: string;
    pb_assessment?: string;
    model_consensus?: string;
    target_price?: number | null;
    target_rationale?: string;
    recommendation?: string | RecommendationDetail;
    upside_pct?: number | null;
    timing?: string;
    technical?: Technical;
    valuation_table?: ValuationTable;
    valuation?: ValuationTable;
    growth_table?: GrowthRow[];
    risks?: string[];
    long_term?: LongTerm;
    // Legacy fallback fields
    summary?: string;
    analysis?: string;
    recommendation_obj?: RecommendationDetail;
}

interface AiValuationCardProps {
    analysisJson?: string | null;
    analysisVi?: string | null;
    quarter?: string;
    model?: string;
}

function fmtX(v: number | null | undefined) {
    return v != null ? `${v.toFixed(1)}x` : '—';
}

function fmtPrice(v: number | null | undefined) {
    return v != null ? v.toLocaleString('vi-VN') : '—';
}

function fmtPct(v: number | null | undefined) {
    if (v == null) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

function fmtPlainPct(v: number | null | undefined) {
    return v != null ? `${v.toFixed(1)}%` : '—';
}

function actionColor(a: string) {
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
    return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
}

function signalColor(s: string | undefined) {
    if (s === 'Tích cực') return 'text-emerald-600 dark:text-emerald-400';
    if (s === 'Tiêu cực') return 'text-rose-500 dark:text-rose-400';
    return 'text-gray-500 dark:text-gray-400';
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-blue-500 dark:text-blue-400 mb-1.5">
            {children}
        </h4>
    );
}

function ReportSection({ index, title, children }: { index: number; title: string; children: React.ReactNode }) {
    return (
        <section className="space-y-2">
            <h4 className="text-[13px] font-bold text-gray-900 dark:text-gray-100">
                {index}) {title}
            </h4>
            {children}
        </section>
    );
}

function ValuationTableGrid({ v }: { v: ValuationTable }) {
    const rows = [
        {
            label: 'P/E',
            ttm: fmtX(v.pe_ttm),
            avg2: fmtX(v.pe_2yr_avg),
            avg5: fmtX(v.pe_5yr_avg),
            sector: fmtX(v.pe_sector),
            note: v.pe_commentary,
        },
        {
            label: 'P/B',
            ttm: fmtX(v.pb_ttm),
            avg2: fmtX(v.pb_2yr_avg),
            avg5: fmtX(v.pb_5yr_avg),
            sector: fmtX(v.pb_sector),
            note: v.pb_commentary,
        },
    ];
    return (
        <div className="space-y-2">
            {rows.map(r => (
                <div key={r.label} className="rounded-lg bg-white/50 dark:bg-white/5 border border-blue-100/60 dark:border-blue-900/30 p-2.5">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">{r.label} TTM</span>
                        <span className="text-[13px] font-bold text-blue-700 dark:text-blue-300">{r.ttm}</span>
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

function GrowthTable({ rows }: { rows: GrowthRow[] }) {
    if (!rows.length) return null;
    return (
        <div className="overflow-x-auto rounded-lg border border-blue-100/70 dark:border-blue-900/40">
            <table className="min-w-full text-[11px]">
                <thead className="bg-blue-50/70 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                    <tr>
                        <th className="px-3 py-2 text-left font-semibold">Kỳ</th>
                        <th className="px-3 py-2 text-right font-semibold">Tăng trưởng doanh thu</th>
                        <th className="px-3 py-2 text-right font-semibold">Tăng trưởng LNST</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-blue-100/70 dark:divide-blue-900/30">
                    {rows.map((row, i) => {
                        const label = row.period || (row.year ? `${row.year}${row.is_forecast ? 'F' : ''}` : `Kỳ ${i + 1}`);
                        return (
                            <tr key={`${label}-${i}`}>
                                <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">{label}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">{fmtPct(row.revenue_growth)}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">{fmtPct(row.profit_growth)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function LongTermGrid({ data }: { data: LongTerm }) {
    const items = [
        { label: 'Tăng trưởng EPS 3 năm', value: fmtPlainPct(data.eps_cagr_3yr), note: data.eps_cagr_label },
        { label: 'ROE trung bình', value: fmtPlainPct(data.roe_avg), note: data.roe_label },
        { label: 'Lợi suất cổ tức', value: fmtPlainPct(data.dividend_yield_avg), note: data.dividend_yield_label },
    ];
    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {items.map(item => (
                <div key={item.label} className="rounded-lg bg-white/60 dark:bg-white/5 border border-blue-100/60 dark:border-blue-900/30 p-2.5">
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">{item.label}</p>
                    <p className="text-[13px] font-bold text-gray-900 dark:text-gray-100">{item.value}</p>
                    {item.note && <p className="text-[10px] text-gray-500 dark:text-gray-400">{item.note}</p>}
                </div>
            ))}
        </div>
    );
}

export default function AiValuationCard({ analysisJson, analysisVi, quarter, model }: AiValuationCardProps) {
    if (!analysisJson && !analysisVi) return null;

    let data: ValuationAnalysis | null = null;
    if (analysisJson) {
        try { data = JSON.parse(analysisJson) as ValuationAnalysis; } catch { data = null; }
    }

    const recommendation =
        typeof data?.recommendation === 'object'
            ? data.recommendation
            : data?.recommendation_obj;
    const recommendationAction =
        typeof data?.recommendation === 'string'
            ? data.recommendation
            : recommendation?.action;
    const targetPrice = recommendation?.target_price ?? data?.target_price;
    const upside = recommendation?.upside_pct ?? data?.upside_pct;
    const valuationMetrics = data?.valuation || data?.valuation_table;
    const isRichReport = Boolean(data && (
        Array.isArray(data.growth_table) ||
        data.long_term ||
        (data.risks && data.risks.length > 0) ||
        typeof data.recommendation === 'object'
    ));
    const isValuationSchema = data && (data.valuation_summary || data.target_price != null || data.valuation_table);

    const rec = recommendationAction;

    return (
        <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-100 dark:border-blue-900/40 p-4 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide">
                        AI Định giá
                    </span>
                    {quarter && (
                        <span className="rounded-full bg-blue-100 dark:bg-blue-900/50 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-300">
                            {quarter}
                        </span>
                    )}
                </div>
                {model && <span className="text-[10px] text-blue-400 dark:text-blue-500">{model}</span>}
            </div>

            {(isRichReport || isValuationSchema) && data ? (
                <div className="space-y-5">
                    <ReportSection index={1} title="Trạng thái hiện tại của cổ phiếu">
                        {data.technical ? (
                            <div className="space-y-1.5 text-[12px] leading-relaxed text-gray-700 dark:text-gray-300">
                                {data.technical.signal && (
                                    <p className={`font-semibold ${signalColor(data.technical.signal)}`}>{data.technical.signal}</p>
                                )}
                                {data.technical.trend && <p>{data.technical.trend}</p>}
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
                                    {data.technical.support != null && (
                                        <span>Hỗ trợ: <strong className="text-emerald-600 dark:text-emerald-400">{fmtPrice(data.technical.support)}</strong></span>
                                    )}
                                    {data.technical.resistance != null && (
                                        <span>Kháng cự: <strong className="text-rose-500 dark:text-rose-400">{fmtPrice(data.technical.resistance)}</strong></span>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <p className="text-[12px] text-gray-600 dark:text-gray-400">{data.summary || data.valuation_summary || analysisVi}</p>
                        )}
                    </ReportSection>

                    <ReportSection index={2} title="Khuyến nghị và giá mục tiêu">
                        <div className="space-y-2">
                            {(rec || targetPrice || upside != null) && (
                                <div className="flex items-center gap-2 flex-wrap">
                                    {rec && <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${actionColor(rec)}`}>{rec}</span>}
                                    {targetPrice != null && <span className="text-[14px] font-bold text-gray-900 dark:text-gray-100">{fmtPrice(targetPrice)}</span>}
                                    {upside != null && (
                                        <span className={`text-[12px] font-semibold ${upside >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                                            ({fmtPct(upside)})
                                        </span>
                                    )}
                                    {data.timing && <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium ${timingColor(data.timing)}`}>{data.timing}</span>}
                                </div>
                            )}
                            {(data.target_rationale || recommendation?.rationale || data.valuation_summary || data.summary) && (
                                <p className="text-[12px] leading-relaxed text-gray-700 dark:text-gray-300">
                                    {data.target_rationale || recommendation?.rationale || data.valuation_summary || data.summary}
                                </p>
                            )}
                        </div>
                    </ReportSection>

                    {data.growth_table && data.growth_table.length > 0 && (
                        <ReportSection index={3} title="Tăng trưởng">
                            <GrowthTable rows={data.growth_table} />
                        </ReportSection>
                    )}

                    {valuationMetrics && (
                        <ReportSection index={4} title="So sánh định giá">
                            <ValuationTableGrid v={valuationMetrics} />
                        </ReportSection>
                    )}

                    {data.risks && data.risks.length > 0 && (
                        <ReportSection index={5} title="Rủi ro">
                            <ul className="space-y-1.5 text-[12px] leading-relaxed text-gray-700 dark:text-gray-300">
                                {data.risks.map((risk, i) => (
                                    <li key={i} className="flex gap-2">
                                        <span className="mt-1 h-1 w-1 rounded-full bg-rose-400 shrink-0" />
                                        <span>{risk}</span>
                                    </li>
                                ))}
                            </ul>
                        </ReportSection>
                    )}

                    {data.analysis && (
                        <ReportSection index={6} title="Phân tích">
                            <p className="text-[12px] leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-line">{data.analysis}</p>
                        </ReportSection>
                    )}

                    {data.long_term && (
                        <ReportSection index={7} title="Dài hạn">
                            <LongTermGrid data={data.long_term} />
                        </ReportSection>
                    )}
                </div>
            ) : isValuationSchema ? (
                <>
                    {/* Valuation summary */}
                    {data!.valuation_summary && (
                        <p className="text-[12px] leading-relaxed text-gray-700 dark:text-gray-300">
                            {data!.valuation_summary}
                        </p>
                    )}

                    {/* Recommendation + Target */}
                    {(rec || targetPrice) && (
                        <div>
                            <SectionTitle>Khuyến nghị</SectionTitle>
                            <div className="flex items-center gap-2 flex-wrap">
                                {rec && (
                                    <span className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${actionColor(rec)}`}>
                                        {rec}
                                    </span>
                                )}
                                {targetPrice && (
                                    <span className="text-[13px] font-semibold text-gray-800 dark:text-gray-100">
                                        {fmtPrice(targetPrice)}
                                    </span>
                                )}
                                {upside != null && (
                                    <span className={`text-[12px] font-semibold ${upside >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                                        ({fmtPct(upside)})
                                    </span>
                                )}
                                {data!.timing && (
                                    <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium ${timingColor(data!.timing)}`}>
                                        {data!.timing}
                                    </span>
                                )}
                            </div>
                            {data!.target_rationale && (
                                <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                                    {data!.target_rationale}
                                </p>
                            )}
                        </div>
                    )}

                    {/* PE/PB assessment badges */}
                    {(data!.pe_assessment || data!.pb_assessment) && (
                        <div className="flex gap-2 flex-wrap">
                            {data!.pe_assessment && (
                                <div className="text-[11px] rounded-lg bg-white/60 dark:bg-white/5 border border-blue-100/60 dark:border-blue-900/30 px-2.5 py-1.5">
                                    <span className="text-gray-500 dark:text-gray-400">P/E: </span>
                                    <span className={`font-semibold ${assessmentColor(data!.pe_assessment)}`}>{data!.pe_assessment}</span>
                                </div>
                            )}
                            {data!.pb_assessment && (
                                <div className="text-[11px] rounded-lg bg-white/60 dark:bg-white/5 border border-blue-100/60 dark:border-blue-900/30 px-2.5 py-1.5">
                                    <span className="text-gray-500 dark:text-gray-400">P/B: </span>
                                    <span className={`font-semibold ${assessmentColor(data!.pb_assessment)}`}>{data!.pb_assessment}</span>
                                </div>
                            )}
                            {data!.model_consensus && (
                                <p className="w-full text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">{data!.model_consensus}</p>
                            )}
                        </div>
                    )}

                    {/* Technical */}
                    {data!.technical && (
                        <div>
                            <SectionTitle>Kỹ thuật</SectionTitle>
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                {data!.technical.signal && (
                                    <span className={`text-[11px] font-semibold ${signalColor(data!.technical.signal)}`}>
                                        {data!.technical.signal}
                                    </span>
                                )}
                                {data!.technical.support && (
                                    <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                        Hỗ trợ: <strong className="text-emerald-600 dark:text-emerald-400">{data!.technical.support.toLocaleString('vi-VN')}</strong>
                                    </span>
                                )}
                                {data!.technical.resistance && (
                                    <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                        Kháng cự: <strong className="text-rose-500 dark:text-rose-400">{data!.technical.resistance.toLocaleString('vi-VN')}</strong>
                                    </span>
                                )}
                            </div>
                            {data!.technical.trend && (
                                <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">{data!.technical.trend}</p>
                            )}
                        </div>
                    )}

                    {/* Valuation table */}
                    {data!.valuation_table && (
                        <div>
                            <SectionTitle>So sánh định giá</SectionTitle>
                            <ValuationTableGrid v={data!.valuation_table} />
                        </div>
                    )}
                </>
            ) : data ? (
                /* Legacy rich format (7-section) — kept for backward compat */
                <>
                    {data.summary && (
                        <p className="text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">{data.summary}</p>
                    )}
                    {data.analysis && (
                        <p className="text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">{data.analysis}</p>
                    )}
                </>
            ) : (
                /* Raw text fallback */
                <p className="text-[12px] leading-relaxed text-gray-700 dark:text-gray-300">{analysisVi}</p>
            )}
        </div>
    );
}
