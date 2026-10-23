import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePEChartPayload } from './valuationChartApi';

test('compact historical charts preserve every point and financial value', () => {
    const row = { date: '2026-10-23', vnindex: 1720.1234, open: 1710, high: 1730,
        low: 1700, close: 1720.1234, ema50: 1680.123456, pe: 12.3456789, pb: null, volume: 1_000_000 };
    const columns = Object.keys(row);
    const compact = { columns, data: [Object.values(row)] };
    assert.deepEqual(parsePEChartPayload(compact), parsePEChartPayload({ data: [row] }));
    assert.equal(parsePEChartPayload(compact)[0].pe, row.pe);
});
