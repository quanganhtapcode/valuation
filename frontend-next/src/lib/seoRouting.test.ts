import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';

function request(path: string, cookie?: string) {
    return new NextRequest(`https://stock.quanganh.org${path}`, {
        headers: cookie ? { cookie } : undefined,
    });
}

test('legacy and lowercase stock links converge in one permanent redirect', () => {
    for (const [source, target] of [
        ['/stock/vcb?tab=financials', '/vi/stock/VCB?tab=financials'],
        ['/stock/VCB', '/vi/stock/VCB'],
        ['/vi/stock/vcb', '/vi/stock/VCB'],
        ['/en/stock/vcb', '/en/stock/VCB'],
        ['/company', '/vi/company'],
        ['/en/funds/bvfed', '/en/funds/BVFED'],
        ['/funds/bvfed', '/vi/funds/BVFED'],
        ['/en/funds/vcbf-bcf', '/en/funds/VCBF-BCF'],
    ]) {
        const response = proxy(request(source, 'lang=en'));
        assert.equal(response.status, 308, source);
        assert.equal(response.headers.get('location'), `https://stock.quanganh.org${target}`, source);
    }
});

test('canonical pages and rendering resources do not redirect', () => {
    for (const path of ['/vi/stock/VCB', '/en/company', '/robots.txt', '/sitemap.xml',
        '/api/stocks/VCB/summary', '/_next/static/chunk.js', '/ticker_data.json']) {
        assert.equal(proxy(request(path)).headers.get('location'), null, path);
    }
});

test('unknown stock pages are rejected before a loading boundary can send 200', () => {
    for (const path of ['/vi/stock/INVALID999', '/en/stock/A-1', '/stock/missing', '/vi/stock/VCB.json']) {
        const response = proxy(request(path));
        assert.equal(response.status, 404, path);
        assert.equal(response.headers.get('x-robots-tag'), 'noindex');
        assert.match(response.headers.get('x-middleware-rewrite') || '', /\/(vi|en)\/404$/);
    }
});

test('only the homepage entry redirect uses the saved language', () => {
    for (const [cookie, lang] of [['lang=en', 'en'], ['lang=vi', 'vi'], ['lang=invalid', 'vi']]) {
        const response = proxy(request('/', cookie));
        assert.equal(response.status, 307);
        assert.equal(response.headers.get('location'), `https://stock.quanganh.org/${lang}`);
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
});
