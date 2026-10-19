export type HeatmapExchange = 'HSX' | 'HNX' | 'UPCOM';

export interface HeatmapStock {
    ticker: string;
    cap: number;
    change: number;
    price: number;
    name: string;
    sector: string;
}

export interface HeatmapSector {
    name: string;
    shortName: string;
    totalCap: number;
    avgChange: number;
    stocks: HeatmapStock[];
}

export interface HeatmapData {
    sectors: HeatmapSector[];
}
