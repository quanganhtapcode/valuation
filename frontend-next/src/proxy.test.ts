import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch, unstable_getResponseFromNextConfig, getRedirectUrl, getRewrittenUrl } from 'next/experimental/testing/server';
import ts from 'typescript';
import nextConfig from '../next.config.mjs';

const filename = path.join(process.cwd(), 'src/proxy.ts');
const sandboxModule = { exports: {} as typeof import('./proxy') };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, {
    module: sandboxModule, exports: sandboxModule.exports, require: createRequire(filename),
}, { filename });
const { proxy, config } = sandboxModule.exports;
const matches = (url: string) => unstable_doesMiddlewareMatch({ config, nextConfig: {}, url });
const request = (pathname: string, cookie?: string) => new NextRequest(`https://stock.quanganh.org${pathname}`, {
    headers: cookie ? { cookie } : {},
});

test('canonical public pages, RSC requests, API and assets skip Node Proxy', () => {
    for (const url of [
        '/vi', '/en', '/vi/', '/en/', '/vi?_rsc=test', '/en?utm_source=test',
        '/vi/news', '/en/funds', '/vi/screener', '/en/about', '/vi/events', '/en/foreign',
        '/vi/404', '/en/unknown', '/api', '/api/health', '/api/stocks/VCB',
        '/_next/static/chunks/app.js', '/_next/image?url=test', '/favicon.ico',
        '/quanganh-logo.svg', '/market-logos/nasdaq.v1.svg', '/news-logos/cafef.webp',
        '/ticker_data.json', '/robots.txt', '/sitemap.xml', '/site.webmanifest',
    ]) assert.equal(matches(url), false, url);
});

test('locale entry, legacy URLs and symbol validation still use Proxy', () => {
    for (const url of [
        '/', '/stock/vcb', '/stock/VCB', '/funds/vfmvf1', '/news', '/about', '/fr', '/VI',
        '/vi/stock/VCB', '/en/stock/vcb', '/vi/stock/ZZZZZ',
        '/en/stock/ZZZZZ/opengraph-image', '/vi/funds/vfmvf1', '/en/funds/VFMVF1',
        '/vi/stock/BRK.B', '/stock/BRK.B',
    ]) assert.equal(matches(url), true, url);
});

test('root language choice remains private and redirects legacy URLs permanently', () => {
    const english = proxy(request('/', 'lang=en'));
    assert.equal(english.status, 307);
    assert.equal(getRedirectUrl(english), 'https://stock.quanganh.org/en');
    assert.equal(english.headers.get('cache-control'), 'private, no-store');
    assert.equal(getRedirectUrl(proxy(request('/'))), 'https://stock.quanganh.org/vi');
    for (const [from, to] of [
        ['/stock/vcb', '/vi/stock/VCB'], ['/en/stock/vcb', '/en/stock/VCB'],
        ['/vi/funds/vfmvf1', '/vi/funds/VFMVF1'], ['/news', '/vi/news'],
    ]) {
        const response = proxy(request(from));
        assert.equal(response.status, 308, from);
        assert.equal(getRedirectUrl(response), `https://stock.quanganh.org${to}`, from);
    }
});

test('unknown stock routes retain an actual 404 before streaming', () => {
    for (const [from, to] of [
        ['/vi/stock/ZZZZZ', '/vi/404'], ['/en/stock/ZZZZZ', '/en/404'],
        ['/stock/ZZZZZ', '/vi/404'], ['/vi/stock/BRK.B', '/vi/404'],
    ]) {
        const response = proxy(request(from));
        assert.equal(response.status, 404, from);
        assert.equal(getRewrittenUrl(response), `https://stock.quanganh.org${to}`, from);
        assert.equal(response.headers.get('x-robots-tag'), 'noindex');
    }
    assert.equal(proxy(request('/vi/stock/VCB')).headers.get('x-middleware-next'), '1');
});

test('only public overview HTML gets the explicit short Vercel edge cache', async () => {
    for (const url of ['/vi', '/en', '/vi?utm_source=test']) {
        const response = await unstable_getResponseFromNextConfig({ url: `https://stock.quanganh.org${url}`, nextConfig });
        assert.equal(response.headers.get('vercel-cdn-cache-control'), 'public, max-age=60, stale-while-revalidate=15', url);
        assert.equal(response.headers.get('cache-control'), null, 'browser cache policy is not overridden');
    }
    for (const url of ['/', '/vi/stock/VCB', '/vi/stock/ZZZZZ', '/vi/news', '/fr', '/api/health']) {
        const response = await unstable_getResponseFromNextConfig({ url: `https://stock.quanganh.org${url}`, nextConfig });
        assert.equal(response.headers.get('vercel-cdn-cache-control'), null, url);
    }
});

test('RSC and client-navigation requests keep the framework cache policy', async () => {
    for (const url of ['/vi', '/en?_rsc=test']) {
        const response = await unstable_getResponseFromNextConfig({
            url: `https://stock.quanganh.org${url}`, nextConfig, headers: { rsc: '1' },
        });
        assert.equal(response.headers.get('vercel-cdn-cache-control'), null, url);
    }
});
