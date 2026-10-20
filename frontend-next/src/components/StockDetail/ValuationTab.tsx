'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { calculateValuation } from '@/lib/stockApi';
import { isModelAvailable, reconcileModelSelection, weightedValuation, type ModelKey } from '@/lib/valuationModels';
import {
    Card,
    Title,
    Text,
    Metric,
    Button,
    Badge,
    Grid,
    Col,
    TextInput,
    Callout,
    Table,
    TableHead,
    TableHeaderCell,
    TableBody,
    TableRow,
    TableCell,
} from '@tremor/react';
import {
    RiRefreshLine,
    RiMoneyDollarCircleLine,
    RiBuildingLine,
    RiBarChartLine,
    RiBookOpenLine,
    RiScales3Line,
    RiFileZipLine,
} from '@remixicon/react';
import type { ValuationResult, StockApiData } from '@/lib/types';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/translations';

function classNames(...classes: Array<string | false | undefined | null>) {
    return classes.filter(Boolean).join(' ');
}

interface ValuationTabProps {
    symbol: string;
    currentPrice: number;
    initialData?: ValuationResult | null;
    isBank?: boolean;
    stockData?: StockApiData;
}

const MODEL_META: Record<ModelKey, { nameVi: string; nameEn: string; formulaVi: string; formulaEn: string }> = {
    fcfe: {
        nameVi: 'Dòng tiền vốn chủ',
        nameEn: 'Free Cash Flow to Equity',
        formulaVi: 'CFO − CapEx + Vay ròng',
        formulaEn: 'CFO − CapEx + Net Borrowing',
    },
    fcff: {
        nameVi: 'Dòng tiền toàn DN',
        nameEn: 'Free Cash Flow to Firm',
        formulaVi: 'CFO − CapEx + Lãi vay×(1−t), sau đó EV − Nợ ròng',
        formulaEn: 'CFO − CapEx + Interest×(1−t), then EV − Net Debt',
    },
    justified_pe: {
        nameVi: 'So sánh P/E ngành',
        nameEn: 'Industry P/E comparison',
        formulaVi: 'EPS × P/E trung vị ngành',
        formulaEn: 'EPS × Industry median P/E',
    },
    justified_pb: {
        nameVi: 'So sánh P/B ngành',
        nameEn: 'Industry P/B comparison',
        formulaVi: 'BVPS × P/B trung vị ngành',
        formulaEn: 'BVPS × Industry median P/B',
    },
    graham: {
        nameVi: 'Công thức Graham',
        nameEn: 'Graham formula',
        formulaVi: '√(22.5 × EPS × BVPS)',
        formulaEn: '√(22.5 × EPS × BVPS)',
    },
};

const DOT_CLASS: Record<ModelKey, string> = {
    fcfe: 'bg-blue-500',
    fcff: 'bg-indigo-500',
    justified_pe: 'bg-violet-500',
    justified_pb: 'bg-purple-500',
    graham: 'bg-emerald-500',
};

const fmt = (v: number) => (v > 0 ? new Intl.NumberFormat('vi-VN').format(Math.round(v)) : '—');
const pct = (v: number) => (v > 0 ? '+' : '') + v.toFixed(1) + '%';
const upside = (target: number, price: number) => (price > 0 && target > 0 ? ((target - price) / price) * 100 : 0);

function UpsideBadge({ value, size = 'sm' }: { value: number; size?: 'sm' | 'lg' }) {
    const pos = value >= 0;
    if (size === 'lg') {
        return (
            <span className={`rounded-xl px-4 py-1.5 text-xl font-black ${pos ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                {pct(value)}
            </span>
        );
    }
    return <Badge color={pos ? 'emerald' : 'red'} size="xs">{pct(value)}</Badge>;
}

const ValuationTab: React.FC<ValuationTabProps> = ({ symbol, currentPrice, initialData, isBank, stockData }) => {
    const { lang } = useLanguage();
    const isVietnamese = lang === 'vi';
    const copy = translations[lang].detail.valuationTab;
    const [loading, setLoading] = useState(false);
    const [exportLoading, setExportLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [inputsChanged, setInputsChanged] = useState(false);
    const activeRequest = useRef<AbortController | null>(null);
    const editVersion = useRef(0);
    const customSelection = useRef(false);
    useEffect(() => () => activeRequest.current?.abort(), []);
    const [result, setResult] = useState<ValuationResult | null>(initialData || null);
    const [manualPrice, setManualPrice] = useState<number>(currentPrice || 0);
    const [userEditedPrice, setUserEditedPrice] = useState<boolean>(false);
    const [userCustomizedModels, setUserCustomizedModels] = useState(false);
    const [userEditedGrowth, setUserEditedGrowth] = useState(false);

    const defaultAssumptions = {
        revenueGrowth: 0,
        terminalGrowth: 3,
        wacc: 0,
        requiredReturn: 0,
        taxRate: 20,
        projectionYears: 5,
    };

    const [assumptions, setAssumptions] = useState(defaultAssumptions);

    const initModels = useCallback(() => ({
        fcfe: { id: 'fcfe', name: 'FCFE', desc: 'Free Cash Flow to Equity', enabled: !isBank, weight: isBank ? 0 : 15, icon: RiMoneyDollarCircleLine },
        fcff: { id: 'fcff', name: 'FCFF', desc: 'Free Cash Flow to Firm', enabled: !isBank, weight: isBank ? 0 : 15, icon: RiBuildingLine },
        justified_pe: { id: 'justified_pe', name: 'P/E Comparables', desc: 'Relative P/E Valuation', enabled: true, weight: isBank ? 40 : 25, icon: RiBarChartLine },
        justified_pb: { id: 'justified_pb', name: 'P/B Comparables', desc: 'Relative P/B Valuation', enabled: true, weight: isBank ? 40 : 25, icon: RiBookOpenLine },
        graham: { id: 'graham', name: 'Graham', desc: 'Benjamin Graham Formula', enabled: !isBank, weight: isBank ? 0 : 15, icon: RiScales3Line },
    }), [isBank]);

    const [models, setModels] = useState(initModels);

    useEffect(() => {
        if (currentPrice > 0 && !userEditedPrice) {
            setManualPrice(Math.round(currentPrice * 100) / 100);
        }
    }, [currentPrice, userEditedPrice]);

    useEffect(() => {
        if (initialData && (!initialData.symbol || initialData.symbol === symbol)) {
            setResult(initialData);
            setModels(prev => reconcileModelSelection(prev, initialData, customSelection.current));
        }
    }, [initialData, symbol]);

    useEffect(() => {
        setAssumptions(defaultAssumptions);
        setUserEditedGrowth(false);
    }, [symbol]); // eslint-disable-line

    const handleAssumptionChange = (key: string, value: string) => {
        editVersion.current++;
        setInputsChanged(true);
        if (key === 'revenueGrowth') setUserEditedGrowth(true);
        setAssumptions(prev => ({ ...prev, [key]: parseFloat(value) || 0 }));
    };

    const toggleModel = (key: ModelKey) => {
        if (!isModelAvailable(key, result, isBank) || loading) return;
        customSelection.current = true;
        setUserCustomizedModels(true);
        setModels(prev => {
            const targetModel = prev[key as keyof typeof models];
            const newModels = {
                ...prev,
                [key]: {
                    ...targetModel,
                    enabled: !targetModel.enabled,
                },
            };

            const enabledCount = Object.values(newModels).filter(m => m.enabled).length;
            const weight = enabledCount > 0 ? 100 / enabledCount : 0;

            Object.keys(newModels).forEach(k => {
                const m = newModels[k as keyof typeof models];
                if (m.enabled) {
                    newModels[k as keyof typeof models] = { ...m, weight: weight };
                } else {
                    newModels[k as keyof typeof models] = { ...m, weight: 0 };
                }
            });

            return newModels;
        });
    };

    const getModelWeights = useCallback(() => ({
        fcfe: models.fcfe.enabled ? models.fcfe.weight : 0,
        fcff: models.fcff.enabled ? models.fcff.weight : 0,
        justified_pe: models.justified_pe.enabled ? models.justified_pe.weight : 0,
        justified_pb: models.justified_pb.enabled ? models.justified_pb.weight : 0,
        graham: models.graham.enabled ? models.graham.weight : 0,
    }), [models]);

    const handleFullExport = async () => {
        setExportLoading(true);
        try {
            if (!result || inputsChanged) {
                alert('Chưa có dữ liệu định giá để xuất. Vui lòng Analyze trước.');
                return;
            }

            const { ReportGenerator } = await import('@/lib/reportGenerator');
            const generator = new ReportGenerator();
            await generator.exportReport(
                (stockData || result.metrics || result) as unknown as Record<string, unknown>,
                result as unknown as Record<string, unknown>,
                assumptions,
                getModelWeights(),
                symbol,
            );
        } catch (error) {
            console.error('Export error:', error);
            alert('Lỗi xuất báo cáo: ' + (error as any).message);
        } finally {
            setExportLoading(false);
        }
    };

    const handleCalculate = async (reset = false) => {
        activeRequest.current?.abort();
        const controller = new AbortController();
        activeRequest.current = controller;
        const version = editVersion.current;
        setLoading(true);
        setErrorMessage('');
        try {
            const data = await calculateValuation(symbol, {
                ...(reset ? defaultAssumptions : assumptions),
                revenueGrowth: !reset && userEditedGrowth ? assumptions.revenueGrowth : undefined,
                ...(!reset && userCustomizedModels ? { modelWeights: getModelWeights(), useCustomWeights: true } : {}),
                currentPrice: reset ? currentPrice : manualPrice,
                includeComparableLists: true,
                comparableListLimit: 30,
                includeQuality: true,
            }, controller.signal);
            if (controller.signal.aborted || activeRequest.current !== controller) return;
            if (!data?.success) {
                setErrorMessage(copy.calculationError);
                return;
            }
            setResult(data);
            setModels(prev => reconcileModelSelection(prev, data, customSelection.current));
            if (version === editVersion.current) {
                setInputsChanged(false);
                setAssumptions(prev => ({
                    ...prev,
                    wacc: data.fcff_details?.discount_rate != null ? Number(data.fcff_details.discount_rate) * 100 : prev.wacc,
                    requiredReturn: data.fcfe_details?.discount_rate != null ? Number(data.fcfe_details.discount_rate) * 100 : prev.requiredReturn,
                    revenueGrowth: data.inputs?.growth_used ?? prev.revenueGrowth,
                }));
            }
        } catch (error) {
            if (!controller.signal.aborted) setErrorMessage(error instanceof Error ? error.message : copy.calculationError);
        } finally {
            if (activeRequest.current === controller && !controller.signal.aborted) setLoading(false);
        }
    };

    useEffect(() => {
        if (symbol && manualPrice > 0 && !result && !loading && !errorMessage) void handleCalculate();
    }, [symbol, manualPrice, result]); // eslint-disable-line react-hooks/exhaustive-deps

    const formatPrice = (val: number) => {
        if (!val) return '-';
        return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(val);
    };

    const getUpside = (target: number) => {
        if (!manualPrice || !target) return 0;
        return ((target - manualPrice) / manualPrice) * 100;
    };

    const weightedAvg = useMemo(() => weightedValuation(result?.valuations, getModelWeights()), [result, getModelWeights]);

    const finalUpside = getUpside(weightedAvg);
    const activeModelsCount = Object.values(models).filter(m => m.enabled).length;

    const scenarios = result?.scenarios || null;

    const calcScenarioWeightedAvg = (scenario: NonNullable<ValuationResult['scenarios']>['base']) =>
        weightedValuation(scenario?.valuations, getModelWeights());

    const scenarioRows = scenarios
        ? [
            { key: 'bear', label: 'Bear', data: scenarios.bear },
            { key: 'base', label: 'Base', data: scenarios.base },
            { key: 'bull', label: 'Bull', data: scenarios.bull },
        ]
        : [];

    const handleReset = () => {
        setAssumptions(defaultAssumptions);
        setUserEditedGrowth(false);
        setManualPrice(Math.round(currentPrice * 100) / 100 || 0);
        setUserEditedPrice(false);
        setUserCustomizedModels(false);
        customSelection.current = false;
        setModels(initModels());
        setInputsChanged(true);
        void handleCalculate(true);
    };

    const valuationPolicy = result?.inputs?.valuation_policy as {
        archetype?: string;
        market_cap_tier?: string;
        icb_size_bucket?: string;
        is_icb_leader?: boolean;
        icb_rank?: number | null;
        icb_cohort_count?: number;
    } | undefined;
    const newsOverlay = result?.news_overlay;
    const businessTypeLabel: Record<string, string> = copy.businessTypes;
    const businessType = businessTypeLabel[valuationPolicy?.archetype || 'general'] || businessTypeLabel.general;
    const industryPosition = valuationPolicy?.is_icb_leader
        ? copy.leaderPosition
        : copy.peerPosition;
    const newsScore = Number(newsOverlay?.weighted_score ?? 5);
    const newsTone = newsScore >= 7.5
        ? copy.positive
        : newsScore >= 5.5
            ? copy.slightlyPositive
            : newsScore > 4.5
                ? copy.neutral
                : newsScore > 2.5
                    ? copy.negative
                    : copy.stronglyNegative;
    const growthSuggestion = result?.inputs?.growth_suggestion as {
        used?: number; analyst_profit_growth?: number; historical_used?: number;
    } | undefined;

    return (
        <div className="space-y-6 pb-8">
            <div className="sm:flex sm:items-center sm:justify-between">
                <div>
                    <Title className="font-bold text-gray-900 dark:text-gray-50">{copy.title}</Title>
                    <Text className="mt-1">{copy.subtitle}</Text>
                </div>
                <div className="mt-4 sm:mt-0 flex gap-2 w-full sm:w-auto">
                    <Button variant="secondary" onClick={handleReset} disabled={loading} icon={RiRefreshLine} className="flex-1 sm:flex-none">
                        {copy.reset}
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={handleFullExport}
                        icon={RiFileZipLine}
                        loading={exportLoading}
                        disabled={loading || inputsChanged || !result}
                        className="flex-1 sm:flex-none"
                    >
                        {copy.excelModel}
                    </Button>
                    <Button onClick={() => void handleCalculate()} loading={loading} className="flex-1 sm:flex-none bg-blue-600 hover:bg-blue-700 border-none text-white font-semibold">
                        {copy.analyze}
                    </Button>
                </div>
            </div>

            {errorMessage && <Callout color="rose" title={copy.calculationFailed}>{errorMessage}</Callout>}
            {inputsChanged && <Callout color="amber" title={copy.inputsChanged}>{copy.recalculateHint}</Callout>}
            {result?.model_diagnostics && Object.values(result.model_diagnostics).some(model => model && (!model.applicable || model.notes.length > 0)) && (
                <Callout color="amber" title={copy.modelLimitations}>{result.inputs?.is_bank ? copy.bankModelHint : copy.cashflowModelHint}</Callout>
            )}

            <Grid numItems={1} numItemsLg={3} className="gap-6">
                <Col numColSpan={1}>
                    <Card className="h-full rounded-tremor-default">
                        <Title>{copy.assumptions}</Title>
                        <div className="mt-6 flex flex-col gap-4">
                            <div>
                                <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{copy.marketData}</Text>
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-sm text-gray-600 dark:text-gray-400">{copy.currentPrice}</label>
                                        <div className="mt-1">
                                            <TextInput
                                                type="number"
                                                value={manualPrice.toString()}
                                                onValueChange={(v) => {
                                                    setManualPrice(parseFloat(v) || 0);
                                                    setUserEditedPrice(true); editVersion.current++; setInputsChanged(true);
                                                }}
                                            />
                                        </div>
                                    </div>
                                    {result?.target_price && (
                                        <div>
                                            <label className="text-sm text-gray-600 dark:text-gray-400">{copy.targetPrice}</label>
                                            <div className="mt-1 flex items-center justify-between rounded-tremor-default border border-tremor-border bg-tremor-background-subtle px-3 py-2 dark:border-dark-tremor-border dark:bg-dark-tremor-background-subtle">
                                                <span className="text-sm font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                                    {result.target_price.toLocaleString('vi-VN')}
                                                </span>
                                                <UpsideBadge value={getUpside(result.target_price)} />
                                            </div>
                                        </div>
                                    )}
                                    <div>
                                        <label className="text-sm text-gray-600 dark:text-gray-400">{copy.discountRate}</label>
                                        <div className="mt-1">
                                            <TextInput
                                                type="number"
                                                value={assumptions.wacc.toString()}
                                                onValueChange={(v) => handleAssumptionChange('wacc', v)}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-sm text-gray-600 dark:text-gray-400">{copy.requiredReturn}</label>
                                        <div className="mt-1">
                                            <TextInput
                                                type="number"
                                                value={assumptions.requiredReturn.toString()}
                                                onValueChange={(v) => handleAssumptionChange('requiredReturn', v)}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="border-t border-gray-100 pt-4 dark:border-gray-800">
                                <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{copy.growthRates}</Text>
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-sm text-gray-600 dark:text-gray-400">{copy.revenueGrowth}</label>
                                        <div className="mt-1">
                                            <TextInput
                                                type="number"
                                                value={assumptions.revenueGrowth.toString()}
                                                onValueChange={(v) => handleAssumptionChange('revenueGrowth', v)}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-sm text-gray-600 dark:text-gray-400">{copy.terminalGrowth}</label>
                                        <div className="mt-1">
                                            <TextInput
                                                type="number"
                                                value={assumptions.terminalGrowth.toString()}
                                                onValueChange={(v) => handleAssumptionChange('terminalGrowth', v)}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-sm text-gray-600 dark:text-gray-400">{copy.taxRate}</label>
                                        <div className="mt-1">
                                            <TextInput
                                                type="number"
                                                value={assumptions.taxRate.toString()}
                                                onValueChange={(v) => handleAssumptionChange('taxRate', v)}
                                            />
                                        </div>
                                    </div>
                                    {growthSuggestion?.analyst_profit_growth !== undefined && growthSuggestion?.historical_used !== undefined && (
                                        <div className="rounded-md bg-blue-50 px-2.5 py-2 text-[10px] text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
                                            {copy.automaticGrowth}: 60% {copy.analystForecast} ({(growthSuggestion.analyst_profit_growth * 100).toFixed(2)}%) + 40% {copy.historicalEpsCagr} ({(growthSuggestion.historical_used * 100).toFixed(2)}%) = <strong>{(Number(growthSuggestion.used || 0) * 100).toFixed(2)}%</strong>.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </Card>
                </Col>

                <Col numColSpan={1} numColSpanLg={2}>
                    <div className="flex flex-col gap-6 h-full">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            {(Object.keys(models) as Array<keyof typeof models>).map(key => {
                                const m = models[key];
                                const Icon = m.icon;
                                return (
                                    <div
                                        key={key}
                                        onClick={() => toggleModel(key)}
                                        role="button"
                                        tabIndex={isModelAvailable(key, result, isBank) && !loading ? 0 : -1}
                                        aria-disabled={!isModelAvailable(key, result, isBank) || loading}
                                        aria-pressed={m.enabled}
                                        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleModel(key); } }}
                                        className={classNames(
                                            'rounded-tremor-default border p-4 transition-all',
                                            isModelAvailable(key, result, isBank) && !loading ? 'cursor-pointer hover:shadow-sm' : 'cursor-not-allowed opacity-50',
                                            m.enabled
                                                ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500 dark:bg-blue-900/20'
                                                : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-800 dark:bg-gray-950',
                                        )}
                                    >
                                        <div className="flex items-start justify-between">
                                            <Icon className={classNames('h-5 w-5', m.enabled ? 'text-blue-600' : 'text-gray-400')} />
                                            {m.enabled && <div className="h-2 w-2 rounded-full bg-blue-500" />}
                                        </div>
                                        <div className="mt-3">
                                            <p className={classNames('text-sm font-semibold', m.enabled ? 'text-blue-700 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300')}>
                                                {m.name}
                                            </p>
                                            <p className="mt-1 text-xs text-gray-500 line-clamp-1">{m.desc}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {result && (
                            <Card className="flex-1 flex flex-col justify-between rounded-tremor-default overflow-hidden relative border-none bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-lg p-0">
                                <div className="p-8 relative z-10">
                                    <Text className="text-slate-400 font-medium tracking-wider uppercase text-xs">{copy.intrinsicProjected}</Text>
                                    <div className="mt-2 flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-4">
                                        <span className="text-4xl sm:text-5xl font-bold tracking-tight">
                                            {formatPrice(weightedAvg)}
                                        </span>
                                        <Badge
                                            size="xl"
                                            color={finalUpside >= 0 ? 'emerald' : 'rose'}
                                            className="font-bold w-fit"
                                        >
                                            {weightedAvg > 0 ? `${finalUpside > 0 ? '+' : ''}${finalUpside.toFixed(1)}% ${copy.upside}` : copy.noData}
                                        </Badge>
                                    </div>
                                    <div className="mt-8 border-t border-slate-700/50 pt-8">
                                        <div className="grid grid-cols-2 gap-8">
                                            <div>
                                                <Text className="text-slate-400 text-xs uppercase mb-1">{copy.recommendation}</Text>
                                                <Title
                                                    className={classNames(
                                                        'text-2xl sm:text-3xl font-black',
                                                        finalUpside >= 15 ? 'text-emerald-400' : finalUpside <= -10 ? 'text-rose-400' : 'text-amber-400',
                                                    )}
                                                >
                                                    {weightedAvg <= 0 ? copy.noData : finalUpside >= 15 ? copy.strongBuy : finalUpside >= 5 ? copy.accumulate : finalUpside <= -10 ? copy.sell : copy.hold}
                                                </Title>
                                            </div>
                                            <div className="text-right">
                                                <Text className="text-slate-400 text-xs uppercase mb-1">{copy.activeModels}</Text>
                                                <Title className="text-2xl sm:text-3xl font-black text-blue-300">
                                                    {activeModelsCount}
                                                </Title>
                                                <Text className="text-xs text-slate-500 mt-1">{copy.weightBlend}</Text>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
                                <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
                            </Card>
                        )}
                    </div>
                </Col>
            </Grid>

            {valuationPolicy && (
                <Callout title={copy.selectionTitle} color="blue" className="text-sm">
                    <strong>{symbol}</strong> {copy.classifiedAs} <strong>{businessType}</strong> {copy.belongsTo} <strong>{industryPosition}</strong>
                    {valuationPolicy.icb_rank && valuationPolicy.icb_cohort_count
                        ? <> ({copy.sizeRank} <strong>#{valuationPolicy.icb_rank}/{valuationPolicy.icb_cohort_count}</strong> {copy.inIndustry})</>
                        : null}
                    <span className="block mt-1 text-xs opacity-80">{copy.selectionHint}</span>
                </Callout>
            )}

            {result?.wacc_suggestion && !result.wacc_suggestion.is_fallback && (
                <Callout title={copy.discountTitle} color="blue" className="text-sm">
                    <strong>Ke {(result.wacc_suggestion.ke * 100).toFixed(2)}%</strong>
                    {' = '}Rf {(result.wacc_suggestion.rf * 100).toFixed(1)}% + β {result.wacc_suggestion.beta.toFixed(2)} × ERP {(result.wacc_suggestion.erp * 100).toFixed(1)}%.
                    {result.wacc_suggestion.debt_weight ? (
                        <span className="block mt-1">
                            WACC {(result.wacc_suggestion.wacc * 100).toFixed(2)}% {copy.combines} {((1 - result.wacc_suggestion.debt_weight) * 100).toFixed(1)}% {copy.equity} + {(result.wacc_suggestion.debt_weight * 100).toFixed(1)}% {copy.afterTaxDebt}.
                        </span>
                    ) : null}
                    <span className="block mt-1 text-xs opacity-80">{copy.marketAssumptions}</span>
                </Callout>
            )}

            {newsOverlay?.available && (
                <Callout
                    title={copy.newsImpact}
                    color={newsOverlay.direction === 'positive' ? 'emerald' : newsOverlay.direction === 'negative' ? 'rose' : 'blue'}
                    className="text-sm"
                >
                    {copy.newsSignal}: <strong>{newsTone}</strong> ({newsOverlay.weighted_score?.toFixed(2) ?? '—'}/10), {copy.basedOn} <strong>{newsOverlay.article_count}</strong> {copy.articles21Days}.
                    {newsOverlay.applicable ? (
                        <>
                            {' '}{copy.reflected} <strong>{newsOverlay.adjustment_pct >= 0 ? '+' : ''}{(newsOverlay.adjustment_pct * 100).toFixed(2)}%</strong>{newsOverlay.context_target ? <> {copy.to} <strong>{fmt(newsOverlay.context_target)}</strong>.</> : null}
                        </>
                    ) : (
                        <> {copy.insufficientNews}</>
                    )}
                    <span className="block mt-1 text-xs opacity-80">{copy.newsHint}</span>
                </Callout>
            )}

            {result?.valuations && (
                <Card>
                    <Title className="mb-0.5">{copy.modelResults}</Title>
                    <Text className="mb-4">{userCustomizedModels ? copy.modelResultsHint : copy.policyWeightsHint}</Text>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableHeaderCell>{copy.model}</TableHeaderCell>
                                    <TableHeaderCell>{copy.formula}</TableHeaderCell>
                                    <TableHeaderCell className="text-right">{copy.value}</TableHeaderCell>
                                    <TableHeaderCell className="text-right">Upside</TableHeaderCell>
                                    <TableHeaderCell className="text-right">{copy.weight}</TableHeaderCell>
                                    <TableHeaderCell className="text-center">{copy.status}</TableHeaderCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {(Object.keys(models) as ModelKey[]).map(key => {
                                    const m = models[key];
                                    const meta = MODEL_META[key];
                                    const val = Number(result.valuations?.[key] || 0);
                                    const up = upside(val, manualPrice);
                                    return (
                                        <TableRow key={key}>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${DOT_CLASS[key]} ${(!m.enabled || val <= 0) ? 'opacity-30' : ''}`} />
                                                    <div>
                                                        <Text className="font-semibold">{m.name}</Text>
                                                        <Text className="text-xs">{isVietnamese ? meta.nameVi : meta.nameEn}</Text>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <code className="text-xs text-tremor-content-subtle">{isVietnamese ? meta.formulaVi : meta.formulaEn}</code>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Text className="font-sans font-semibold">{val > 0 ? fmt(val) : '—'}</Text>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {val > 0 && manualPrice > 0 ? <UpsideBadge value={up} /> : <Text className="text-tremor-content-subtle text-xs">—</Text>}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Text className="font-semibold">
                                                    {m.enabled && val > 0 ? m.weight.toFixed(0) + '%' : '—'}
                                                </Text>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Badge color={m.enabled && val > 0 ? 'emerald' : m.enabled ? 'amber' : 'gray'} size="xs">
                                                    {m.enabled && val > 0 ? copy.on : !m.enabled ? copy.off : copy.noData}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                                <TableRow className="bg-tremor-background-subtle font-bold">
                                    <TableCell colSpan={2}>
                                        <Text className="font-bold">{copy.weightedAverage}</Text>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Text className="font-sans font-black text-blue-600">{fmt(weightedAvg)}</Text>
                                    </TableCell>
                                    <TableCell className="text-right">{weightedAvg > 0 ? <UpsideBadge value={finalUpside} /> : '—'}</TableCell>
                                    <TableCell className="text-right"><Text className="font-semibold">{weightedAvg > 0 ? '100%' : '—'}</Text></TableCell>
                                    <TableCell />
                                </TableRow>
                            </TableBody>
                        </Table>
                    </div>
                </Card>
            )}

            {scenarioRows.length > 0 && (
                <Card className="rounded-tremor-default overflow-hidden">
                    <div className="mb-4 flex items-center justify-between">
                        <div>
                            <Title>Scenario Analysis</Title>
                            <Text className="mt-1 text-xs text-gray-500">Bull/Base/Bear with adjusted growth, discount rates, and comparables factor</Text>
                        </div>
                        <Badge color="blue" size="sm">3 scenarios</Badge>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {scenarioRows.map((row) => {
                            const sc = row.data;
                            const scVal = calcScenarioWeightedAvg(sc);
                            const scUp = manualPrice > 0 ? ((scVal - manualPrice) / manualPrice) * 100 : 0;
                            return (
                                <div
                                    key={row.key}
                                    className={classNames(
                                        'rounded-lg border p-4',
                                        row.key === 'base'
                                            ? 'border-blue-300 bg-blue-50/60 dark:border-blue-700 dark:bg-blue-900/20'
                                            : row.key === 'bull'
                                                ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/20'
                                                : 'border-rose-200 bg-rose-50/50 dark:border-rose-800 dark:bg-rose-900/20',
                                    )}
                                >
                                    <div className="flex items-center justify-between">
                                        <Text className="text-xs font-semibold uppercase tracking-wide">{row.label}</Text>
                                        <Badge color={scUp >= 0 ? 'emerald' : 'rose'} size="xs">{scUp > 0 ? '+' : ''}{scUp.toFixed(1)}%</Badge>
                                    </div>
                                    <Metric className="mt-2">{formatPrice(scVal)}</Metric>
                                    <div className="mt-3 space-y-1 text-[11px] text-gray-600 dark:text-gray-300">
                                        <div>Growth: {(Number(sc?.assumptions?.growth || 0) * 100).toFixed(2)}%</div>
                                        <div>WACC: {(Number(sc?.assumptions?.wacc || 0) * 100).toFixed(2)}%</div>
                                        <div>Req. Return: {(Number(sc?.assumptions?.required_return || 0) * 100).toFixed(2)}%</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Card>
            )}



        </div>
    );
};

export default React.memo(ValuationTab);
