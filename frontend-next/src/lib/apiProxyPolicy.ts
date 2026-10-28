import { canonicalApiPath } from './apiRouteRegistry';
import cacheRules from './apiCacheRules.json';

export interface ProxyCachePolicy {
    mode: 'realtime' | 'snapshot' | 'short' | 'medium' | 'long';
    revalidateSeconds: number;
    responseCacheControl: string;
}

const policies = cacheRules.policies as Record<ProxyCachePolicy['mode'], ProxyCachePolicy>;

/** Classify compatibility URLs by the same resource as their canonical URL. */
export function normalizeApiPath(path: string): string {
    const resource = canonicalApiPath(path.toLowerCase().replace(/^\/+|\/+$/g, ''))
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
    return canonicalApiPath(resource);
}

export function resolveCachePolicy(path: string, params: URLSearchParams): ProxyCachePolicy {
    const resource = normalizeApiPath(path);
    if (params.get('cache') === 'no-store' || params.get('nocache') === '1'
        || params.has('pretty') || params.get('fetch_price') === 'true') return policies.realtime;

    for (const rule of cacheRules.rules) {
        if (!new RegExp(rule.pattern).test(resource)) continue;
        if ('query' in rule && Object.entries(rule.query ?? {}).some(([key, value]) => params.get(key) !== value)) continue;
        if ('unlessQuery' in rule && Object.entries(rule.unlessQuery ?? {}).every(([key, value]) => params.get(key) === value)) continue;
        return policies[rule.mode as ProxyCachePolicy['mode']];
    }
    return policies.realtime;
}

export function isBulkExport(path: string): boolean {
    return ['exports/financials', 'exports/market', 'workbooks/archive'].includes(normalizeApiPath(path));
}
