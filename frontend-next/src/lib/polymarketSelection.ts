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
    return /\b(?:fed|fomc) decision in\b/i.test(title);
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
    endDate?: string;
}

export interface GammaEvent {
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

function hasNotExpired(endDate: string | undefined, now: Date): boolean {
    const expiry = endDate ? Date.parse(endDate) : NaN;
    return !Number.isFinite(expiry) || expiry > now.getTime();
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function monthlyPeriod(event: GammaEvent, now: Date): number | undefined {
    // Monthly contracts should roll over even while the previous month awaits settlement.
    const match = event.title?.match(/\bin (january|february|march|april|may|june|july|august|september|october|november|december)\b(?:\s+(\d{4})\b)?/i);
    if (!match) return undefined;
    const month = MONTH_NAMES.indexOf(match[1].toLowerCase());
    const expiry = event.endDate ? new Date(event.endDate) : now;
    const reference = Number.isFinite(expiry.getTime()) ? expiry : now;
    const year = match[2] ? Number(match[2]) : reference.getUTCFullYear() - (month > reference.getUTCMonth() ? 1 : 0);
    return year * 12 + month;
}

function monthlyPeriodPriority(event: GammaEvent, now: Date): number {
    const period = monthlyPeriod(event, now);
    if (period === undefined) return 0;
    const currentPeriod = now.getUTCFullYear() * 12 + now.getUTCMonth();
    return period === currentPeriod ? 2 : period > currentPeriod ? 1 : -1;
}

export function selectPolymarketEvents(payload: GammaEvent[], now: Date = new Date()): PolymarketEvent[] {
    const isOpenMarket = (market: GammaMarket) => market.active && !market.closed && market.acceptingOrders !== false && hasNotExpired(market.endDate, now);
    const activeEvents = payload
        .filter((event) => event.title && event.slug && hasNotExpired(event.endDate, now) && event.markets?.some(isOpenMarket))
        .filter((event) => !['commodities', 'treasury-yields', 'fed'].includes(eventTopic(event.title!)) || monthlyPeriodPriority(event, now) >= 0)
        .sort((a, b) => (b.volume || 0) - (a.volume || 0) || (b.volume24hr || 0) - (a.volume24hr || 0));
    const macroEvents = activeEvents.filter((event) => MACRO_EVENT_PATTERN.test(event.title!));
    const topicLeaders = new Map<string, GammaEvent>();
    for (const event of macroEvents) {
        const topic = eventTopic(event.title!);
        const current = topicLeaders.get(topic);
        if (current && topic === 'fed') {
            const decisionDifference = Number(isFedDecision(event.title!)) - Number(isFedDecision(current.title!));
            if (decisionDifference > 0) topicLeaders.set(topic, event);
            if (decisionDifference !== 0) continue;
            if (isFedDecision(event.title!)) {
                const deadlineDifference = (Date.parse(event.endDate || '') || Infinity) - (Date.parse(current.endDate || '') || Infinity);
                if (deadlineDifference < 0) topicLeaders.set(topic, event);
                if (Number.isFinite(deadlineDifference) && deadlineDifference !== 0) continue;
            }
        }
        if (current && topic === 'treasury-yields') {
            const tenorDifference = Number(/\b10[- ]year\b/i.test(event.title!)) - Number(/\b10[- ]year\b/i.test(current.title!));
            if (tenorDifference > 0) topicLeaders.set(topic, event);
            if (tenorDifference !== 0) continue;
        }
        if (current && ['commodities', 'treasury-yields'].includes(topic)) {
            const periodDifference = monthlyPeriodPriority(event, now) - monthlyPeriodPriority(current, now);
            if (periodDifference > 0) topicLeaders.set(topic, event);
            if (periodDifference !== 0) continue;
            const nextPeriodDifference = (monthlyPeriod(event, now) ?? Infinity) - (monthlyPeriod(current, now) ?? Infinity);
            if (Number.isFinite(nextPeriodDifference) && nextPeriodDifference !== 0) {
                if (nextPeriodDifference < 0) topicLeaders.set(topic, event);
                continue;
            }
        }
        if (!current ||
            (topic === 'fed' && isFedDecision(event.title!) && !isFedDecision(current.title!)) ||
            (isFedDecision(event.title!) === isFedDecision(current.title!) && (event.volume || 0) > (current.volume || 0))) {
            topicLeaders.set(topic, event);
        }
    }
    const selected = [
        ...['fed', 'treasury-yields', 'commodities'].flatMap((topic) => topicLeaders.has(topic) ? [topicLeaders.get(topic)!] : []),
        ...Array.from(topicLeaders.entries()).filter(([topic]) => !['fed', 'treasury-yields', 'commodities'].includes(topic)).map(([, event]) => event).sort((a, b) => (b.volume || 0) - (a.volume || 0)),
        ...activeEvents.filter((event) => !MACRO_EVENT_PATTERN.test(event.title!)),
    ].slice(0, 3);

    return selected.map((event) => {
        const markets = (event.markets || [])
            .filter(isOpenMarket)
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
