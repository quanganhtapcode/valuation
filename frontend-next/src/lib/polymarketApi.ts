import { API, fetchAPI } from './apiCore';

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

const MACRO_EVENT_PATTERN = /\b(fed|fomc|federal reserve|interest rate|rate cut|rate hike|central bank|ecb|bank of england|bank of japan|boj|cpi|inflation|jobs report|nonfarm|unemployment|gdp|recession|treasury|yield|tariff|trade deal|wti|crude oil|brent|gold|silver)\b/i;

function eventTopic(title: string): string {
    const normalized = title.toLowerCase();
    if (/fed|fomc|federal reserve|interest rate|rate cut|rate hike/.test(normalized)) return 'fed';
    if (/treasury|yield/.test(normalized)) return 'treasury-yields';
    if (/cpi|inflation/.test(normalized)) return 'inflation';
    if (/jobs report|nonfarm|unemployment/.test(normalized)) return 'employment';
    if (/gdp|recession/.test(normalized)) return 'growth';
    if (/wti|crude oil|brent|oil|gold|silver/.test(normalized)) return 'commodities';
    if (/tariff|trade deal/.test(normalized)) return 'trade';
    return `event:${normalized}`;
}

function isFedDecision(title: string): boolean {
    return /fed decision|fomc decision/.test(title.toLowerCase());
}

interface GammaMarket {
    question?: string;
    groupItemTitle?: string;
    outcomes?: string;
    outcomePrices?: string;
    volume24hr?: number;
    liquidityNum?: number;
    oneDayPriceChange?: number;
    active?: boolean;
    closed?: boolean;
    acceptingOrders?: boolean;
}

interface GammaEvent {
    id: string | number;
    title?: string;
    slug?: string;
    volume24hr?: number;
    volume?: number;
    liquidity?: number;
    endDate?: string;
    markets?: GammaMarket[];
}

function parseStringArray(value?: string): string[] {
    if (!value) return [];
    try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

function yesProbability(market: GammaMarket): number {
    const labels = parseStringArray(market.outcomes);
    const prices = parseStringArray(market.outcomePrices).map(Number);
    const yesIndex = labels.findIndex((label) => label.toLowerCase() === 'yes');
    const price = prices[yesIndex >= 0 ? yesIndex : 0];
    return Number.isFinite(price) && price >= 0 && price <= 1 ? price : -1;
}

export async function fetchPolymarketEvents(): Promise<PolymarketEvent[]> {
    const payload = await fetchAPI<GammaEvent[]>(API.POLYMARKET_EVENTS);
    const activeEvents = payload
        .filter((event) => event.title && event.slug && event.markets?.some((market) => market.active && !market.closed && market.acceptingOrders !== false))
        .sort((a, b) => (b.volume || 0) - (a.volume || 0) || (b.volume24hr || 0) - (a.volume24hr || 0));
    const macroEvents = activeEvents.filter((event) => MACRO_EVENT_PATTERN.test(event.title!));
    const topicLeaders = new Map<string, GammaEvent>();
    for (const event of macroEvents) {
        const topic = eventTopic(event.title!);
        const current = topicLeaders.get(topic);
        if (!current ||
            (topic === 'fed' && isFedDecision(event.title!) && !isFedDecision(current.title!)) ||
            (isFedDecision(event.title!) === isFedDecision(current.title!) && (event.volume || 0) > (current.volume || 0))) {
            topicLeaders.set(topic, event);
        }
    }
    const selected = [
        ...Array.from(topicLeaders.values()).sort((a, b) => (b.volume || 0) - (a.volume || 0)),
        ...activeEvents.filter((event) => !MACRO_EVENT_PATTERN.test(event.title!)),
    ].slice(0, 3);

    return selected.map((event) => {
        const markets = (event.markets || [])
            .filter((item) => item.active && !item.closed && item.acceptingOrders !== false)
            .sort((a, b) => {
                const probabilityDifference = yesProbability(b) - yesProbability(a);
                return probabilityDifference || (b.volume24hr || b.liquidityNum || 0) - (a.volume24hr || a.liquidityNum || 0);
            });
        const outcomes = markets.slice(0, 3).map((market) => {
            const labels = parseStringArray(market.outcomes);
            const prices = parseStringArray(market.outcomePrices).map(Number);
            const yesIndex = labels.findIndex((label) => label.toLowerCase() === 'yes');
            const probability = prices[yesIndex >= 0 ? yesIndex : 0];
            return {
                label: market.groupItemTitle || market.question || labels[yesIndex >= 0 ? yesIndex : 0] || 'Outcome',
                probability: Number.isFinite(probability) && probability >= 0 && probability <= 1 ? probability * 100 : undefined,
                change: typeof market.oneDayPriceChange === 'number' && Number.isFinite(market.oneDayPriceChange) ? market.oneDayPriceChange * 100 : undefined,
            };
        });

        return {
            id: String(event.id),
            title: event.title!,
            url: `https://polymarket.com/event/${event.slug}`,
            outcomes,
            volume: event.volume,
            marketCount: markets.length,
            endDate: event.endDate,
        };
    });
}

