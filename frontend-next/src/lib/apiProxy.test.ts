import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { proxyApiRequest } from './apiProxy';
import { normalizeApiPath, resolveCachePolicy } from './apiProxyPolicy';
import { API, ApiRequestError, fetchAPI } from './apiCore';
import aliases from './apiRouteAliases.json';
import { backendApiPath } from './apiRouteRegistry';
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
        'stocks/VCB/quote', 'market/orderbook', 'market/overview-refresh',
        'market/overview', 'market/screener', 'stock/excel-manifest',
        'financial-statements/exports', 'financial-statements/workbooks/manifest']) {
        assert.equal(resolveCachePolicy(path, new URLSearchParams()).mode, 'realtime', path);
    }
    assert.equal(resolveCachePolicy('stocks/VCB/summary', new URLSearchParams('realtime=0')).mode, 'medium');
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
    assert.equal(API.CURRENT_PRICE(' vcb '), '/api/stocks/VCB/quote');
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
