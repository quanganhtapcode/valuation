import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/p2pSource.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const ad = (price, positiveRate) => ({ price, adNo: String(price), tradableAmount: 2000, minTransAmount: 1, maxTransAmount: 5000,
    advertiser: { nickName: 'trader', monthFinishRate: 0.99, monthOrderCount: 50, positiveRate } });
const okxAd = (price, posReviewPercentage) => ({ price, id: String(price), nickName: 'trader', completedRate: '0.99',
    completedOrderQuantity: 50, availableAmount: '2000', quoteMinAmountPerOrder: '1', quoteMaxAmountPerOrder: '100000000', posReviewPercentage });
const originalFetch = globalThis.fetch;
globalThis.fetch = async url => {
    const address = String(url);
    if (address.includes('binance.com')) return Response.json({ success: true, data: { items: [ad(25000, 0.78), ad(25001, null), ad(25002, 0.95)] } });
    if (address.includes('okx.com')) {
        const side = new URL(address).searchParams.get('side');
        return Response.json({ code: 0, data: { [side]: [okxAd(25000, '0.80'), okxAd(25001, '-1')] } });
    }
    return new Response('', { status: 503 });
};
try {
    const { getP2PSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
    const data = await getP2PSnapshot();
    assert.equal(data.binance.buy.offer.price, 25002, 'Low and missing Binance feedback must be excluded; 95% is accepted');
    assert.equal(data.okx.buy.offer.price, 25001, 'Known low OKX feedback is excluded; unavailable feedback remains eligible');
    console.log('P2P positive feedback filters passed');
} finally {
    globalThis.fetch = originalFetch;
}
