import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function fixture(payload: unknown) {
    let request = '';
    let signal: AbortSignal | null | undefined;
    function load(name: string): unknown {
        const filename = path.join(process.cwd(), 'src/lib', `${name}.ts`);
        const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText;
        const mod = { exports: {} };
        vm.runInNewContext(source, {
            module: mod, exports: mod.exports, Date, URLSearchParams, AbortSignal,
            require: (id: string) => id === './apiCore' ? {
                API: { INDEX_VALUATIONS: 'https://api.example/market/index-valuations' },
                fetchAPI: async (url: string, options?: RequestInit) => {
                    request = url;
                    signal = options?.signal;
                    return payload;
                },
            } : load(id.replace('./', '')),
        }, { filename });
        return mod.exports;
    }
    return {
        api: load('valuationChartApi') as typeof import('./valuationChartApi'),
        request: () => new URL(request), signal: () => signal,
    };
}

test('page request is bounded and uses an exclusive cursor instead of timeFrame', async () => {
    const f = fixture({ columns: ['date', 'vnindex', 'pe', 'pb', 'volume'],
        data: [['2025-01-02', 1500.123456, 15, 2, 0]],
        pagination: { hasMore: true, nextBefore: '2025-01-02' } });
    const controller = new AbortController();
    const page = await f.api.fetchPEChartPage('2026-01-01', { signal: controller.signal });
    assert.equal(f.request().searchParams.get('limit'), '250');
    assert.equal(f.request().searchParams.get('before'), '2026-01-01');
    assert.equal(f.request().searchParams.has('timeFrame'), false);
    assert.equal(f.signal()?.aborted, false);
    controller.abort();
    assert.equal(f.signal()?.aborted, true, 'component cleanup cancels its page request');
    assert.equal(page.series[0].vnindex, 1500.123456);
    assert.equal(page.series[0].volume, 0);
    assert.equal(page.pagination.nextBefore, '2025-01-02');
});

test('missing pagination, non-progressing cursors, and overlapping rows are rejected', async () => {
    for (const payload of [
        { data: [] },
        { data: [], pagination: { hasMore: true, nextBefore: '2025-01-01' } },
        { data: [{ date: '2025-01-02', pe: 15 }], pagination: { hasMore: true, nextBefore: '2026-01-01' } },
        { data: [{ date: '2026-01-01', pe: 15 }], pagination: { hasMore: false, nextBefore: null } },
    ]) {
        await assert.rejects(fixture(payload).api.fetchPEChartPage('2026-01-01'), /Invalid valuation history page/);
    }
});

test('empty terminal page ends history without removing existing data', async () => {
    const { api } = fixture({ data: [], pagination: { hasMore: false, nextBefore: null } });
    const page = await api.fetchPEChartPage('2024-01-01');
    const current = api.parsePEChartPayload({ data: [{ date: '2024-01-01', pe: 15 }] });
    const merged = api.mergeValuationHistory(current, page.series);
    assert.equal(merged.length, 1);
    assert.equal(merged[0], current[0]);
    assert.equal(page.pagination.hasMore, false);
});

test('merge handles overlap and sparse PE/PB rows without replacing newer values', () => {
    const { api } = fixture(null);
    const current = api.parsePEChartPayload({ data: [
        { date: '2025-01-03', vnindex: 1600 }, { date: '2025-01-06', pe: 16 },
    ] });
    const older = api.parsePEChartPayload({ data: [
        { date: '2025-01-03', vnindex: 1500 }, { date: '2025-01-02', pb: 2 },
    ] });
    const merged = api.mergeValuationHistory(current, older);
    assert.equal(merged.length, 3);
    assert.equal(merged[0].date.toISOString().slice(0, 10), '2025-01-02');
    assert.equal(merged[1].vnindex, 1600);
    assert.equal(merged[2].pe, 16);
});
