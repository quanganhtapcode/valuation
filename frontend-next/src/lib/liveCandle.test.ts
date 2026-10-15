import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeLiveCandle, quoteSessionDate } from './liveCandle';

const yesterday = {
    time: '2026-10-14', open: 18950, high: 19250, low: 18500,
    close: 18650, volume: 6764900,
};

test('a new session starts without yesterday’s range or volume', () => {
    assert.deepEqual(mergeLiveCandle(yesterday, {
        time: '2026-10-15', price: 19000, volume: 100,
    }), {
        time: '2026-10-15', open: 19000, high: 19000, low: 19000,
        close: 19000, volume: 100,
    });
});

test('live trades preserve the session open, extremes and cumulative volume', () => {
    const first = mergeLiveCandle(yesterday, {
        time: '2026-10-14', price: 19300, volume: 6800000,
    });
    const next = mergeLiveCandle(first!, {
        time: '2026-10-14', price: 18400, volume: 6900000,
    });
    assert.equal(next?.open, 18950);
    assert.equal(next?.high, 19300);
    assert.equal(next?.low, 18400);
    assert.equal(next?.close, 18400);
    assert.equal(next?.volume, 6900000);
});

test('delayed history cannot roll back a reapplied live close or accumulated range', () => {
    const live = mergeLiveCandle(yesterday, {
        time: '2026-10-14', price: 19300, volume: 6800000,
    });
    const refreshed = mergeLiveCandle(live!, {
        time: '2026-10-14', price: 19000, high: yesterday.high,
        low: yesterday.low, volume: yesterday.volume,
    });
    assert.equal(refreshed?.close, 19000);
    assert.equal(refreshed?.high, 19300);
    assert.equal(refreshed?.volume, 6800000);
});

test('old sessions and invalid prices cannot overwrite a newer candle', () => {
    assert.equal(mergeLiveCandle(yesterday, {time: '2026-10-13', price: 19200, volume: 0}), null);
    for (const price of [0, -1, NaN, Infinity]) {
        assert.equal(mergeLiveCandle(yesterday, {time: '2026-10-14', price, volume: 0}), null);
    }
});

test('session dates use Vietnam time and handle before opening and weekends', () => {
    assert.equal(quoteSessionDate(new Date('2026-10-15T01:59:00Z')), '2026-10-14');
    assert.equal(quoteSessionDate(new Date('2026-10-15T02:00:00Z')), '2026-10-15');
    assert.equal(quoteSessionDate(new Date('2026-10-17T05:00:00Z')), '2026-10-16');
    assert.equal(quoteSessionDate(new Date('2026-10-19T01:00:00Z')), '2026-10-16');
});
