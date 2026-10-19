import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveMarketIndexQuote } from './marketIndexQuote';

test('a traded index reports the current value and its actual reference change', () => {
    assert.deepEqual(resolveMarketIndexQuote(1717, 1700), {
        value: 1717, change: 17, percentChange: 1, isReference: false,
    });
    assert.deepEqual(resolveMarketIndexQuote('1683', '1700'), {
        value: 1683, change: -17, percentChange: -1, isReference: false,
    });
});

test('a pre-open reset shows an explicitly identified reference with no invented loss', () => {
    for (const current of [0, -1, null, undefined, '', 'bad', Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.deepEqual(resolveMarketIndexQuote(current, 1705.91), {
            value: 1705.91, change: 0, percentChange: 0, isReference: true,
        });
    }
});

test('missing or nonpositive prices cannot become a valid market snapshot', () => {
    for (const invalid of [0, -1, null, undefined, '', 'bad', Number.NaN, Number.POSITIVE_INFINITY, true, [1700]]) {
        assert.equal(resolveMarketIndexQuote(invalid, invalid), null);
    }
});

test('a current quote without a valid base remains a current quote', () => {
    assert.deepEqual(resolveMarketIndexQuote(1700, 0), {
        value: 1700, change: 0, percentChange: 0, isReference: false,
    });
});
