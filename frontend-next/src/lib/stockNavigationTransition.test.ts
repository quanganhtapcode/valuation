import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { cancelStockNavigation, completeStockNavigation, getStockNavigation, startStockNavigation, stockNavigationTarget } from './stockNavigationTransition';

const origin = 'https://stock.example';
test('stock transition keeps the selected ticker and language without fetching a route', () => {
    assert.deepEqual(stockNavigationTarget('/en/stock/hpg?view=overview', origin), {
        pathname: '/en/stock/hpg', symbol: 'HPG', lang: 'en',
    });
    assert.equal(stockNavigationTarget('/vi/stock/VCB', origin)?.symbol, 'VCB');
});
test('non-stock, external and malformed destinations cannot cover the current page', () => {
    for (const href of ['/vi/funds/FPT', '/vi/stock/FPT/workbook', '/fr/stock/FPT',
        'https://other.example/vi/stock/FPT', 'javascript:alert(1)', '/vi/stock/%3Cscript%3E']) {
        assert.equal(stockNavigationTarget(href, origin), null, href);
    }
});

afterEach(() => {
    cancelStockNavigation();
    mock.restoreAll();
    Reflect.deleteProperty(globalThis, 'window');
});

function browser() {
    Object.defineProperty(globalThis, 'window', { configurable: true,
        value: { location: { origin, pathname: '/vi/stock/FPT' } } });
    mock.method(globalThis, 'fetch', async () => Response.json({ success: true, data: [] }));
}

test('a late first route cannot dismiss feedback for a newer ticker', () => {
    browser();
    startStockNavigation('/vi/stock/HPG');
    assert.equal(getStockNavigation()?.symbol, 'HPG');
    startStockNavigation('/vi/stock/VCB');
    completeStockNavigation('/vi/stock/HPG');
    assert.equal(getStockNavigation()?.symbol, 'VCB');
    completeStockNavigation('/vi/stock/VCB');
    assert.equal(getStockNavigation(), null);
});

test('cancel, same-page and non-stock navigation restore the current page', () => {
    browser();
    startStockNavigation('/vi/stock/HPG');
    cancelStockNavigation();
    assert.equal(getStockNavigation(), null);
    startStockNavigation('/vi/stock/HPG');
    startStockNavigation('/vi/stock/FPT');
    assert.equal(getStockNavigation(), null);
    startStockNavigation('/vi/stock/HPG');
    startStockNavigation('/vi/screener');
    assert.equal(getStockNavigation(), null);
});

test('a route that never completes cannot leave the old page permanently hidden', () => {
    browser();
    let recover!: () => void;
    mock.method(globalThis, 'setTimeout', (callback: () => void) => {
        recover = callback;
        return 0 as unknown as ReturnType<typeof setTimeout>;
    });
    startStockNavigation('/en/stock/HPG');
    assert.equal(getStockNavigation()?.lang, 'en');
    recover();
    assert.equal(getStockNavigation(), null);
});

test('the originating non-stock page cannot clear feedback before the destination mounts', () => {
    browser();
    window.location.pathname = '/vi';
    startStockNavigation('/en/stock/HPG');
    completeStockNavigation('/vi');
    assert.equal(getStockNavigation()?.symbol, 'HPG');
    completeStockNavigation('/vi/news');
    assert.equal(getStockNavigation(), null);
});
