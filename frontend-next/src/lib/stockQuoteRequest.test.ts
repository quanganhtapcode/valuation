import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { requestStockQuote } from './stockQuoteRequest';

afterEach(() => mock.restoreAll());

function response(price: number) {
    return new Response(JSON.stringify({ success: true, current_price: price }), {
        headers: { 'Content-Type': 'application/json' },
    });
}

test('intent prefetch and navigation share an in-flight quote request', async () => {
    let finish!: (response: Response) => void;
    const fetch = mock.method(globalThis, 'fetch', () => new Promise<Response>(resolve => { finish = resolve; }));
    const prefetched = requestStockQuote(' pnj ');
    const navigation = requestStockQuote('PNJ');
    assert.equal(prefetched, navigation);
    assert.equal(fetch.mock.callCount(), 1);
    finish(response(18500));
    assert.equal((await navigation)?.current_price, 18500);
});

test('a completed quote expires after one second', async () => {
    let now = 10000;
    mock.method(Date, 'now', () => now);
    const fetch = mock.method(globalThis, 'fetch', async () => response(now));
    assert.equal((await requestStockQuote('FPT'))?.current_price, 10000);
    now = 10999;
    assert.equal((await requestStockQuote('FPT'))?.current_price, 10000);
    now = 11000;
    assert.equal((await requestStockQuote('FPT'))?.current_price, 11000);
    assert.equal(fetch.mock.callCount(), 2);
});

test('failed prefetch does not prevent navigation retrying', async () => {
    let calls = 0;
    mock.method(globalThis, 'fetch', async () => ++calls === 1
        ? new Response('', { status: 503 }) : response(25000));
    assert.equal(await requestStockQuote('HPG'), null);
    assert.equal((await requestStockQuote('HPG'))?.current_price, 25000);
});

test('network failure does not poison the quote cache', async () => {
    let calls = 0;
    mock.method(globalThis, 'fetch', async () => {
        if (++calls === 1) throw new Error('network unavailable');
        return response(60000);
    });
    assert.equal(await requestStockQuote('VCB'), null);
    assert.equal((await requestStockQuote('VCB'))?.current_price, 60000);
});
