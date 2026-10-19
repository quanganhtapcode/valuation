import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heatmapRefreshDelay, heatmapRetryDelay } from './heatmapRefresh';

test('a fresh seed waits only the remaining trading refresh interval', () => {
    assert.equal(heatmapRefreshDelay(100000, 15000, 104000), 11000);
});

test('ISR seed age makes expired trading snapshots refresh immediately', () => {
    assert.equal(heatmapRefreshDelay(100000, 15000, 115000), 0);
    assert.equal(heatmapRefreshDelay(100000, 15000, 160000), 0);
});

test('off-hours seeds retain their regular interval without delaying missing data', () => {
    assert.equal(heatmapRefreshDelay(100000, 300000, 160000), 240000);
    assert.equal(heatmapRefreshDelay(100000, 300000, 400001), 0);
    assert.equal(heatmapRefreshDelay(0, 300000, 160000), 0);
    assert.equal(heatmapRefreshDelay(Number.NaN, 300000, 160000), 0);
});

test('clock skew cannot defer a seed beyond one regular refresh interval', () => {
    assert.equal(heatmapRefreshDelay(200000, 15000, 100000), 15000);
});

test('initial failures retry within seconds and repeated failures remain bounded', () => {
    assert.deepEqual([1, 2, 3, 4, 20, 1000].map(heatmapRetryDelay), [2000, 4000, 8000, 15000, 15000, 15000]);
});
