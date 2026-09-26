import { API, fetchAPI } from './apiCore';
import type { TopMoverItem } from './overviewApi';

export interface ForeignNetItem {
    Symbol: string;
    CompanyName: string;
    CurrentPrice: number;
    ChangePricePercent: number;
    Exchange: string;
    Value: number;  // net buy value (always positive — context determines buy vs sell)
}

/** One minute-bar from ForeignVolumeChart/getAll */
export interface ForeignVolumePoint {
    time: string;          // "HH:MM" e.g. "09:15"
    buyVolume: number;
    sellVolume: number;
    buyValue: number;
    sellValue: number;
    /** cumulative buy volume from 09:00 to this minute */
    cumBuyVolume?: number;
    /** cumulative sell volume from 09:00 to this minute */
    cumSellVolume?: number;
    /** cumulative buy value */
    cumBuyValue?: number;
    /** cumulative sell value */
    cumSellValue?: number;
}

/**
 * Fetch foreign investor flow
 */
export async function fetchForeignFlow(type: 'buy' | 'sell'): Promise<TopMoverItem[]> {
    interface ForeignFlowResponse {
        Data?: TopMoverItem[];
    }
    const response = await fetchAPI<ForeignFlowResponse>(
        `${API.FOREIGN_FLOW}?type=${type}`
    );
    return response.Data || [];
}

/**
 * Fetch full foreign net-value lists (for /foreign page)
 */
export async function fetchForeignNetValue(): Promise<{
    buyList: ForeignNetItem[];
    sellList: ForeignNetItem[];
}> {
    interface Resp { buyList?: ForeignNetItem[]; sellList?: ForeignNetItem[] }
    const r = await fetchAPI<Resp>(API.FOREIGN_NET_VALUE);
    return { buyList: r.buyList || [], sellList: r.sellList || [] };
}

/**
 * Fetch intraday foreign volume chart (minute bars, 09:00–15:00).
 * Adds cumulative sums so the chart can render both bar and area views.
 */
export async function fetchForeignVolumeChart(): Promise<ForeignVolumePoint[]> {
    interface Resp { data?: any[] }
    const r = await fetchAPI<Resp>(API.FOREIGN_VOLUME_CHART);
    const raw = r.data || [];

    // Normalize unknown VCI field names → ForeignVolumePoint
    const points: ForeignVolumePoint[] = raw.map((item: any) => {
        // time: VCI may give unix timestamp (ms or s), or "HH:MM" string
        let time = '';
        const t = item.time ?? item.t ?? item.timestamp ?? item.tradingTime ?? '';
        if (typeof t === 'number') {
            const ms = t > 1e10 ? t : t * 1000;
            const d = new Date(ms);
            time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        } else {
            // "09:15" or "091500" or ISO string
            const s = String(t);
            if (s.includes(':')) time = s.slice(0, 5);
            else if (s.length >= 4) time = `${s.slice(0, 2)}:${s.slice(2, 4)}`;
            else time = s;
        }
        return {
            time,
            buyVolume:  Number(item.buyVolume  ?? item.foreignBuyVolume  ?? item.fBuyVol  ?? 0),
            sellVolume: Number(item.sellVolume  ?? item.foreignSellVolume ?? item.fSellVol ?? 0),
            buyValue:   Number(item.buyValue    ?? item.foreignBuyValue   ?? item.fBuyVal  ?? 0),
            sellValue:  Number(item.sellValue   ?? item.foreignSellValue  ?? item.fSellVal ?? 0),
        };
    });

    // Filter to trading session 09:00–15:00 and sort
    const session = points
        .filter(p => p.time >= '09:00' && p.time <= '15:00')
        .sort((a, b) => a.time.localeCompare(b.time));

    // Build cumulative sums
    let cumBuyVol = 0, cumSellVol = 0, cumBuyVal = 0, cumSellVal = 0;
    return session.map(p => {
        cumBuyVol  += p.buyVolume;
        cumSellVol += p.sellVolume;
        cumBuyVal  += p.buyValue;
        cumSellVal += p.sellValue;
        return { ...p, cumBuyVolume: cumBuyVol, cumSellVolume: cumSellVol, cumBuyValue: cumBuyVal, cumSellValue: cumSellVal };
    });
}
