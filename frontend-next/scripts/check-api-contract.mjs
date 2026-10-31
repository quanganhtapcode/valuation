import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = JSON.parse(fs.readFileSync(path.join(root, '../tests/fixtures/api_contract.json'), 'utf8'));
const calls = [];
let responseFactory = () => new Response('{}');
const memo = new Map();
function load(name) {
    if (memo.has(name)) return memo.get(name);
    const filename = path.join(root, 'src/lib', `${name}.ts`);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const sandboxModule = { exports: {} };
    vm.runInNewContext(source, {
        module: sandboxModule, exports: sandboxModule.exports, URL, Headers, Response, AbortSignal, console,
        process: { env: { NODE_ENV: 'production' } },
        fetch: async (url, options) => { calls.push({ url, options }); return responseFactory(); },
        require: (id) => id.endsWith('.json')
            ? JSON.parse(fs.readFileSync(path.join(root, 'src/lib', id), 'utf8'))
            : load(id.replace('./', '')),
    }, { filename });
    memo.set(name, sandboxModule.exports);
    return sandboxModule.exports;
}
const { apiFetch, decodeApiEnvelope, withApiSchema } = load('apiFetch');
const { apiUrl } = load('apiConfig');
const plain = value => JSON.parse(JSON.stringify(value));
for (const fixture of fixtures) {
    assert.deepEqual(plain(decodeApiEnvelope(fixture.envelope, fixture.shape)), fixture.payload, fixture.name);
    responseFactory = () => new Response(JSON.stringify(fixture.envelope), {
        status: fixture.status,
        headers: { 'X-API-Schema': '2', 'X-API-Shape': fixture.shape, 'Content-Type': 'application/json' },
    });
    const response = await apiFetch('https://trading-api.quanganh.org/v1/valuation/stocks/VCB/quote');
    assert.deepEqual(plain(await response.clone().json()), fixture.payload, fixture.name);
    assert.deepEqual(await response.payload(), fixture.envelope, fixture.name);
}
const url = 'https://trading-api.quanganh.org/v1/valuation/stocks/VCB/news?page=2&compact=1';
assert.equal(new URL(withApiSchema(url)).searchParams.get('page'), '2');
assert.equal(new URL(withApiSchema(url)).searchParams.get('schema'), '2');
assert.equal(withApiSchema('/api/stocks/VCB/quote'), '/api/stocks/VCB/quote?schema=2');
assert.equal(withApiSchema(`${url}&schema=1`), `${url}&schema=1`);
const signed = 'https://storage.example/file?signature=keep%2Bthis';
assert.equal(withApiSchema(signed), signed);
assert.equal(withApiSchema('/ticker_data.json'), '/ticker_data.json');
responseFactory = () => new Response('file bytes', { headers: { 'Content-Type': 'application/octet-stream' } });
assert.equal(await (await apiFetch(signed)).blob().then(blob => blob.text()), 'file bytes');
responseFactory = () => new Response(JSON.stringify({ success: true, symbol: 'VCB', current_price: 0 }));
assert.deepEqual(await (await apiFetch(url)).json(), { success: true, symbol: 'VCB', current_price: 0 });
const body = JSON.stringify({ price: 0, enabled: false });
await apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
assert.equal(calls.at(-1).options.body, body);
assert.equal(calls.at(-1).options.method, 'POST');
assert(!Object.keys(calls.at(-1).options.headers).some(key => key.toLowerCase().startsWith('x-api')));
assert.throws(() => decodeApiEnvelope({ meta: {} }, 'object'), /missing data/);
assert.throws(() => decodeApiEnvelope({ data: {} }, 'unknown'), /Unknown API shape/);
const { fetchNews } = load('newsApi');
responseFactory = () => new Response(JSON.stringify({ data: [{ title: 'Test' }] }), {
    headers: { 'X-API-Schema': '2', 'X-API-Shape': 'data' },
});
await fetchNews(1, 30);
assert.equal(new URL(calls.at(-1).url).origin, 'https://trading-api.quanganh.org');
assert.equal(new URL(calls.at(-1).url).pathname, '/v1/valuation/market/news');
assert.equal(new URL(calls.at(-1).url).searchParams.get('schema'), '2');
assert.equal(apiUrl('/market/p2p'), 'https://trading-api.quanganh.org/v1/valuation/market/p2p');
console.log(`PASS: ${fixtures.length} cross-language response fixtures, legacy fallback, typed envelopes, URL negotiation, binary downloads and unchanged POST bodies.`);
