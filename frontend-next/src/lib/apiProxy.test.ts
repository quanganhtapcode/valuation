import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { proxyApiRequest } from './apiProxy';
import { isBulkExport, normalizeApiPath, resolveCachePolicy } from './apiProxyPolicy';
import { API, ApiRequestError, fetchAPI } from './apiCore';
import aliases from './apiRouteAliases.json';
import { backendApiPath, canonicalApiPath } from './apiRouteRegistry';
import { proxyResponseHeaders } from './apiResponse';

afterEach(() => mock.restoreAll());
const upstream = 'https://backend.example/api';
const request = (path: string) => new Request(`https://site.example/api/${path}`);

test('every canonical route supports old upstreams and shares its cache policy', () => {
    const sample = (template: string) => template.replace(/^\/api\//, '')
        .replace(/<(?:symbol|ticker)>/g, 'VCB').replace('<timeframe>', 'ONE_DAY');
    for (const [canonical, legacy] of Object.entries(aliases)) {
        assert.equal(backendApiPath(sample(canonical)), sample(legacy), canonical);
        assert.equal(backendApiPath(sample(legacy)), sample(legacy), legacy);
        assert.deepEqual(resolveCachePolicy(sample(canonical), new URLSearchParams()),
            resolveCachePolicy(sample(legacy), new URLSearchParams()), canonical);
    }
});

test('canonical and legacy live resources bypass caches', () => {
    for (const path of ['stock/batch-price', 'batch-price', 'stocks/quotes', 'health',
        'stock/VCB/summary', 'stocks/VCB/summary', 'stock/VCB/overview-full',
        'stocks/VCB/quote', 'market/indices', 'market/prices', 'market/orderbook', 'market/overview-refresh',
        'market/overview', 'market/screener', 'stock/excel-manifest',
        'financial-statements/exports', 'financial-statements/workbooks/manifest']) {
        assert.equal(resolveCachePolicy(path, new URLSearchParams()).mode, 'realtime', path);
    }
    assert.equal(resolveCachePolicy('stocks/VCB/summary', new URLSearchParams('realtime=0')).mode, 'medium');
});

test('aggregate snapshots use a brief shared cache and explicit bypasses still work', () => {
    assert.deepEqual(resolveCachePolicy('market/heatmap', new URLSearchParams('exchange=HSX&limit=200')), {
        mode: 'snapshot', revalidateSeconds: 5,
        responseCacheControl: 'public, max-age=0, s-maxage=5, stale-while-revalidate=10',
    });
    for (const query of ['cache=no-store', 'nocache=1', 'pretty=1']) {
        assert.equal(resolveCachePolicy('market/heatmap', new URLSearchParams(query)).mode, 'realtime', query);
    }
    assert.equal(resolveCachePolicy('market/heatmap-history', new URLSearchParams()).mode, 'realtime');
});

test('only opt-in chart snapshots use the edge cache and explicit bypasses win', () => {
    assert.equal(resolveCachePolicy('stocks/FPT/price-history', new URLSearchParams()).mode, 'realtime');
    assert.equal(resolveCachePolicy('stocks/FPT/price-history', new URLSearchParams('snapshot=1')).mode, 'snapshot');
    assert.equal(resolveCachePolicy('stocks/FPT/price-history', new URLSearchParams('snapshot=1&nocache=1')).mode, 'realtime');
});

test('aggregate data is cached briefly while live quotes stay uncached', () => {
    for (const path of ['market/gold', 'market/top-movers', 'market/foreign-flow',
        'market/foreign-net-value', 'market/foreign-volume-chart']) {
        assert.equal(resolveCachePolicy(path, new URLSearchParams()).mode, 'snapshot', path);
    }
    for (const path of ['market/ai-takeaways', 'market/macro/rates']) {
        assert.equal(resolveCachePolicy(path, new URLSearchParams()).mode, 'short', path);
        assert.equal(resolveCachePolicy(path, new URLSearchParams('cache=no-store')).mode, 'realtime');
    }
    for (const path of ['market/world-indices', 'market/macro/economic', 'market/macro/history/batch']) {
        assert.equal(resolveCachePolicy(path, new URLSearchParams()).mode, 'medium', path);
    }
    for (const path of ['market/indices', 'market/prices', 'market/screener', 'stocks/FPT/quote']) {
        assert.equal(resolveCachePolicy(path, new URLSearchParams()).mode, 'realtime', path);
    }
});

test('heatmap snapshots cache only at the edge and failures remain uncached', async () => {
    let status = 200;
    let fetchOptions: RequestInit | undefined;
    mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, options?: RequestInit) => {
        fetchOptions = options;
        return Response.json(status === 200 ? { sectors: [{ name: 'Banks' }] }
            : { success: false, error: 'Unavailable' }, { status });
    });
    const result = await proxyApiRequest(request('market/heatmap?exchange=HSX&limit=200'), 'market/heatmap', upstream);
    assert.equal(result.headers.get('Cache-Control'), 'public, max-age=0, s-maxage=5, stale-while-revalidate=10');
    assert.equal(result.headers.get('X-Proxy-Cache-Policy'), 'snapshot:5');
    assert.match(result.headers.get('Server-Timing')!, /upstream;dur=\d+(?:\.\d+)?/);
    assert.equal(fetchOptions?.cache, 'no-store');

    for (const query of ['cache=no-store', 'nocache=1']) {
        const bypass = await proxyApiRequest(request(`market/heatmap?${query}`), 'market/heatmap', upstream);
        assert.equal(bypass.headers.get('Cache-Control'), 'no-store');
    }
    status = 503;
    const failure = await proxyApiRequest(request('market/heatmap'), 'market/heatmap', upstream);
    assert.equal(failure.status, 503);
    assert.equal(failure.headers.get('Cache-Control'), 'no-store');
    assert.equal((await failure.json()).error.code, 'SERVICE_UNAVAILABLE');
});

test('aliases use the same cache and lookalike prefixes do not match', () => {
    for (const [oldPath, path] of [['news/VCB', 'stocks/VCB/news'],
        ['stock/VCB/news', 'stocks/VCB/news'], ['stock/holders/VCB', 'stocks/VCB/shareholders'],
        ['company/profile/VCB', 'companies/VCB/profile'], ['market/pe-chart', 'market/index-valuations']]) {
        assert.equal(normalizeApiPath(oldPath), normalizeApiPath(path));
        assert.deepEqual(resolveCachePolicy(oldPath, new URLSearchParams()), resolveCachePolicy(path, new URLSearchParams()));
    }
    assert.equal(resolveCachePolicy('market/newsroom', new URLSearchParams()).mode, 'realtime');
    assert.equal(resolveCachePolicy('stocks/VCB/profile', new URLSearchParams('pretty=1')).mode, 'realtime');
});

test('structured errors and retry headers survive without nested backend payloads', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({ success: false,
        error: { code: 'RATE_LIMITED', message: 'Retry shortly' }, debug: 'internal' }, {
        status: 429, headers: { 'Retry-After': '10', ETag: 'obsolete' },
    }));
    const result = await proxyApiRequest(request('stocks/VCB/news'), 'stocks/VCB/news', upstream);
    assert.equal(result.status, 429);
    assert.equal(result.headers.get('Retry-After'), '10');
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    assert.equal(result.headers.get('ETag'), null);
    assert.deepEqual(await result.json(), { success: false,
        error: { code: 'RATE_LIMITED', message: 'Retry shortly' } });
});

test('POST preserves created and empty statuses and rejects invalid JSON', async () => {
    let status = 201;
    const fetch = mock.method(globalThis, 'fetch', async () => new Response(status === 204 ? null : '{"data":1}', { status }));
    const post = (body: string) => new Request('https://site.example/api/stocks/VCB/valuation', { method: 'POST', body });
    const created = await proxyApiRequest(post('{}'), 'stocks/VCB/valuation', upstream);
    assert.equal(created.status, 201);
    assert.equal(created.headers.get('Cache-Control'), 'no-store');
    status = 204;
    assert.equal((await proxyApiRequest(post('{}'), 'stocks/VCB/valuation', upstream)).status, 204);
    assert.equal((await proxyApiRequest(post('{'), 'stocks/VCB/valuation', upstream)).status, 400);
    assert.equal(fetch.mock.callCount(), 2);
});

test('streams downloads, drops compressed length and respects upstream no-store', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('workbook', { headers: {
        'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="report.zip"',
        'Content-Encoding': 'gzip', 'Content-Length': '123', 'Cache-Control': 'private, no-store',
    } }));
    const result = await proxyApiRequest(request('stocks/VCB/report-file'), 'stocks/VCB/report-file', upstream);
    assert.equal(await result.text(), 'workbook');
    assert.equal(result.headers.get('Content-Disposition'), 'attachment; filename="report.zip"');
    assert.equal(result.headers.get('Content-Length'), null);
    assert.equal(result.headers.get('Content-Encoding'), null);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    const profile = await proxyApiRequest(request('stocks/VCB/profile'), 'stocks/VCB/profile', upstream);
    assert.equal(profile.headers.get('Cache-Control'), 'private, no-store');
});

test('timeout returns the same structured contract', async () => {
    mock.method(globalThis, 'fetch', async () => { throw new DOMException('Timed out', 'TimeoutError'); });
    const result = await proxyApiRequest(request('stocks/VCB/quote'), 'stocks/VCB/quote', upstream);
    assert.equal(result.status, 504);
    assert.equal((await result.json()).error.code, 'GATEWAY_TIMEOUT');
});

test('cache freshness never exceeds the upstream or route limit', () => {
    const policy = 'public, s-maxage=30, stale-while-revalidate=60';
    for (const [upstream, expected] of [['public, max-age=60', 30],
        ['public, max-age=10', 10], ['public, max-age=60, s-maxage=15', 15]]) {
        const headers = proxyResponseHeaders(new Headers({ 'Cache-Control': String(upstream) }), policy);
        assert.match(headers.get('Cache-Control')!, new RegExp(`(?:^|, )s-maxage=${expected}(?:,|$)`));
    }
    for (const restriction of ['private, max-age=20', 'no-cache', 'no-store']) {
        assert.equal(proxyResponseHeaders(new Headers({ 'Cache-Control': restriction }), policy)
            .get('Cache-Control'), restriction);
    }
});

test('URL builders normalize symbols and shared fetch retains error code', async () => {
    assert.equal(API.STOCK_QUOTE(' vcb '), '/api/stocks/VCB/quote');
    mock.method(console, 'error', () => {});
    mock.method(globalThis, 'fetch', async () => Response.json({ success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Snapshot pending' } }, { status: 503 }));
    await assert.rejects(fetchAPI('https://site.example/api/stocks/VCB/news'), error => {
        assert.ok(error instanceof ApiRequestError);
        assert.equal(error.code, 'SERVICE_UNAVAILABLE');
        assert.equal(error.message, 'Snapshot pending');
        return true;
    });
});


test('short names are preferred across every generation of financial URLs', () => {
    for (const path of ['stocks/FPT/financials', 'stocks/FPT/financial-statements', 'stock/FPT/financial-report']) {
        assert.equal(canonicalApiPath(path), 'stocks/FPT/financials');
        assert.equal(backendApiPath(path), 'stock/FPT/financial-report');
    }
    assert.equal(canonicalApiPath('stocks/FPT/financial-metrics'), 'stocks/FPT/metrics');
    assert.equal(canonicalApiPath('financial-statements/workbooks/manifest'), 'workbooks');
    assert.equal(backendApiPath('workbooks'), 'stock/excel-manifest');
    assert.equal(backendApiPath('stocks/metrics'), 'stock/stats-financial');
});

test('short export names retain download timeouts and no-store policies', () => {
    for (const path of ['exports/financials', 'financial-statements/exports', 'financial-bulk-export',
        'workbooks/archive', 'financial-statements/workbooks/archive', 'stock/excel-bulk']) {
        assert.equal(isBulkExport(path), true, path);
        assert.equal(resolveCachePolicy(path, new URLSearchParams()).mode, 'realtime', path);
    }
    assert.equal(isBulkExport('workbooks'), false);
    assert.equal(isBulkExport('exports/financials-preview'), false);
});
