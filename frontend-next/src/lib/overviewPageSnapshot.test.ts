import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

type Reply = { ok: boolean; headers: Headers; json: () => Promise<unknown> };

// Transpile only this dependency graph, with controlled network replies. This
// exercises concurrency without a running backend or timing-sensitive sleeps.
function fixture() {
    const requests = new Map<string, (response: Reply) => void>();
    const memo = new Map<string, unknown>();
    function load(name: string): unknown {
        if (memo.has(name)) return memo.get(name);
        const filename = path.join(process.cwd(), 'src/lib', `${name}.ts`);
        const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText;
        const sandboxModule = { exports: {} };
        vm.runInNewContext(source, {
            module: sandboxModule, exports: sandboxModule.exports, AbortSignal,
            require: (id: string) => {
                if (id === '@/lib/apiFetch') return {
                    apiFetch: (url: string) => new Promise<Reply>(resolve => {
                        requests.set(new URL(url).pathname + new URL(url).search, resolve);
                    }),
                };
                if (id === './backendRequestHeaders') return { backendRequestHeaders: {} };
                if (id === './apiRouteRegistry') return { backendApiPath: (value: string) => value };
                return load(id.replace('./', ''));
            },
        }, { filename });
        memo.set(name, sandboxModule.exports);
        return sandboxModule.exports;
    }
    const { getOverviewPageSnapshots } = load('overviewPageSnapshot') as typeof import('./overviewPageSnapshot');
    const snapshots = getOverviewPageSnapshots('https://backend.example');
    function reply(prefix: string, data: unknown, ok = true) {
        const entry = [...requests].find(([url]) => url.startsWith(prefix));
        assert(entry, `Expected request ${prefix}`);
        requests.delete(entry[0]);
        entry[1]({ ok, headers: new Headers({ date: 'Thu, 29 Oct 2026 10:00:00 GMT' }), json: async () => data });
    }
    return { snapshots, requests, reply };
}

test('slow secondary sources do not block the index/chart snapshot', async () => {
    const { snapshots, requests, reply } = fixture();
    assert.equal(requests.size, 7, 'all sources start before awaiting any section');
    const chart = { columns: ['date', 'vnindex', 'pe', 'pb'], data: [['2026-10-28', 1600, 14, 2]] };
    reply('/market/indices', [{ symbol: 'VNINDEX', price: 1600, refPrice: 1500 }]);
    reply('/market/index-valuations', chart);
    const market = await snapshots.market;
    assert.equal(market.initialIndices[0].value, 1600);
    assert.equal(market.initialIndices[0].change, 100);
    assert.equal(market.initialChart, chart, 'compact data is available before hydration');
    assert.equal(requests.size, 5, 'secondary sources are still unresolved');
    reply('/market/heatmap', { sectors: [{ name: 'Banks' }] });
    reply('/market/news', { data: [] });
    reply('/market/top-movers?centerID=HOSE&type=UP', { Data: [] });
    reply('/market/top-movers?centerID=HOSE&type=DOWN', { Data: [] });
    reply('/market/gold', { data: [] });
    await Promise.all(Object.values(snapshots));
});

test('missing chart and failed secondary sources retain independent fallbacks', async () => {
    const { snapshots, reply } = fixture();
    reply('/market/indices', [{ symbol: 'VNINDEX', price: 0, refPrice: 1500 }]);
    reply('/market/index-valuations', null, false);
    reply('/market/heatmap', { sectors: [] });
    reply('/market/news', null, false);
    reply('/market/top-movers?centerID=HOSE&type=UP', { Data: [] });
    reply('/market/top-movers?centerID=HOSE&type=DOWN', null, false);
    reply('/market/gold', null, false);
    const market = await snapshots.market;
    assert.equal(market.initialIndices[0].isReference, true);
    assert.equal(market.initialChart, null, 'client can fetch chart when SSR source fails');
    assert.equal((await snapshots.heatmap).initialData, null);
    assert.equal((await snapshots.news).initialNews.length, 0);
    assert.equal((await snapshots.movers).initialMoversFetchedAt, 0);
    assert.equal((await snapshots.gold).initialGoldPrices.length, 0);
});
