import { API, fetchAPI } from './apiCore';
import { parseDateInput } from './dateFormatters';

export interface ValuationStats {
    average: number;
    plusOneSD: number;
    plusTwoSD: number;
    minusOneSD: number;
    minusTwoSD: number;
}

export interface PEChartData {
    date: Date;
    pe: number | null;
    pb: number | null;
    vnindex: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    ema50: number | null;
    volume: number | null;
}

export interface PEChartResult {
    series: PEChartData[];
    stats: { pe?: ValuationStats; pb?: ValuationStats };
}

/**
 * Fetch P/E chart historical data
 */
export type ValuationMetric = 'pe' | 'pb' | 'both';

export async function fetchPEChart(
    metric: ValuationMetric = 'both',
    options?: RequestInit,
): Promise<PEChartResult> {
    const response = await fetchAPI<any>(`${API.INDEX_VALUATIONS}?metric=${metric}&compact=1&snapshot=1`, options);
    const series = parsePEChartPayload(response);
    const stats = (response?.stats ?? {}) as { pe?: ValuationStats; pb?: ValuationStats };
    return { series, stats };
}

const rangeCache = new Map<string, { expires: number; result: PEChartResult }>();
const rangeRequests = new Map<string, Promise<PEChartResult>>();

/** A prefetch and a user pan share one request; cancelling one subscriber is safe. */
function withSubscriberSignal<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        promise.then(value => {
            signal.removeEventListener('abort', abort);
            if (!signal.aborted) resolve(value);
        }, error => {
            signal.removeEventListener('abort', abort);
            reject(error);
        });
    });
}

export async function fetchPEChartByRange(
    timeFrame: '6M' | 'YTD' | '1Y' | '2Y' | '5Y' | 'ALL',
    metric: ValuationMetric = 'both',
    options?: RequestInit,
): Promise<PEChartResult> {
    const key = `${timeFrame}:${metric}`;
    const cached = rangeCache.get(key);
    if (cached && cached.expires > Date.now()) {
        return withSubscriberSignal(Promise.resolve(cached.result), options?.signal);
    }
    let pending = rangeRequests.get(key);
    if (!pending) {
        pending = (async () => {
            const response = await fetchAPI<any>(`${API.INDEX_VALUATIONS}?metric=${metric}&timeFrame=${timeFrame}&compact=1&snapshot=1`, {
                ...options, signal: AbortSignal.timeout(15_000),
            });
            const result = { series: parsePEChartPayload(response), stats: (response?.stats ?? {}) as PEChartResult['stats'] };
            if (rangeCache.size >= 18) rangeCache.delete(rangeCache.keys().next().value!);
            rangeCache.set(key, { expires: Date.now() + 30_000, result });
            return result;
        })();
        rangeRequests.set(key, pending);
        pending.then(() => rangeRequests.delete(key), () => rangeRequests.delete(key));
    }
    return withSubscriberSignal(pending, options?.signal);
}

export function parsePEChartPayload(response: any): PEChartData[] {
    // New unified format: { data: [{date, vnindex, ema50, pe, pb, volume}] }
    if (Array.isArray(response?.data) && response.data.length > 0) {
        return response.data
            .map((raw: any) => {
                // Older backends return objects even when compact=1 is sent.
                const item = Array.isArray(raw) && Array.isArray(response.columns)
                    ? Object.fromEntries(response.columns.map((column: string, index: number) => [column, raw[index]]))
                    : raw;
                const date = parseDateInput(item?.date);
                if (!date) return null;
                return {
                    date,
                    vnindex: item.vnindex != null ? Number(item.vnindex) : null,
                    open:    item.open    != null ? Number(item.open)    : null,
                    high:    item.high    != null ? Number(item.high)    : null,
                    low:     item.low     != null ? Number(item.low)     : null,
                    close:   item.close   != null ? Number(item.close)   : null,
                    ema50:   item.ema50   != null ? Number(item.ema50)   : null,
                    pe:      item.pe      != null ? Number(item.pe)      : null,
                    pb:      item.pb      != null ? Number(item.pb)      : null,
                    volume:  item.volume  != null ? Number(item.volume)  : null,
                } as PEChartData;
            })
            .filter((row: PEChartData | null): row is PEChartData => row !== null);
    }

    // Legacy CafeF fallback
    if (!response?.Data?.DataChart || !Array.isArray(response.Data.DataChart)) {
        return [];
    }
    const data = response.Data.DataChart.map((p: { TimeStamp: number; Index: number; Pe: number }) => ({
        date: new Date(p.TimeStamp * 1000),
        vnindex: p.Index,
        pe: p.Pe,
        pb: null,
        ema50: null,
        volume: null,
    }));
    if (data.length > 1 && data[0].date > data[1].date) data.reverse();
    return data;
}
