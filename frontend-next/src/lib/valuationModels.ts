import type { ValuationResult } from '@/lib/types';

export const VALUATION_MODEL_KEYS = ['fcfe', 'fcff', 'justified_pe', 'justified_pb', 'graham'] as const;
export type ModelKey = typeof VALUATION_MODEL_KEYS[number];
type Selection = Record<ModelKey, { enabled: boolean; weight: number }>;

export function isModelAvailable(key: ModelKey, result?: ValuationResult | null, isBank = false): boolean {
    if ((isBank || result?.inputs?.is_bank) && (key === 'fcfe' || key === 'fcff')) return false;
    const diagnostic = result?.model_diagnostics?.[key];
    if (diagnostic && (!diagnostic.available || !diagnostic.applicable)) return false;
    if (!result?.valuations) return true;
    const value = Number(result.valuations[key]);
    return Number.isFinite(value) && value > 0;
}

export function reconcileModelSelection<T extends Selection>(
    selection: T, result: ValuationResult, preserveSelection = false,
): T {
    const policy = result.inputs?.model_weights as Partial<Record<ModelKey, number>> | undefined;
    const next = { ...selection };
    for (const key of VALUATION_MODEL_KEYS) {
        const enabled = isModelAvailable(key, result) && (preserveSelection ? selection[key].enabled : policy ? Number(policy[key]) > 0 : selection[key].enabled);
        const weight = enabled ? Number((preserveSelection ? selection[key].weight : policy?.[key]) ?? selection[key].weight) : 0;
        next[key] = { ...selection[key], enabled, weight: Number.isFinite(weight) && weight > 0 ? weight : 0 };
    }
    const total = VALUATION_MODEL_KEYS.reduce((sum, key) => sum + next[key].weight, 0);
    const enabled = VALUATION_MODEL_KEYS.filter(key => next[key].enabled);
    for (const key of VALUATION_MODEL_KEYS) {
        next[key] = { ...next[key], weight: !next[key].enabled ? 0 : total > 0 ? next[key].weight * 100 / total : 100 / enabled.length };
    }
    return next;
}

export function weightedValuation(
    values: Partial<Record<ModelKey, number>> | undefined, weights: Partial<Record<ModelKey, number>>,
): number {
    let sum = 0;
    let total = 0;
    for (const key of VALUATION_MODEL_KEYS) {
        const value = Number(values?.[key]);
        const weight = Number(weights[key]);
        if (Number.isFinite(value) && value > 0 && Number.isFinite(weight) && weight > 0) {
            sum += value * weight;
            total += weight;
        }
    }
    return total > 0 ? sum / total : 0;
}
