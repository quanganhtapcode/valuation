import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { getOverviewPageSnapshot } from './overviewPageSnapshot';

afterEach(() => mock.restoreAll());

const heatmap = { sectors: [{ name: 'Bank', shortName: 'Bank', totalCap: 100,
    avgChange: 1, stocks: [{ ticker: 'VCB', cap: 100, change: 1, price: 1000, name: 'VCB', sector: 'Bank' }] }] };

function responseFor(url: string) {
    if (url.includes('/heatmap')) return heatmap;
    if (url.includes('/vci-indices')) return [{ symbol: 'VNINDEX', price: 1200, refPrice: 1000 }];
    if (url.includes('/news')) return { data: [{ title: 'Latest news' }] };
    if (url.includes('/top-movers')) return { Data: [{ Symbol: url.includes('type=UP') ? 'VCB' : 'FPT' }] };
    return { data: [{ Id: 1 }], source: 'Phú Quý', stale: true };
}

test('independent panels start together, use legacy upstream paths and keep source age', async () => {
    const pending: Array<() => void> = [];
    const urls: string[] = [];
    const date = new Date(Date.now() - 60000).toUTCString();
    mock.method(globalThis, 'fetch', (input: string, options: RequestInit & { next?: { revalidate: number } }) => {
        urls.push(input);
        assert.ok(options.next?.revalidate);
        assert.ok(options.signal);
        return new Promise<Response>(resolve => pending.push(() => resolve(Response.json(responseFor(input), { headers: { Date: date } }))));
    });
    const snapshot = getOverviewPageSnapshot('https://backend.example/api');
    assert.equal(pending.length, 6, 'all six sources start before waiting for a response');
    assert.ok(urls.some(url => url.endsWith('/market/vci-indices')));
    assert.equal(urls.some(url => url.includes('/market/overview')), false);
    pending.forEach(finish => finish());
    const result = await snapshot;
    assert.deepEqual(result.initialHeatmap, heatmap);
    assert.equal(result.initialHeatmapFetchedAt, Date.parse(date));
    assert.equal(result.initialIndices[0].value, 1200);
    assert.equal(result.initialNews.length, 1);
    assert.equal(result.initialGainers.length, 1);
    assert.equal(result.initialLosers.length, 1);
    assert.equal(result.initialGoldStale, true);
    assert.equal(result.initialNewsFetchedAt, Date.parse(date));
    assert.equal(result.initialMoversFetchedAt, Date.parse(date));
    assert.equal(result.initialGoldFetchedAt, Date.parse(date));
});

test('an unavailable panel preserves the remaining server-rendered content', async () => {
    mock.method(globalThis, 'fetch', async (input: string) => {
        if (input.includes('/heatmap')) throw new DOMException('Timed out', 'TimeoutError');
        if (input.includes('/vci-indices')) return new Response('', { status: 503 });
        return Response.json(responseFor(input));
    });
    const result = await getOverviewPageSnapshot('https://backend.example/api');
    assert.equal(result.initialHeatmap, null);
    assert.equal(result.initialHeatmapFetchedAt, 0);
    assert.deepEqual(result.initialIndices, []);
    assert.equal(result.initialNews.length, 1);
    assert.equal(result.initialGoldPrices.length, 1);
});

test('an empty or invalid heatmap cannot become an apparently fresh ISR seed', async () => {
    for (const body of [{ sectors: [] }, { sectors: null }, null]) {
        mock.method(globalThis, 'fetch', async (input: string) => Response.json(input.includes('/heatmap') ? body : responseFor(input)));
        const result = await getOverviewPageSnapshot('https://backend.example/api');
        assert.equal(result.initialHeatmap, null);
        assert.equal(result.initialHeatmapFetchedAt, 0);
        mock.restoreAll();
    }
});

test('pre-open reference values render without inventing a traded index price', async () => {
    mock.method(globalThis, 'fetch', async (input: string) => Response.json(input.includes('/vci-indices')
        ? [{ symbol: 'VNINDEX', price: 0, refPrice: 1705.91 }] : responseFor(input)));
    const result = await getOverviewPageSnapshot('https://backend.example/api');
    assert.equal(result.initialIndices.length, 1);
    assert.equal(result.initialIndices[0].value, 1705.91);
    assert.equal(result.initialIndices[0].isReference, true);
    assert.equal(result.initialIndices[0].change, 0);
});
