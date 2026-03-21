'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { calculateValuation } from '@/lib/stockApi';
import { Card, Title, Text, Metric, Button, Badge, Grid, Col, TextInput, Callout } from '@tremor/react';
import { RiRefreshLine, RiMoneyDollarCircleLine, RiBuildingLine, RiBarChartLine, RiBookOpenLine, RiScales3Line, RiErrorWarningFill, RiFileZipLine, RiShoppingCart2Line } from '@remixicon/react';
import { ReportGenerator } from '@/lib/reportGenerator';
import type { ValuationResult, StockApiData } from '@/lib/types';

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

const ValuationTab: React.FC<ValuationTabProps> = ({ symbol, currentPrice, initialData, isBank, stockData }) => {
    const [loading, setLoading] = useState(false);
    const [exportLoading, setExportLoading] = useState(false);
    const [result, setResult] = useState<ValuationResult | null>(initialData || null);
    const [manualPrice, setManualPrice] = useState<number>(currentPrice || 0);
    const [userEditedPrice, setUserEditedPrice] = useState<boolean>(false);



    // Initial Assumptions
    const defaultAssumptions = {
        revenueGrowth: 8,
        terminalGrowth: 3,
        wacc: 10.5,
        requiredReturn: 12,
        taxRate: 20,
        projectionYears: 5
    };

    const [assumptions, setAssumptions] = useState(defaultAssumptions);

    // Models State
    const [models, setModels] = useState({
        fcfe: { id: 'fcfe', name: 'FCFE', desc: 'Free Cash Flow to Equity', enabled: !isBank, weight: isBank ? 0 : 15, icon: RiMoneyDollarCircleLine },
        fcff: { id: 'fcff', name: 'FCFF', desc: 'Free Cash Flow to Firm', enabled: !isBank, weight: isBank ? 0 : 15, icon: RiBuildingLine },
        justified_pe: { id: 'justified_pe', name: 'P/E Comparables', desc: 'Relative P/E Valuation', enabled: true, weight: isBank ? 40 : 20, icon: RiBarChartLine },
        justified_pb: { id: 'justified_pb', name: 'P/B Comparables', desc: 'Relative P/B Valuation', enabled: true, weight: isBank ? 40 : 20, icon: RiBookOpenLine },
        graham: { id: 'graham', name: 'Graham', desc: 'Benjamin Graham Formula', enabled: !isBank, weight: isBank ? 0 : 15, icon: RiScales3Line },
        justified_ps: { id: 'justified_ps', name: 'P/S Comparables', desc: 'Price-to-Sales Valuation', enabled: true, weight: isBank ? 20 : 15, icon: RiShoppingCart2Line },
    });

    const normalizeEnabledModelWeights = useCallback((prevModels: typeof models, valuations?: ValuationResult['valuations']) => {
        const modelKeys = Object.keys(prevModels) as Array<keyof typeof prevModels>;
        const nextModels = { ...prevModels };

        modelKeys.forEach((key) => {
            const current = prevModels[key];
            const valuationValue = Number(valuations?.[key] ?? 0);
            // Auto-disable models with non-positive valuation from weighted calculation.
            if (valuationValue <= 0) {
                nextModels[key] = { ...current, enabled: false, weight: 0 };
            } else {
                nextModels[key] = { ...current };
            }
        });

        const enabledKeys = modelKeys.filter((key) => nextModels[key].enabled);
        const equalWeight = enabledKeys.length > 0 ? 100 / enabledKeys.length : 0;

        modelKeys.forEach((key) => {
            const m = nextModels[key];
            nextModels[key] = { ...m, weight: m.enabled ? equalWeight : 0 };
        });

        return nextModels;
    }, []);

    // Sync to latest market price, unless user explicitly edited it
    useEffect(() => {
        if (currentPrice > 0 && !userEditedPrice) {
            // Round to 2 decimal places to prevent crazy floats like 7186.869725
            setManualPrice(Math.round(currentPrice * 100) / 100);
        }
    }, [currentPrice, userEditedPrice]);

    // Update result if initialData changes
    useEffect(() => {
        if (initialData) setResult(initialData);
    }, [initialData]);

    const handleAssumptionChange = (key: string, value: string) => {
        setAssumptions(prev => ({ ...prev, [key]: parseFloat(value) || 0 }));
    };

    const toggleModel = (key: string) => {
        setModels(prev => {
            // Correct way to update nested state without mutation
            const targetModel = prev[key as keyof typeof models];
            const newModels = {
                ...prev,
                [key]: {
                    ...targetModel,
                    enabled: !targetModel.enabled
                }
            };

            // Recalculate weights
            const enabledCount = Object.values(newModels).filter(m => m.enabled).length;
            const weight = enabledCount > 0 ? 100 / enabledCount : 0;

            Object.keys(newModels).forEach(k => {
                const m = newModels[k as keyof typeof models];
                // Update weights for ALL models based on new count
                // We must create new objects for all of them to update the weight property
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
        justified_ps: models.justified_ps.enabled ? models.justified_ps.weight : 0,
    }), [models]);

    const buildValuationPayload = useCallback((includeComparableLists = false) => ({
        ...assumptions,
        modelWeights: getModelWeights(),
        currentPrice: manualPrice,
        includeComparableLists,
        includeQuality: false,
    }), [assumptions, getModelWeights, manualPrice]);

    const handleFullExport = async () => {
        setExportLoading(true);
        try {
            if (!result) {
                alert('Chưa có dữ liệu định giá để xuất. Vui lòng Analyze trước.');
                return;
            }

            const generator = new ReportGenerator();
            // Export exactly what the user is currently seeing on screen (snapshot).
            await generator.exportReport(stockData || result.metrics || result, result, assumptions, getModelWeights(), symbol);
        } catch (error) {
            console.error('Export error:', error);
            alert('Lỗi xuất báo cáo: ' + (error as any).message);
        } finally {
            setExportLoading(false);
        }
    };

    const handleCalculate = async () => {
        setLoading(true);
        try {
            const data = await calculateValuation(symbol, buildValuationPayload(false));
            if (data && data.success) {
                setResult(data);
                setModels(prev => normalizeEnabledModelWeights(prev, data.valuations));
            }
        } catch (error) {
            console.error('Valuation error:', error);
        } finally {
            setLoading(false);
        }
    };

    // Auto-calculate on mount if data available
    useEffect(() => {
        if (symbol && manualPrice > 0 && !result && !loading) {
            handleCalculate();
        }
    }, [symbol, manualPrice, result]); // eslint-disable-line

    const formatPrice = (val: number) => {
        if (!val) return '-';
        return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(val);
    };

    const getUpside = (target: number) => {
        if (!manualPrice || !target) return 0;
        return ((target - manualPrice) / manualPrice) * 100;
    };

    // Calculate weighted average dynamically on client side to support instant toggling
    const weightedAvg = React.useMemo(() => {
        if (!result?.valuations) return 0;

        let totalVal = 0;
        let totalWeight = 0;

        Object.keys(models).forEach(key => {
            const m = models[key as keyof typeof models];
            if (m.enabled) {
                const val = Number(result.valuations[key] || 0);
                if (val > 0) {
                    totalVal += val * m.weight;
                    totalWeight += m.weight;
                }
            }
        });

        // If totalWeight is close to 100, we divide by 100. If we want re-normalization:
        // totalWeight should mathematically be 100 based on toggle logic, but let's be safe
        return totalWeight > 0 ? totalVal / totalWeight : 0;
    }, [models, result]);

    const finalUpside = getUpside(weightedAvg);
    const activeModelsCount = Object.values(models).filter(m => m.enabled).length;

    const scenarios = result?.scenarios || null;

    // Recalculate each scenario's weighted average using current model toggles/weights
    const calcScenarioWeightedAvg = (sc: any): number => {
        if (!sc?.valuations) return 0;
        let totalVal = 0;
        let totalWeight = 0;
        Object.keys(models).forEach(key => {
            const m = models[key as keyof typeof models];
            if (m.enabled) {
                const val = Number(sc.valuations[key] || 0);
                if (val > 0) {
                    totalVal += val * m.weight;
                    totalWeight += m.weight;
                }
            }
        });
        return totalWeight > 0 ? totalVal / totalWeight : 0;
    };

    const scenarioRows = scenarios
        ? [
            { key: 'bear', label: 'Bear', data: scenarios.bear },
            { key: 'base', label: 'Base', data: scenarios.base },
            { key: 'bull', label: 'Bull', data: scenarios.bull },
        ]
        : [];

    const handleReset = () => {
        setAssumptions(defaultAssumptions);
        setManualPrice(Math.round(currentPrice * 100) / 100 || 0);
        setUserEditedPrice(false);
    };

    return (
        <div className="space-y-6 pb-8">
            <div className="sm:flex sm:items-center sm:justify-between">
                <div>
                    <Title className="font-bold text-gray-900 dark:text-gray-50">Valuation Models</Title>
                    <Text className="mt-1">Customize assumptions and methods to estimate intrinsic value</Text>
                </div>
                <div className="mt-4 sm:mt-0 flex gap-2 w-full sm:w-auto">
                    <Button variant="secondary" onClick={handleReset} icon={RiRefreshLine} className="flex-1 sm:flex-none">
                        Reset
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={handleFullExport}
                        icon={RiFileZipLine}
                        loading={exportLoading}
                        className="flex-1 sm:flex-none"
                    >
                        Full Report
                    </Button>
                    <Button onClick={handleCalculate} loading={loading} className="flex-1 sm:flex-none bg-blue-600 hover:bg-blue-700 border-none text-white font-semibold">
                        Analyze
                    </Button>
                </div>
            </div>

            <Grid numItems={1} numItemsLg={3} className="gap-6">
                {/* Column 1: Assumptions */}
                <Col numColSpan={1}>
                    <Card className="h-full rounded-tremor-default">
                        <Title>Input Assumptions</Title>
                        <div className="mt-6 flex flex-col gap-4">
                            <div>
                                <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Market Data</Text>
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-sm text-gray-600 dark:text-gray-400">Current Price</label>
                                        <div className="mt-1">
                                            <TextInput
                                                type="number"
                                                value={manualPrice.toString()}
                                                onValueChange={(v) => {
                                                    setManualPrice(parseFloat(v) || 0);
                                                    setUserEditedPrice(true);
                                                }}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-sm text-gray-600 dark:text-gray-400">Discount Rate (WACC) %</label>
                                        <div className="mt-1">
                                            <TextInput
                                                type="number"
                                                value={assumptions.wacc.toString()}
                                                onValueChange={(v) => handleAssumptionChange('wacc', v)}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-sm text-gray-600 dark:text-gray-400">Required Return %</label>
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
                                <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Growth Rates</Text>
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-sm text-gray-600 dark:text-gray-400">Revenue Growth %</label>
                                        <div className="mt-1">
                                            <TextInput
                                                type="number"
                                                value={assumptions.revenueGrowth.toString()}
                                                onValueChange={(v) => handleAssumptionChange('revenueGrowth', v)}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-sm text-gray-600 dark:text-gray-400">Terminal Growth %</label>
                                        <div className="mt-1">
                                            <TextInput
                                                type="number"
                                                value={assumptions.terminalGrowth.toString()}
                                                onValueChange={(v) => handleAssumptionChange('terminalGrowth', v)}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-sm text-gray-600 dark:text-gray-400">Tax Rate %</label>
                                        <div className="mt-1">
                                            <TextInput
                                                type="number"
                                                value={assumptions.taxRate.toString()}
                                                onValueChange={(v) => handleAssumptionChange('taxRate', v)}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Card>
                </Col>

                {/* Column 2 & 3: Models & Results */}
                <Col numColSpan={1} numColSpanLg={2}>
                    <div className="flex flex-col gap-6 h-full">
                        {/* Models Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            {(Object.keys(models) as Array<keyof typeof models>).map(key => {
                                const m = models[key];
                                const Icon = m.icon;
                                return (
                                    <div
                                        key={key}
                                        onClick={() => toggleModel(key)}
                                        className={classNames(
                                            "cursor-pointer rounded-tremor-default border p-4 transition-all hover:shadow-sm",
                                            m.enabled
                                                ? "border-blue-500 bg-blue-50/50 ring-1 ring-blue-500 dark:bg-blue-900/20"
                                                : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-800 dark:bg-gray-950"
                                        )}
                                    >
                                        <div className="flex items-start justify-between">
                                            <Icon className={classNames("h-5 w-5", m.enabled ? "text-blue-600" : "text-gray-400")} />
                                            {m.enabled && <div className="h-2 w-2 rounded-full bg-blue-500" />}
                                        </div>
                                        <div className="mt-3">
                                            <p className={classNames("text-sm font-semibold", m.enabled ? "text-blue-700 dark:text-blue-400" : "text-gray-700 dark:text-gray-300")}>
                                                {m.name}
                                            </p>
                                            <p className="mt-1 text-xs text-gray-500 line-clamp-1">{m.desc}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Result Card */}
                        {result && (
                            <Card className="flex-1 flex flex-col justify-between rounded-tremor-default overflow-hidden relative border-none bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-lg p-0">
                                <div className="p-8 relative z-10">
                                    <Text className="text-slate-400 font-medium tracking-wider uppercase text-xs">Intrinsic Value (Projected)</Text>
                                    <div className="mt-2 flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-4">
                                        <span className="text-4xl sm:text-5xl font-bold tracking-tight">
                                            {formatPrice(weightedAvg)}
                                        </span>
                                        <Badge
                                            size="xl"
                                            color={finalUpside >= 0 ? "emerald" : "rose"}
                                            className="font-bold w-fit"
                                        >
                                            {finalUpside > 0 ? '+' : ''}{finalUpside.toFixed(1)}% UPSIDE
                                        </Badge>
                                    </div>
                                    <div className="mt-8 border-t border-slate-700/50 pt-8">
                                        <div className="grid grid-cols-2 gap-8">
                                            <div>
                                                <Text className="text-slate-400 text-xs uppercase mb-1">Recommendation</Text>
                                                <Title className={classNames(
                                                    "text-2xl sm:text-3xl font-black",
                                                    finalUpside >= 15 ? "text-emerald-400" : finalUpside <= -10 ? "text-rose-400" : "text-amber-400"
                                                )}>
                                                    {finalUpside >= 15 ? 'STRONG BUY' : finalUpside >= 5 ? 'ACCUMULATE' : finalUpside <= -10 ? 'SELL' : 'HOLD'}
                                                </Title>
                                            </div>
                                            <div className="text-right">
                                                <Text className="text-slate-400 text-xs uppercase mb-1">Active Models</Text>
                                                <Title className="text-2xl sm:text-3xl font-black text-blue-300">
                                                    {activeModelsCount}
                                                </Title>
                                                <Text className="text-xs text-slate-500 mt-1">Weight-based blend</Text>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Background Decorations */}
                                <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
                                <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
                            </Card>
                        )}
                    </div>
                </Col>
            </Grid>

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
                            const sc = row.data || {};
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
                                                : 'border-rose-200 bg-rose-50/50 dark:border-rose-800 dark:bg-rose-900/20'
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

            {isBank && (
                <Callout
                    title="Bank Valuation Notice"
                    icon={RiErrorWarningFill}
                    color="amber"
                    className="mt-6"
                >
                    For the Banking sector, we strongly recommend prioritizing P/E and P/B Comparables. Traditional cash flow models like FCFE, FCFF, or the Graham formula often fail to accurately reflect value due to the unique capital structures and asset characteristics of financial institutions compared to industrial firms.
                </Callout>
            )}
        </div>
    );
};

// Memoize: only re-render when symbol changes or currentPrice changes by >0.5%
export default React.memo(ValuationTab, (prev, next) => {
    if (prev.symbol !== next.symbol) return false; // re-render on symbol change
    if (prev.isBank !== next.isBank) return false;
    // Skip re-render for tiny price fluctuations (< 0.5% change)
    const priceChanged = prev.currentPrice > 0
        ? Math.abs((next.currentPrice - prev.currentPrice) / prev.currentPrice) > 0.005
        : next.currentPrice !== prev.currentPrice;
    return !priceChanged; // true = skip re-render
});
