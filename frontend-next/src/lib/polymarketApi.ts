import { API, fetchAPI } from './apiCore';
import type { PolymarketEvent } from './polymarketSelection';

export type { PolymarketEvent } from './polymarketSelection';

export async function fetchPolymarketEvents(): Promise<PolymarketEvent[]> {
    return fetchAPI<PolymarketEvent[]>(`${API.POLYMARKET_EVENTS}?compact=1`);
}
