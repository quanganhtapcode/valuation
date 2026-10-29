import { apiFetch } from '@/lib/apiFetch';
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
        const response = await apiFetch(`${backendApi}/${backendApiPath(pathname)}${query ? `?${query}` : ''}`, options);
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

/** Start all requests together; each section can stream without waiting for its siblings. */
export function getOverviewPageSnapshots(backendApi: string) {
    const indices = resource<VciIndexItem[]>(backendApi, 'market/indices', 15);
    const chart = resource<unknown>(backendApi, 'market/index-valuations?metric=both&timeFrame=1Y&compact=1&snapshot=1', 60, 800);
    const heatmap = resource<HeatmapData>(backendApi, 'market/heatmap?exchange=HSX&limit=200', 15);
    const news = resource<{ data?: NewsItem[] }>(backendApi, 'market/news?page=1&size=30&compact=1', 60, 800);
    const gainers = resource<{ Data?: TopMoverItem[] }>(backendApi, 'market/top-movers?centerID=HOSE&type=UP', 15, 800);
    const losers = resource<{ Data?: TopMoverItem[] }>(backendApi, 'market/top-movers?centerID=HOSE&type=DOWN', 15, 800);
    const gold = resource<{ data?: GoldPriceItem[]; source?: string; stale?: boolean }>(backendApi, 'market/gold', 60, 800);
    return {
        market: Promise.all([indices, chart]).then(([indices, chart]) => ({
            initialIndices: mapIndices(indices?.data || []),
            // Keep compact columns/rows on the wire. Dates are parsed once in the client.
            initialChart: chart?.data ?? null,
        })),
        heatmap: heatmap.then(result => {
            const data = Array.isArray(result?.data?.sectors) && result.data.sectors.length > 0 ? result.data : null;
            return { initialData: data, initialFetchedAt: data ? result!.fetchedAt : 0 };
        }),
        news: news.then(result => ({
            initialNews: Array.isArray(result?.data?.data) ? result.data.data : [],
            initialNewsFetchedAt: result?.fetchedAt || 0,
        })),
        movers: Promise.all([gainers, losers]).then(([gainers, losers]) => ({
            initialGainers: Array.isArray(gainers?.data?.Data) ? gainers.data.Data : [],
            initialLosers: Array.isArray(losers?.data?.Data) ? losers.data.Data : [],
            initialMoversFetchedAt: Math.min(gainers?.fetchedAt || 0, losers?.fetchedAt || 0),
        })),
        gold: gold.then(result => ({
            initialGoldPrices: Array.isArray(result?.data?.data) ? result.data.data : [],
            initialGoldSource: result?.data?.source || 'Phú Quý',
            initialGoldStale: Boolean(result?.data?.stale),
            initialGoldFetchedAt: result?.fetchedAt || 0,
        })),
    };
}
