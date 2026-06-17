export interface MarketIndexData {
    CurrentIndex: number;
    PrevIndex: number;
    Volume?: number;
    Value?: number;
    Advances?: number;
    Declines?: number;
    NoChanges?: number;
    Ceilings?: number;
    Floors?: number;
}

export interface VciIndexItem {
    symbol: string;
    price: number;
    refPrice: number;
    change?: number;
    changePercent?: number;
    time?: string;
    sendingTime?: string;
    totalShares?: number;
    totalValue?: number;
    totalStockIncrease?: number;
    totalStockDecline?: number;
    totalStockNoChange?: number;
    totalStockCeiling?: number;
    totalStockFloor?: number;
}

export type IndicesStreamStatus = 'open' | 'closed' | 'error';

// Index mapping from CafeF/VCI ids to UI ids.
export const INDEX_MAP: Record<string, { id: string; name: string; vciSymbol: string }> = {
    '1': { id: 'vnindex', name: 'VN-Index', vciSymbol: 'VNINDEX' },
    '2': { id: 'hnx', name: 'HNX-Index', vciSymbol: 'HNXIndex' },
    '9': { id: 'upcom', name: 'UPCOM', vciSymbol: 'HNXUpcomIndex' },
    '11': { id: 'vn30', name: 'VN30', vciSymbol: 'VN30' },
};
