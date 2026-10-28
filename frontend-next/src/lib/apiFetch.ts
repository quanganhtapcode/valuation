import { API_BASE } from './apiConfig';
import contract from './apiContract.json';

export type ApiEnvelope<T> =
    | { data: T; meta?: Record<string, unknown>; error?: never }
    | { error: { code: string; message: string }; data?: never; meta?: never };

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Negotiate by URL, avoiding a custom request header and CORS preflight. */
export function withApiSchema(url: string): string {
    if (!(url.startsWith(`${API_BASE}/`) || url.startsWith('/api/'))) return url;
    const absolute = /^https?:\/\//.test(url);
    const parsed = new URL(url, 'http://api.local');
    if (!parsed.searchParams.has('schema')) parsed.searchParams.set('schema', '2');
    return absolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** Transitional adapter: keep existing feature components out of wire formats. */
export function decodeApiEnvelope(raw: unknown, shape: string): unknown {
    if (!isObject(raw)) throw new TypeError('Invalid API envelope');
    const [kind, ...flags] = shape.split(';');
    if (kind === 'error') return { success: false, error: raw.error };
    if (!('data' in raw)) throw new TypeError('API response is missing data');
    if (kind === 'list' || kind === 'value') return raw.data;
    const meta = isObject(raw.meta) ? raw.meta : {};
    if (contract.collections.includes(kind)) {
        return {
            ...meta, [kind]: raw.data,
            ...(flags.includes('success') ? { success: true } : {}),
            ...(flags.includes('count') && Array.isArray(raw.data) ? { count: raw.data.length } : {}),
        };
    }
    if (!isObject(raw.data)) throw new TypeError('Invalid API resource');
    const result = { ...raw.data };
    const resources = contract.resources as Record<string, { groups: Record<string, Record<string, string>> }>;
    const spec = resources[kind];
    if (spec) {
        for (const [group, mapping] of Object.entries(spec.groups)) {
            const values = result[group];
            if (!isObject(values)) continue;
            for (const [key, original] of Object.entries(mapping)) {
                if (key in values) result[original] = values[key];
            }
            delete result[group];
        }
    } else if (kind !== 'object') {
        throw new TypeError(`Unknown API shape: ${kind}`);
    }
    const book = result.orderbook;
    if (kind === 'quote' && isObject(book) && Array.isArray(book.columns)
        && book.columns.join(',') === 'price,volume'
        && Array.isArray(book.bid) && Array.isArray(book.ask)) {
        result.orderbook = {
            bid: book.bid.map((level: number[]) => ({ price: level[0], volume: level[1] })),
            ask: book.ask.map((level: number[]) => ({ price: level[0], volume: level[1] })),
        };
    }
    for (const [token, duplicate] of Object.entries(contract.duplicate_sets)) {
        if (flags.includes(token) && duplicate.resource === kind && duplicate.canonical in result) {
            for (const alias of duplicate.aliases) result[alias] = result[duplicate.canonical];
        }
    }
    return { ...result, ...meta, ...(flags.includes('success') ? { success: true } : {}) };
}

/** Response facade preserves streaming downloads; only .json() adapts old shapes. */
export class ApiFetchResponse {
    constructor(readonly raw: Response) {}
    get ok() { return this.raw.ok; }
    get status() { return this.raw.status; }
    get statusText() { return this.raw.statusText; }
    get headers() { return this.raw.headers; }
    get url() { return this.raw.url; }
    get body() { return this.raw.body; }
    get bodyUsed() { return this.raw.bodyUsed; }
    get redirected() { return this.raw.redirected; }
    get type() { return this.raw.type; }
    clone() { return new ApiFetchResponse(this.raw.clone()); }
    blob() { return this.raw.blob(); }
    arrayBuffer() { return this.raw.arrayBuffer(); }
    text() { return this.raw.text(); }
    async payload<T>(): Promise<ApiEnvelope<T>> {
        if (this.headers.get('X-API-Schema') !== '2') throw new TypeError('API schema 2 is required');
        return this.raw.json();
    }
    async json(): Promise<any> {
        const value: unknown = await this.raw.json();
        return this.headers.get('X-API-Schema') === '2'
            ? decodeApiEnvelope(value, this.headers.get('X-API-Shape') || '') : value;
    }
}

export async function apiFetch(url: string, options?: RequestInit): Promise<ApiFetchResponse> {
    return new ApiFetchResponse(await fetch(withApiSchema(url), options));
}
