import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { loadWatchlist, normalizeWatchlist, saveWatchlist } from './watchlistStorage';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('stored watchlists discard corrupt entries and deduplicate normalized tickers', () => {
    const stored = [' vcb ', null, 123, {}, 'FPT', 'vcb', '', 'a/b', 'A', 'HPG&symbols=ALL'];
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true, value: { getItem: () => JSON.stringify(stored) },
    });
    assert.deepEqual(loadWatchlist(), ['VCB', 'FPT']);
    assert.deepEqual(normalizeWatchlist([' abc123 ', 'VN30']), ['ABC123', 'VN30']);
});

test('malformed JSON and non-array values recover as an empty watchlist', () => {
    for (const value of ['invalid JSON', '{}', 'null', '123', '"VCB"']) {
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true, value: { getItem: () => value },
        });
        assert.deepEqual(loadWatchlist(), []);
    }
});

test('denied storage access cannot break watchlist actions', () => {
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true, get: () => { throw new DOMException('Storage blocked', 'SecurityError'); },
    });
    assert.deepEqual(loadWatchlist(), []);
    assert.doesNotThrow(() => saveWatchlist(['VCB']));
});

test('quota failures are tolerated while successful writes retain the storage format', () => {
    let saved: [string, string] | undefined;
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: { setItem: (key: string, value: string) => { saved = [key, value]; } },
    });
    saveWatchlist(['VCB', 'FPT']);
    assert.deepEqual(saved, ['watchlist', '["VCB","FPT"]']);
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: { setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); } },
    });
    assert.doesNotThrow(() => saveWatchlist(['FPT']));
});
