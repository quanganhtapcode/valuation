/**
 * Public API compatibility exports.
 * Implement feature-specific requests in the corresponding *Api module.
 */

// Re-export types and stock-specific API functions
export * from './types';

export * from './stockApi';

export { API, API_BASE, REALTIME_API_BASE, fetchAPI } from './apiCore';

export { INDEX_MAP } from './marketTypes';

export type { IndicesStreamStatus, MarketIndexData, VciIndexItem } from './marketTypes';

export {
    fetchAllIndices,
    getPricesWsUrl,
    getWsUrl,
    isTradingHours,
    subscribeIndicesStream,
    subscribePricesStream,
} from './marketRealtime';

// Browser refresh cadence for price snapshots and idle polling.
export const PRICE_SYNC_INTERVAL_MS = 15000;

export const IDLE_REFRESH_INTERVAL_MS = 60000;

export { fetchPolymarketEvents } from './polymarketApi';

export type { PolymarketEvent } from './polymarketApi';

// Compatibility exports; new consumers can import their feature module directly.
export * from './newsApi';
export * from './screenerApi';
export * from './foreignFlowApi';
export * from './valuationChartApi';
export * from './overviewApi';
export * from './goldApi';
export * from './lotteryApi';
export * from './earningsApi';
export * from './aiInsightsApi';
export * from './dateFormatters';
export * from './numberFormatters';
