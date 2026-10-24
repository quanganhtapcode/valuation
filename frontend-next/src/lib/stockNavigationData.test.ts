import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { peekStockHistory, requestStockHistory, requestStockSummary } from './stockNavigationData';

afterEach(() => mock.restoreAll());

test('hover and navigation share the same history request and keep symbols separate', async () => {
    let finish!: (value: Response) => void;
    const fetch = mock.method(globalThis, 'fetch', () => new Promise<Response>(resolve => { finish = resolve; }));
    const hover = requestStockHistory(' fpt ');
    const navigation = requestStockHistory('FPT');
    assert.equal(hover, navigation);
    assert.equal(fetch.mock.callCount(), 1);
    assert.match(String(fetch.mock.calls[0].arguments[0]), /FPT\/price-history\?period=1Y&snapshot=1$/);
    finish(Response.json({ success: true, data: [{ date: '2026-10-23', close: 100 }] }));
    await navigation;
    assert.equal(peekStockHistory('FPT')?.data[0].close, 100);
    assert.equal(peekStockHistory('VCB'), undefined);
    assert.equal(peekStockHistory('FPT', '5Y'), undefined);
});

test('history refreshes after 15 seconds instead of retaining an old navigation snapshot', async () => {
    let now = 100_000;
    mock.method(Date, 'now', () => now);
    const fetch = mock.method(globalThis, 'fetch', async () => Response.json({ success: true, data: [] }));
    await requestStockHistory('HPG');
    now += 14_999;
    await requestStockHistory('HPG');
    assert.equal(fetch.mock.callCount(), 1);
    now += 1;
    await requestStockHistory('HPG');
    assert.equal(fetch.mock.callCount(), 2);
});

test('failed intent requests do not poison later navigation', async () => {
    let calls = 0;
    mock.method(globalThis, 'fetch', async () => ++calls === 1
        ? Response.json({ success: false }, { status: 503 })
        : Response.json({ success: true, symbol: 'PNJ', pe: 20 }));
    assert.equal(await requestStockSummary('PNJ'), null);
    assert.equal((await requestStockSummary('PNJ'))?.pe, 20);
});
