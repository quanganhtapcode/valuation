export interface StockHistoryRow {
    time?: string;
    date?: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface StockHistoryPayload { success: boolean; data: StockHistoryRow[] }

/** Decode the bandwidth-saving table format; accept existing row responses too. */
export function decodePriceHistory(raw: unknown): StockHistoryPayload | null {
    if (!raw || typeof raw !== 'object') return null;
    const payload = raw as Record<string, unknown>;
    if (payload.success === false || !Array.isArray(payload.data)) return null;
    if (payload.columns === undefined) {
        if (!payload.data.every(row => row && typeof row === 'object' && !Array.isArray(row))) return null;
        return { ...payload, success: true, data: payload.data as StockHistoryRow[] };
    }
    const columns = payload.columns;
    const required = ['date', 'open', 'high', 'low', 'close', 'volume'];
    if (!Array.isArray(columns) || columns.length !== required.length
        || !required.every(field => columns.includes(field))) return null;
    const rows: StockHistoryRow[] = [];
    for (const values of payload.data) {
        if (!Array.isArray(values) || values.length !== columns.length) return null;
        const row = Object.fromEntries(columns.map((field, i) => [field, values[i]]));
        if (typeof row.date !== 'string'
            || !required.slice(1).every(field => typeof row[field] === 'number' && Number.isFinite(row[field]))) return null;
        rows.push(row as unknown as StockHistoryRow);
    }
    return { ...payload, success: true, data: rows };
}
