import { canonicalApiPath } from './apiRouteRegistry';

export interface ProxyCachePolicy {
    mode: 'realtime' | 'snapshot' | 'short' | 'medium' | 'long';
    revalidateSeconds: number;
    responseCacheControl: string;
}

const policies: Record<ProxyCachePolicy['mode'], ProxyCachePolicy> = {
    realtime: { mode: 'realtime', revalidateSeconds: 0, responseCacheControl: 'no-store' },
    snapshot: { mode: 'snapshot', revalidateSeconds: 5, responseCacheControl: 'public, max-age=0, s-maxage=5, stale-while-revalidate=10' },
    short: { mode: 'short', revalidateSeconds: 30, responseCacheControl: 'public, s-maxage=30, stale-while-revalidate=60' },
    medium: { mode: 'medium', revalidateSeconds: 120, responseCacheControl: 'public, s-maxage=120, stale-while-revalidate=300' },
    long: { mode: 'long', revalidateSeconds: 600, responseCacheControl: 'public, s-maxage=600, stale-while-revalidate=1200' },
};

/** Classify compatibility URLs by the same resource as their canonical URL. */
export function normalizeApiPath(path: string): string {
    return canonicalApiPath(path.toLowerCase().replace(/^\/+|\/+$/g, ''))
        .replace(/^stock\/history\/([^/]+)$/, 'stocks/$1/price-history')
        .replace(/^(?:stock\/)?peers-vci\/([^/]+)$/, 'stocks/$1/peer-valuations')
        .replace(/^stock\/peers\/([^/]+)$/, 'stocks/$1/peers')
        .replace(/^(?:stock\/)?vci-feed\/([^/]+)$/, 'stocks/$1/feed')
        .replace(/^(?:stock\/)?holders\/([^/]+)$/, 'stocks/$1/shareholders')
        .replace(/^(?:current-price|price)\/([^/]+)$/, 'stocks/$1/quote')
        .replace(/^(?:stock\/)?batch-price$/, 'stocks/quotes')
        .replace(/^batch-overview$/, 'stocks/overviews')
        .replace(/^company\/profile\/([^/]+)$/, 'companies/$1/profile')
        .replace(/^(news|events)\/([^/]+)$/, 'stocks/$2/$1')
        .replace(/^valuation\/([^/]+)(.*)$/, 'stocks/$1/valuation$2')
        .replace(/^historical-chart-data\/([^/]+)$/, 'stocks/$1/chart-data')
        .replace(/^ratio-daily-history\/([^/]+)$/, 'stocks/$1/valuation-history')
        .replace(/^financial-report-metrics\/([^/]+)$/, 'stocks/$1/financial-statements/fields')
        .replace(/^financial-report\/([^/]+)$/, 'stocks/$1/financial-statements')
        .replace(/^stock\//, 'stocks/')
        .replace(/\/financial-report-metrics$/, '/financial-statements/fields')
        .replace(/\/financial-report$/, '/financial-statements')
        .replace(/\/historical-chart-data$/, '/chart-data')
        .replace(/\/ratio-daily-history$/, '/valuation-history')
        .replace(/^stocks\/stats-financial(\/icb-l3-sectors)?$/, (_, sectors) =>
            `stocks/financial-metrics${sectors ? '/sectors' : ''}`)
        .replace(/\/current-price$/, '/quote')
        .replace(/\/overview-full$/, '/overview')
        .replace(/^market\/vci-indices$/, 'market/indices')
        .replace(/^market\/index-history$/, 'market/indices/history')
        .replace(/^market\/(?:pe-chart|index-valuation-chart)$/, 'market/index-valuations')
        .replace(/^market\/overview-refresh$/, 'market/overview');
}

export function resolveCachePolicy(path: string, params: URLSearchParams): ProxyCachePolicy {
    const resource = normalizeApiPath(path);
    const legacy = path.toLowerCase();
    if (params.get('cache') === 'no-store' || params.get('nocache') === '1'
        || params.has('pretty') || params.get('fetch_price') === 'true') return policies.realtime;

    // Share a brief heatmap snapshot at the edge without retaining it in browsers.
    if (resource === 'market/heatmap') return policies.snapshot;
    if (/^stocks\/financial-metrics(?:\/sectors)?$/.test(resource)) return policies.medium;

    // Quotes and snapshots that contain quotes must observe the current RAM cache.
    // Unknown resources also stay uncached until they have an explicit policy.
    if (/^stocks\/(?:quotes|overviews)$/.test(resource)
        || /^stocks\/[^/]+(?:\/(?:quote|overview|price-history|freshness|workbook|report-file))?$/.test(resource)
        || /^stocks\/[^/]+\/summary$/.test(resource) && params.get('realtime') !== '0'
        || /^(?:health$|cache\/|financial-statements\/(?:exports|workbooks)(?:\/|$))/.test(resource)
        || /^(?:stock\/excel|stocks\/excel|download\/|financial-bulk-export)/.test(legacy)
        || /^(?:market\/(?:indices|top-movers|prices|orderbook|overview|screener|ai-takeaways)|market\/macro\/rates)$/.test(resource)) {
        return policies.realtime;
    }
    if (/^market\/(?:news|funds)(?:\/|$)/.test(resource)
        || /^stocks\/[^/]+\/(?:news|events|feed|shareholders|valuation)(?:\/|$)/.test(resource)) return policies.short;
    if (resource === 'tickers' || /^companies\/[^/]+\/profile$/.test(resource)
        || /^stocks\/[^/]+\/profile$/.test(resource)) return policies.long;
    if (/^stocks\//.test(resource) || /^app-data\//.test(resource)
        || /^(?:market\/(?:index-valuations|indices\/history|lottery)|financial-statements\/years)$/.test(resource)) return policies.medium;
    return policies.realtime;
}

export function isBulkExport(path: string): boolean {
    return ['financial-bulk-export', 'stock/excel-bulk', 'financial-statements/exports',
        'financial-statements/workbooks/archive'].includes(path.toLowerCase());
}
