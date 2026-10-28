import { backendApiPath } from './apiRouteRegistry';
import { backendRequestHeaders } from './backendRequestHeaders';
import { INDEX_MAP, type VciIndexItem } from './marketTypes';
import { resolveMarketIndexQuote } from './marketIndexQuote';
import type { HeatmapData } from './heatmapTypes';
import type { NewsItem } from './newsApi';
import type { TopMoverItem } from './overviewApi';
import type { GoldPriceItem } from './goldApi';

const SNAPSHOT_TIMEOUT_MS = 2500;

async function resource<T>(backendApi: string, path: string, revalidate: number, timeout = SNAPSHOT_TIMEOUT_MS) {
    const [pathname, query] = path.split('?');
    try {
        const options: RequestInit & { next: { revalidate: number } } = {
            headers: { ...backendRequestHeaders, Accept: 'application/json' },
            next: { revalidate },
            signal: AbortSignal.timeout(timeout),
        };
        const response = await fetch(`${backendApi}/${backendApiPath(pathname)}${query ? `?${query}` : ''}`, options);
        if (!response.ok) return null;
        const data: T = await response.json();
        // Keep the age of responses served from Next's persistent data cache.
        const date = Date.parse(response.headers.get('date') || '');
        return { data, fetchedAt: Number.isFinite(date) ? Math.min(Date.now(), date) : Date.now() };
    } catch {
        // A missing source must not prevent the other panels from rendering.
        return null;
    }
}

function mapIndices(items: VciIndexItem[]) {
    if (!Array.isArray(items)) return [];
    return Object.values(INDEX_MAP).flatMap(info => {
        const item = items.find(row => row?.symbol?.toUpperCase() === info.vciSymbol.toUpperCase());
        if (!item) return [];
        const quote = resolveMarketIndexQuote(item.price, item.refPrice);
        if (!quote) return [];
        return [{
            id: info.id, name: info.name, ...quote,
            chartData: [] as number[],
            advances: item.totalStockIncrease, declines: item.totalStockDecline,
            noChanges: item.totalStockNoChange, ceilings: item.totalStockCeiling,
            floors: item.totalStockFloor, totalShares: item.totalShares,
            totalValue: item.totalValue,
        }];
    });
}

/** Fetch lightweight resources together, without the bundled chart request. */
export async function getOverviewPageSnapshot(backendApi: string) {
    const [indices, heatmap, news, gainers, losers, gold] = await Promise.all([
        resource<VciIndexItem[]>(backendApi, 'market/indices', 15),
        resource<HeatmapData>(backendApi, 'market/heatmap?exchange=HSX&limit=200', 15),
        resource<{ data?: NewsItem[] }>(backendApi, 'market/news?page=1&size=30&compact=1', 60, 800),
        resource<{ Data?: TopMoverItem[] }>(backendApi, 'market/top-movers?centerID=HOSE&type=UP', 15, 800),
        resource<{ Data?: TopMoverItem[] }>(backendApi, 'market/top-movers?centerID=HOSE&type=DOWN', 15, 800),
        resource<{ data?: GoldPriceItem[]; source?: string; stale?: boolean }>(backendApi, 'market/gold', 60, 800),
    ]);
    const initialHeatmap = Array.isArray(heatmap?.data?.sectors) && heatmap.data.sectors.length > 0
        ? heatmap.data : null;
    return {
        initialIndices: mapIndices(indices?.data || []),
        initialHeatmap,
        initialHeatmapFetchedAt: initialHeatmap ? heatmap!.fetchedAt : 0,
        initialNews: Array.isArray(news?.data?.data) ? news.data.data : [],
        initialNewsFetchedAt: news?.fetchedAt || 0,
        initialGainers: Array.isArray(gainers?.data?.Data) ? gainers.data.Data : [],
        initialLosers: Array.isArray(losers?.data?.Data) ? losers.data.Data : [],
        initialMoversFetchedAt: Math.min(gainers?.fetchedAt || 0, losers?.fetchedAt || 0),
        initialGoldPrices: Array.isArray(gold?.data?.data) ? gold.data.data : [],
        initialGoldSource: gold?.data?.source || 'Phú Quý',
        initialGoldStale: Boolean(gold?.data?.stale),
        initialGoldFetchedAt: gold?.fetchedAt || 0,
    };
}
