export interface LiveQuote {
    time: string;
    price: number;
    volume: number;
    open?: number;
    high?: number;
    low?: number;
}

export interface DailyCandle {
    time: string | number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

// Quotes currently lack an exchange session date. Before opening, and on
// weekends, associate snapshots with the last possible trading session.
export function quoteSessionDate(now = new Date()): string {
    const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    if (vn.getUTCHours() < 9) vn.setUTCDate(vn.getUTCDate() - 1);
    while (vn.getUTCDay() === 0 || vn.getUTCDay() === 6) {
        vn.setUTCDate(vn.getUTCDate() - 1);
    }
    return vn.toISOString().slice(0, 10);
}

export function mergeLiveCandle(latest: DailyCandle | undefined, quote: LiveQuote): DailyCandle | null {
    if (!Number.isFinite(quote.price) || quote.price <= 0) return null;
    const latestDay = latest ? new Date(latest.time).toISOString().slice(0, 10) : '';
    if (latestDay > quote.time) return null;
    const existing = latestDay === quote.time ? latest : undefined;
    const positive = (value: number | undefined): value is number =>
        typeof value === 'number' && Number.isFinite(value) && value > 0;
    return {
        time: quote.time,
        open: existing?.open || (positive(quote.open) ? quote.open : quote.price),
        high: Math.max(...[existing?.high, quote.high, quote.price].filter(positive)),
        low: Math.min(...[existing?.low, quote.low, quote.price].filter(positive)),
        close: quote.price,
        volume: Math.max(existing?.volume || 0, quote.volume || 0),
    };
}
