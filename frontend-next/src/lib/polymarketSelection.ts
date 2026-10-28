export interface PolymarketEvent {
    id: string;
    title: string;
    url?: string;
    outcomes: Array<{
        label: string;
        probability?: number;
        change?: number;
    }>;
    volume?: number;
    marketCount?: number;
    endDate?: string;
}
