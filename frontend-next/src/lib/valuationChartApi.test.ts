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

test('prefetch and pan share a request; aborting one caller leaves the other intact', async () => {
    const { fetchPEChartByRange } = await import('./valuationChartApi');
    const originalFetch = globalThis.fetch;
    let calls = 0;
    let finish: ((response: Response) => void) | undefined;
    globalThis.fetch = () => { calls++; return new Promise<Response>(resolve => { finish = resolve; }); };
    try {
        const controller = new AbortController();
        const prefetch = fetchPEChartByRange('6M', 'both', { signal: controller.signal });
        const pan = fetchPEChartByRange('6M', 'both');
        controller.abort();
        const aborted = assert.rejects(prefetch, { name: 'AbortError' });
        finish!(new Response(JSON.stringify({ data: [{ date: '2026-10-23', vnindex: 1700, pe: 12.25 }], stats: {} })));
        await aborted;
        const result = await pan;
        assert.equal(result.series[0].pe, 12.25);
        assert.equal(calls, 1);
        assert.equal((await fetchPEChartByRange('6M')).series[0].vnindex, 1700);
        assert.equal(calls, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
