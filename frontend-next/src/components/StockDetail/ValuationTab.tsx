'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { calculateValuation } from '@/lib/stockApi';
import { RiRefreshLine, RiFileZipLine, RiLoader4Line, RiInformationLine } from '@remixicon/react';
import { ReportGenerator } from '@/lib/reportGenerator';
import type { ValuationResult, StockApiData } from '@/lib/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ValuationTabProps {
    symbol: string;
    currentPrice: number;
    initialData?: ValuationResult | null;
    isBank?: boolean;
    stockData?: StockApiData;
}

// ── Model config ──────────────────────────────────────────────────────────────

const MODEL_CONFIG = {
    fcfe: {
        name: 'FCFE',
        nameVi: 'Dòng tiền vốn chủ',
        formula: 'NI + D&A + Net Borrowing − ΔWC − CapEx',
        desc: 'Chiết khấu dòng tiền tự do về vốn chủ sở hữu. Dùng Cost of Equity làm tỷ lệ chiết khấu.',
        color: 'blue',
    },
    fcff: {
        name: 'FCFF',
        nameVi: 'Dòng tiền toàn DN',
        formula: 'FCFE + Interest×(1−t)',
        desc: 'Chiết khấu dòng tiền tự do về toàn doanh nghiệp. Dùng WACC, trừ nợ ròng để ra giá trị vốn chủ.',
        color: 'indigo',
    },
    justified_pe: {
        name: 'Comparable P/E',
        nameVi: 'So sánh P/E ngành',
        formula: 'EPS × Median P/E ngành',
        desc: 'Nhân EPS hiện tại với P/E trung vị của top 10 công ty cùng ngành theo vốn hóa.',
        color: 'violet',
    },
    justified_pb: {
        name: 'Comparable P/B',
        nameVi: 'So sánh P/B ngành',
        formula: 'BVPS × Median P/B ngành',
        desc: 'Nhân giá trị sổ sách mỗi cổ phần với P/B trung vị của ngành.',
        color: 'purple',
    },
    graham: {
        name: 'Graham',
        nameVi: 'Công thức Graham',
        formula: '√(22.5 × EPS × BVPS)',
        desc: 'Công thức Benjamin Graham: giá trị hợp lý khi P/E ≤ 15 và P/B ≤ 1.5. Bảo thủ, phù hợp value investing.',
        color: 'emerald',
    },
    justified_ps: {
        name: 'Comparable P/S',
        nameVi: 'So sánh P/S ngành',
        formula: 'Revenue/Share × Median P/S ngành',
        desc: 'Doanh thu mỗi cổ phần nhân với P/S trung vị ngành. Hữu ích cho công ty chưa có lợi nhuận.',
        color: 'amber',
    },
} as const;

type ModelKey = keyof typeof MODEL_CONFIG;

const COLOR_MAP: Record<string, { badge: string; bar: string; ring: string; text: string }> = {
    blue:    { badge: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',    bar: 'bg-blue-500',    ring: 'ring-blue-400',    text: 'text-blue-600 dark:text-blue-400' },
    indigo:  { badge: 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800', bar: 'bg-indigo-500', ring: 'ring-indigo-400', text: 'text-indigo-600 dark:text-indigo-400' },
    violet:  { badge: 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800', bar: 'bg-violet-500', ring: 'ring-violet-400', text: 'text-violet-600 dark:text-violet-400' },
    purple:  { badge: 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800', bar: 'bg-purple-500', ring: 'ring-purple-400', text: 'text-purple-600 dark:text-purple-400' },
    emerald: { badge: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800', bar: 'bg-emerald-500', ring: 'ring-emerald-400', text: 'text-emerald-600 dark:text-emerald-400' },
    amber:   { badge: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',  bar: 'bg-amber-500',   ring: 'ring-amber-400',   text: 'text-amber-600 dark:text-amber-400' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (v: number) => v > 0 ? new Intl.NumberFormat('vi-VN').format(Math.round(v)) : '—';
const pct = (v: number) => (v > 0 ? '+' : '') + v.toFixed(1) + '%';
const upside = (target: number, price: number) => price > 0 && target > 0 ? ((target - price) / price) * 100 : 0;

function UpsideBadge({ value, size = 'sm' }: { value: number; size?: 'sm' | 'lg' }) {
    const pos = value >= 0;
    const base = size === 'lg'
        ? 'rounded-xl px-4 py-1.5 text-xl font-black'
        : 'rounded-full px-2.5 py-0.5 text-xs font-bold';
    return (
        <span className={`${base} ${pos ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'}`}>
            {pct(value)}
        </span>
    );
}

function Tooltip({ text }: { text: string }) {
    const [open, setOpen] = useState(false);
    return (
        <span className="relative inline-block">
            <button onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onClick={() => setOpen(v => !v)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors align-middle ml-1">
                <RiInformationLine className="w-3.5 h-3.5" />
            </button>
            {open && (
                <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-xs px-3 py-2 shadow-xl leading-relaxed whitespace-normal">
                    {text}
                </span>
            )}
        </span>
    );
}

function InputField({ label, hint, value, onChange, step = '0.1', min = '0' }: {
    label: string; hint?: string; value: string | number; onChange: (v: string) => void;
    step?: string; min?: string;
}) {
    return (
        <div>
            <label className="flex items-center text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                {label}
                {hint && <Tooltip text={hint} />}
            </label>
            <input type="number" step={step} min={min} value={value}
                onChange={e => onChange(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors" />
        </div>
    );
}

// ── Sensitivity Matrix ────────────────────────────────────────────────────────

function SensitivityMatrix({ matrix, currentPrice }: {
    matrix: { row_headers: number[]; col_headers: number[]; values: number[][] };
    currentPrice: number;
}) {
    const allVals = matrix.values.flat().filter(v => v > 0);
    const min = Math.min(...allVals);
    const max = Math.max(...allVals);
    const midRow = Math.floor(matrix.row_headers.length / 2);
    const midCol = Math.floor(matrix.col_headers.length / 2);

    const cellColor = (val: number) => {
        if (!val || val <= 0) return 'bg-slate-100 dark:bg-slate-800 text-slate-400';
        const ratio = (val - min) / (max - min + 1);
        if (ratio > 0.7) return 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200';
        if (ratio > 0.4) return 'bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200';
        if (ratio > 0.2) return 'bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200';
        return 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300';
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Phân tích độ nhạy (FCFF)</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Giá trị thay đổi theo WACC (hàng) và tăng trưởng dài hạn (cột) — đơn vị: nghìn VND</p>
                </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="bg-slate-50 dark:bg-slate-800/50">
                            <th className="px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400">
                                WACC \ g
                            </th>
                            {matrix.col_headers.map((g, j) => (
                                <th key={j} className={`px-3 py-2 text-center font-semibold ${j === midCol ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}`}>
                                    {g.toFixed(1)}%
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {matrix.values.map((row, i) => (
                            <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                                <td className={`px-3 py-2 font-semibold ${i === midRow ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}`}>
                                    {matrix.row_headers[i].toFixed(1)}%
                                </td>
                                {row.map((val, j) => {
                                    const isBase = i === midRow && j === midCol;
                                    const up = upside(val, currentPrice);
                                    return (
                                        <td key={j} className={`px-2 py-2 text-center font-medium ${cellColor(val)} ${isBase ? 'ring-2 ring-blue-400 ring-inset' : ''}`}>
                                            <div>{val > 0 ? Math.round(val / 1000).toLocaleString('vi-VN') + 'k' : '—'}</div>
                                            {val > 0 && currentPrice > 0 && (
                                                <div className={`text-[10px] font-bold ${up >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                                                    {up > 0 ? '+' : ''}{up.toFixed(0)}%
                                                </div>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

const ValuationTab: React.FC<ValuationTabProps> = ({ symbol, currentPrice, initialData, isBank, stockData }) => {
    const [loading,       setLoading]       = useState(false);
    const [exportLoading, setExportLoading] = useState(false);
    const [result,        setResult]        = useState<ValuationResult | null>(initialData || null);
    const [manualPrice,   setManualPrice]   = useState<number>(currentPrice || 0);
    const [userEditedPrice, setUserEditedPrice] = useState(false);

    const defaultAssumptions = {
        revenueGrowth: 8,
        terminalGrowth: 3,
        wacc: 10.5,
        requiredReturn: 12,
        taxRate: 20,
        projectionYears: 5,
    };
    const [assumptions, setAssumptions] = useState(defaultAssumptions);

    type ModelState = Record<ModelKey, { enabled: boolean; weight: number }>;

    const initModels = useCallback((): ModelState => {
        const keys = Object.keys(MODEL_CONFIG) as ModelKey[];
        const base: ModelState = {} as ModelState;
        keys.forEach(k => {
            const bankDisabled = isBank && (k === 'fcfe' || k === 'fcff' || k === 'graham' || k === 'justified_ps');
            base[k] = { enabled: !bankDisabled, weight: 0 };
        });
        const enabledCount = Object.values(base).filter(m => m.enabled).length;
        const w = enabledCount > 0 ? 100 / enabledCount : 0;
        keys.forEach(k => { base[k].weight = base[k].enabled ? w : 0; });
        return base;
    }, [isBank]);

    const [models, setModels] = useState<ModelState>(initModels);

    useEffect(() => { if (currentPrice > 0 && !userEditedPrice) setManualPrice(Math.round(currentPrice * 100) / 100); }, [currentPrice, userEditedPrice]);
    useEffect(() => { if (initialData) setResult(initialData); }, [initialData]);

    const normalizeWeights = useCallback((ms: ModelState, valuations?: ValuationResult['valuations']): ModelState => {
        const keys = Object.keys(ms) as ModelKey[];
        const next = { ...ms };
        keys.forEach(k => {
            const val = Number(valuations?.[k] ?? 0);
            if (val <= 0) next[k] = { ...ms[k], enabled: false, weight: 0 };
        });
        const enabledKeys = keys.filter(k => next[k].enabled);
        const w = enabledKeys.length > 0 ? 100 / enabledKeys.length : 0;
        keys.forEach(k => { next[k] = { ...next[k], weight: next[k].enabled ? w : 0 }; });
        return next;
    }, []);

    const toggleModel = (key: ModelKey) => {
        setModels(prev => {
            const next = { ...prev, [key]: { ...prev[key], enabled: !prev[key].enabled } };
            const enabledCount = Object.values(next).filter(m => m.enabled).length;
            const w = enabledCount > 0 ? 100 / enabledCount : 0;
            (Object.keys(next) as ModelKey[]).forEach(k => { next[k] = { ...next[k], weight: next[k].enabled ? w : 0 }; });
            return next;
        });
    };

    const getModelWeights = useCallback(() => {
        const out: Record<string, number> = {};
        (Object.keys(models) as ModelKey[]).forEach(k => { out[k] = models[k].enabled ? models[k].weight : 0; });
        return out;
    }, [models]);

    const weightedAvg = useMemo(() => {
        if (!result?.valuations) return 0;
        let totalVal = 0, totalWeight = 0;
        (Object.keys(models) as ModelKey[]).forEach(k => {
            if (models[k].enabled) {
                const v = Number(result.valuations[k] || 0);
                if (v > 0) { totalVal += v * models[k].weight; totalWeight += models[k].weight; }
            }
        });
        return totalWeight > 0 ? totalVal / totalWeight : 0;
    }, [models, result]);

    const finalUpside = upside(weightedAvg, manualPrice);

    const recommendation = useMemo(() => {
        if (finalUpside >= 20) return { label: 'Mua mạnh', color: 'text-emerald-600 dark:text-emerald-400' };
        if (finalUpside >= 8)  return { label: 'Tích lũy',  color: 'text-emerald-500 dark:text-emerald-300' };
        if (finalUpside >= -5) return { label: 'Nắm giữ',  color: 'text-amber-600 dark:text-amber-400' };
        if (finalUpside >= -15)return { label: 'Thận trọng',color: 'text-orange-600 dark:text-orange-400' };
        return { label: 'Bán',        color: 'text-red-600 dark:text-red-400' };
    }, [finalUpside]);

    const handleCalculate = async () => {
        setLoading(true);
        try {
            const data = await calculateValuation(symbol, {
                ...assumptions,
                modelWeights: getModelWeights(),
                currentPrice: manualPrice,
                includeComparableLists: false,
                includeQuality: false,
            });
            if (data?.success) {
                setResult(data);
                setModels(prev => normalizeWeights(prev, data.valuations));
            }
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    const handleReset = () => {
        setAssumptions(defaultAssumptions);
        setManualPrice(Math.round(currentPrice * 100) / 100 || 0);
        setUserEditedPrice(false);
        setModels(initModels());
    };

    const handleExport = async () => {
        if (!result) { alert('Chưa có dữ liệu định giá. Nhấn Phân tích trước.'); return; }
        setExportLoading(true);
        try {
            const gen = new ReportGenerator();
            await gen.exportReport(stockData || result.metrics || result, result, assumptions, getModelWeights(), symbol);
        } catch (e) { alert('Lỗi xuất báo cáo: ' + (e as any).message); }
        finally { setExportLoading(false); }
    };

    useEffect(() => {
        if (symbol && manualPrice > 0 && !result && !loading) handleCalculate();
    }, [symbol, manualPrice]); // eslint-disable-line

    const sensitivity = result?.sensitivity_analysis as any;
    const scenarios   = result?.scenarios;

    return (
        <div className="space-y-5 pb-10">

            {/* ── Header ─────────────────────────────────────── */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Định giá cổ phiếu</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Điều chỉnh giả định và chọn mô hình phù hợp</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={handleReset}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                        <RiRefreshLine className="w-4 h-4" /> Đặt lại
                    </button>
                    <button onClick={handleExport} disabled={exportLoading}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50">
                        {exportLoading ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : <RiFileZipLine className="w-4 h-4" />} Xuất báo cáo
                    </button>
                    <button onClick={handleCalculate} disabled={loading}
                        className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 transition-colors">
                        {loading ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : null}
                        {loading ? 'Đang tính…' : 'Phân tích'}
                    </button>
                </div>
            </div>

            {/* ── Bank notice ─────────────────────────────────── */}
            {isBank && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
                    <span className="font-semibold">Ngân hàng:</span> DCF (FCFE, FCFF) và Graham không phù hợp với cấu trúc tài sản đặc thù. Chỉ sử dụng P/E và P/B ngành.
                </div>
            )}

            {/* ── 2-column layout ──────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

                {/* Left: Assumptions */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Giả định đầu vào</p>

                    <div className="space-y-3">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Thị trường</p>
                        <InputField label="Giá hiện tại (VND)" hint="Giá thị trường dùng để tính % upside so với giá trị nội tại"
                            value={manualPrice} step="1" min="0"
                            onChange={v => { setManualPrice(parseFloat(v) || 0); setUserEditedPrice(true); }} />
                        <InputField label="WACC (%)" hint="Chi phí vốn bình quân gia quyền — dùng cho FCFF. Thường 9–12% với cổ phiếu VN"
                            value={assumptions.wacc} onChange={v => setAssumptions(p => ({ ...p, wacc: parseFloat(v) || 0 }))} />
                        <InputField label="Chi phí vốn CSH (%)" hint="Lợi suất kỳ vọng của cổ đông — dùng cho FCFE. Thường cao hơn WACC ~1–2%"
                            value={assumptions.requiredReturn} onChange={v => setAssumptions(p => ({ ...p, requiredReturn: parseFloat(v) || 0 }))} />
                    </div>

                    <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-3">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Tăng trưởng</p>
                        <InputField label="Tăng trưởng ngắn hạn (%)" hint="Tốc độ tăng trưởng trong giai đoạn dự báo (thường 3–5 năm). Dựa trên lịch sử và kế hoạch DN"
                            value={assumptions.revenueGrowth} onChange={v => setAssumptions(p => ({ ...p, revenueGrowth: parseFloat(v) || 0 }))} />
                        <InputField label="Tăng trưởng dài hạn (%)" hint="Tốc độ tăng trưởng mãi mãi sau giai đoạn dự báo. Không nên vượt tốc độ tăng trưởng GDP (~3–4%)"
                            value={assumptions.terminalGrowth} onChange={v => setAssumptions(p => ({ ...p, terminalGrowth: parseFloat(v) || 0 }))} />
                    </div>

                    <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-3">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Khác</p>
                        <InputField label="Thuế suất (%)" hint="Thuế TNDN thực tế. Việt Nam tiêu chuẩn 20%, ưu đãi 10–17%"
                            value={assumptions.taxRate} onChange={v => setAssumptions(p => ({ ...p, taxRate: parseFloat(v) || 0 }))} />
                        <InputField label="Số năm dự báo" hint="Số năm trong giai đoạn tăng trưởng ngắn hạn trước khi dùng terminal value (thường 5 năm)"
                            value={assumptions.projectionYears} step="1" min="1"
                            onChange={v => setAssumptions(p => ({ ...p, projectionYears: parseInt(v) || 5 }))} />
                    </div>
                </div>

                {/* Right: Models + Result */}
                <div className="lg:col-span-2 flex flex-col gap-5">

                    {/* Model toggles */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {(Object.keys(MODEL_CONFIG) as ModelKey[]).map(key => {
                            const cfg   = MODEL_CONFIG[key];
                            const m     = models[key];
                            const clr   = COLOR_MAP[cfg.color];
                            const val   = result?.valuations?.[key];
                            const hasVal = val && Number(val) > 0;
                            return (
                                <button key={key} onClick={() => toggleModel(key)}
                                    className={`text-left rounded-xl border p-4 transition-colors ${
                                        m.enabled
                                            ? `${clr.badge} border ring-1 ${clr.ring}`
                                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-600'
                                    }`}>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className={`text-xs font-bold uppercase tracking-wide ${m.enabled ? '' : 'text-slate-500 dark:text-slate-400'}`}>
                                            {cfg.name}
                                        </span>
                                        {m.enabled && <span className={`w-2 h-2 rounded-full ${clr.bar}`} />}
                                    </div>
                                    <p className={`text-[11px] leading-tight mb-2 ${m.enabled ? '' : 'text-slate-400 dark:text-slate-500'}`}>
                                        {cfg.nameVi}
                                    </p>
                                    <code className={`text-[10px] block truncate ${m.enabled ? clr.text : 'text-slate-400 dark:text-slate-500'}`}>
                                        {cfg.formula}
                                    </code>
                                    {hasVal && (
                                        <p className="mt-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                                            {fmt(Number(val))}
                                        </p>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Result card */}
                    {result && weightedAvg > 0 ? (
                        <div className="rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6 relative overflow-hidden">
                            <div className="relative z-10">
                                <p className="text-xs font-medium uppercase tracking-widest text-slate-400 mb-1">Giá trị nội tại ước tính</p>
                                <div className="flex flex-wrap items-baseline gap-3 mb-6">
                                    <span className="text-4xl sm:text-5xl font-black tracking-tight">{fmt(weightedAvg)}</span>
                                    <UpsideBadge value={finalUpside} size="lg" />
                                </div>
                                <div className="grid grid-cols-2 gap-6 border-t border-slate-700/50 pt-5">
                                    <div>
                                        <p className="text-xs text-slate-400 uppercase mb-1">Khuyến nghị</p>
                                        <p className={`text-2xl font-black ${recommendation.color}`}>{recommendation.label}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-slate-400 uppercase mb-1">Giá thị trường</p>
                                        <p className="text-2xl font-black text-blue-300">{fmt(manualPrice)}</p>
                                    </div>
                                </div>
                            </div>
                            <div className="absolute -top-20 -right-20 w-56 h-56 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
                            <div className="absolute -bottom-20 -left-20 w-56 h-56 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
                        </div>
                    ) : result && !loading ? (
                        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-5 text-sm text-amber-700 dark:text-amber-300">
                            Không tính được giá trị nội tại — kiểm tra dữ liệu tài chính của cổ phiếu hoặc thử lại.
                        </div>
                    ) : null}
                </div>
            </div>

            {/* ── Model breakdown table ─────────────────────────── */}
            {result?.valuations && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Kết quả từng mô hình</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Nhấn vào card ở trên để bật/tắt mô hình và điều chỉnh trọng số</p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                                    <th className="px-5 py-3 text-left font-semibold">Mô hình</th>
                                    <th className="px-5 py-3 text-left font-semibold">Công thức</th>
                                    <th className="px-5 py-3 text-right font-semibold">Giá trị</th>
                                    <th className="px-5 py-3 text-right font-semibold">Upside</th>
                                    <th className="px-5 py-3 text-right font-semibold">Trọng số</th>
                                    <th className="px-5 py-3 text-center font-semibold">Trạng thái</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(Object.keys(MODEL_CONFIG) as ModelKey[]).map(key => {
                                    const cfg  = MODEL_CONFIG[key];
                                    const m    = models[key];
                                    const val  = Number(result.valuations?.[key] || 0);
                                    const up   = upside(val, manualPrice);
                                    const clr  = COLOR_MAP[cfg.color];
                                    return (
                                        <tr key={key} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                                            <td className="px-5 py-3">
                                                <div className="flex items-center gap-2">
                                                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${m.enabled && val > 0 ? clr.bar : 'bg-slate-300 dark:bg-slate-600'}`} />
                                                    <div>
                                                        <p className="font-semibold text-slate-800 dark:text-slate-200">{cfg.name}</p>
                                                        <p className="text-xs text-slate-400">{cfg.nameVi}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-5 py-3">
                                                <code className="text-xs text-slate-500 dark:text-slate-400">{cfg.formula}</code>
                                            </td>
                                            <td className="px-5 py-3 text-right font-mono font-semibold text-slate-800 dark:text-slate-200">
                                                {val > 0 ? fmt(val) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                                            </td>
                                            <td className="px-5 py-3 text-right">
                                                {val > 0 && manualPrice > 0 ? <UpsideBadge value={up} /> : <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>}
                                            </td>
                                            <td className="px-5 py-3 text-right">
                                                {m.enabled && val > 0
                                                    ? <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{m.weight.toFixed(0)}%</span>
                                                    : <span className="text-xs text-slate-300 dark:text-slate-600">—</span>}
                                            </td>
                                            <td className="px-5 py-3 text-center">
                                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                                    m.enabled && val > 0
                                                        ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                                                }`}>
                                                    {m.enabled && val > 0 ? 'Bật' : !m.enabled ? 'Tắt' : 'Thiếu dữ liệu'}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {/* Weighted avg row */}
                                <tr className="border-t-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                                    <td colSpan={2} className="px-5 py-3 font-bold text-slate-800 dark:text-slate-200">Bình quân gia quyền</td>
                                    <td className="px-5 py-3 text-right font-mono font-black text-blue-600 dark:text-blue-400">{fmt(weightedAvg)}</td>
                                    <td className="px-5 py-3 text-right"><UpsideBadge value={finalUpside} /></td>
                                    <td className="px-5 py-3 text-right text-xs font-semibold text-slate-500">100%</td>
                                    <td />
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Scenario analysis ──────────────────────────────── */}
            {scenarios && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-1">Phân tích kịch bản</p>
                    <p className="text-xs text-slate-400 mb-4">Bear / Base / Bull với các mức tăng trưởng và lãi suất khác nhau</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {[
                            { key: 'bear', label: 'Bi quan', emoji: '🐻', border: 'border-red-200 dark:border-red-800', bg: 'bg-red-50 dark:bg-red-900/20' },
                            { key: 'base', label: 'Cơ sở',   emoji: '📊', border: 'border-blue-200 dark:border-blue-800', bg: 'bg-blue-50 dark:bg-blue-900/20' },
                            { key: 'bull', label: 'Lạc quan', emoji: '🐂', border: 'border-emerald-200 dark:border-emerald-800', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
                        ].map(({ key, label, emoji, border, bg }) => {
                            const sc = (scenarios as any)[key] || {};
                            let scVal = 0, scWeight = 0;
                            (Object.keys(models) as ModelKey[]).forEach(k => {
                                if (models[k].enabled) {
                                    const v = Number(sc.valuations?.[k] || 0);
                                    if (v > 0) { scVal += v * models[k].weight; scWeight += models[k].weight; }
                                }
                            });
                            const avg = scWeight > 0 ? scVal / scWeight : 0;
                            const up  = upside(avg, manualPrice);
                            return (
                                <div key={key} className={`rounded-xl border ${border} ${bg} p-4`}>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{emoji} {label}</span>
                                        {avg > 0 && <UpsideBadge value={up} />}
                                    </div>
                                    <p className="text-2xl font-black text-slate-900 dark:text-slate-100">{avg > 0 ? fmt(avg) : '—'}</p>
                                    {sc.assumptions && (
                                        <div className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                                            <div>Tăng trưởng: {((Number(sc.assumptions.growth || 0)) * 100).toFixed(1)}%</div>
                                            <div>WACC: {((Number(sc.assumptions.wacc || 0)) * 100).toFixed(1)}%</div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── Sensitivity matrix ─────────────────────────────── */}
            {sensitivity?.values && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
                    <SensitivityMatrix matrix={sensitivity} currentPrice={manualPrice} />
                </div>
            )}

        </div>
    );
};

export default React.memo(ValuationTab, (prev, next) => {
    if (prev.symbol !== next.symbol) return false;
    if (prev.isBank !== next.isBank) return false;
    const changed = prev.currentPrice > 0
        ? Math.abs((next.currentPrice - prev.currentPrice) / prev.currentPrice) > 0.005
        : next.currentPrice !== prev.currentPrice;
    return !changed;
});
