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
    const response = await fetchAPI<any>(`${API.PE_CHART}?metric=${metric}`, options);
    const series = parsePEChartPayload(response);
    const stats = (response?.stats ?? {}) as { pe?: ValuationStats; pb?: ValuationStats };
    return { series, stats };
}

export async function fetchPEChartByRange(
    timeFrame: '6M' | 'YTD' | '1Y' | '2Y' | '5Y' | 'ALL',
    metric: ValuationMetric = 'both',
    options?: RequestInit,
): Promise<PEChartResult> {
    const response = await fetchAPI<any>(`${API.PE_CHART}?metric=${metric}&timeFrame=${timeFrame}`, options);
    const series = parsePEChartPayload(response);
    const stats = (response?.stats ?? {}) as { pe?: ValuationStats; pb?: ValuationStats };
    return { series, stats };
}

export function parsePEChartPayload(response: any): PEChartData[] {
    // New unified format: { data: [{date, vnindex, ema50, pe, pb, volume}] }
    if (Array.isArray(response?.data) && response.data.length > 0) {
        return response.data
            .map((item: any) => {
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
