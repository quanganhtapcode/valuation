import { NextResponse } from 'next/server';

const POLYMARKET_EVENTS_URLS = [
    'https://gamma-api.polymarket.com/events?active=true&closed=false&tag_slug=finance&order=volume24hr&ascending=false&limit=100',
    'https://gamma-api.polymarket.com/events?active=true&closed=false&tag_slug=fed-rates&order=volume24hr&ascending=false&limit=100',
];

export async function GET() {
    try {
        const responses = await Promise.all(POLYMARKET_EVENTS_URLS.map((url) => fetch(url, {
            headers: { Accept: 'application/json' },
            next: { revalidate: 300 },
            signal: AbortSignal.timeout(10000),
        })));
        const failedResponse = responses.find((response) => !response.ok);
        if (failedResponse) {
            return NextResponse.json({ error: `Upstream Error: ${failedResponse.status}` }, { status: 502 });
        }
        const payloads: unknown[] = await Promise.all(responses.map((response) => response.json()));
        const events = payloads.flatMap((payload) => Array.isArray(payload) ? payload : []);
        const uniqueEvents = Array.from(new Map(events.map((event, index) => {
            const id = typeof event === 'object' && event !== null && 'id' in event
                ? String(event.id)
                : String(index);
            return [id, event];
        })).values());

        return NextResponse.json(uniqueEvents, {
            headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
        });
    } catch {
        return NextResponse.json({ error: 'Failed to fetch Polymarket events' }, { status: 502 });
    }
}
