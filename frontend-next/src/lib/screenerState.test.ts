import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedRange, sharedSymbols } from './screenerState';

test('restores VND market cap parameters as billions without losing zero', () => {
  const params = new URLSearchParams('market_cap_min=0&market_cap_max=10000000000000');
  assert.deepEqual(sharedRange(params, 'market_cap', { min: 0, max: 1200000 }, 1e9), { min: 0, max: 10000 });
});

test('normalizes malformed, inverted and out-of-range links', () => {
  const bounds = { min: -20, max: 40 };
  assert.deepEqual(sharedRange(new URLSearchParams('roe_min=Infinity&roe_max=nope'), 'roe', bounds), bounds);
  assert.deepEqual(sharedRange(new URLSearchParams('roe_min=35&roe_max=5'), 'roe', bounds), { min: 5, max: 35 });
  assert.deepEqual(sharedRange(new URLSearchParams('roe_min=-999&roe_max=999'), 'roe', bounds), bounds);
  assert.deepEqual(sharedRange(new URLSearchParams('roe_min=&roe_max='), 'roe', bounds), bounds);
});

test('comparison links normalize symbols, deduplicate and cap selection at five', () => {
  assert.deepEqual(sharedSymbols('fpt,FPT, vcb,../../,HPG,SSI,TCB,VNM'), ['FPT', 'VCB', 'HPG', 'SSI', 'TCB']);
  assert.deepEqual(sharedSymbols(null), []);
});
