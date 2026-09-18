import 'server-only';
import { INDEX_MAP, type VciIndexItem } from './marketTypes';

/** Small shared snapshot for first paint; the browser then subscribes to live data. */
export async function getOverviewSnapshot() {
    const base = process.env.NODE_ENV === 'development'
        ? (process.env.BACKEND_API_URL_LOCAL || 'http://127.0.0.1:8000/api')
        : (process.env.BACKEND_API_URL || 'https://api.quanganh.org/v1/valuation');
    try {
        const response = await fetch(`${base.replace(/\/$/, '')}/market/vci-indices`, {
            next: { revalidate: 15 },
            signal: AbortSignal.timeout(800),
        });
        if (!response.ok) return [];
        const items: VciIndexItem[] = await response.json();
        if (!Array.isArray(items)) return [];
        return Object.values(INDEX_MAP).flatMap(info => {
            const item = items.find(row => row?.symbol?.toUpperCase() === info.vciSymbol.toUpperCase());
            if (!item || !Number.isFinite(Number(item.price)) || Number(item.price) <= 0) return [];
            const value = Number(item.price);
            const previous = Number(item.refPrice) || value;
            const change = value - previous;
            return [{
                id: info.id, name: info.name, value, change,
                percentChange: previous > 0 ? change / previous * 100 : 0,
                chartData: [] as number[],
                advances: item.totalStockIncrease, declines: item.totalStockDecline,
                noChanges: item.totalStockNoChange, ceilings: item.totalStockCeiling,
                floors: item.totalStockFloor, totalShares: item.totalShares,
                totalValue: item.totalValue,
            }];
        });
    } catch {
        // An unavailable backend must not block the page; client fallback stays active.
        return [];
    }
}
