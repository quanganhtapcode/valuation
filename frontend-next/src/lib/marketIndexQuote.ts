export interface MarketIndexQuote {
    value: number;
    change: number;
    percentChange: number;
    isReference: boolean;
}

function positiveNumber(value: unknown): number | null {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

/** A reset price board may expose yesterday's reference before today's first trade. */
export function resolveMarketIndexQuote(current: unknown, previous: unknown): MarketIndexQuote | null {
    const price = positiveNumber(current);
    const reference = positiveNumber(previous);
    if (price === null) {
        return reference === null ? null : {
            value: reference, change: 0, percentChange: 0, isReference: true,
        };
    }
    const change = reference === null ? 0 : price - reference;
    return {
        value: price,
        change,
        percentChange: reference === null ? 0 : change / reference * 100,
        isReference: false,
    };
}
