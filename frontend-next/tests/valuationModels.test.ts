/* eslint-disable @typescript-eslint/no-require-imports */
export {};
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/valuationModels.ts');
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = module.paths;
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const { reconcileModelSelection, weightedValuation, isModelAvailable } = compiled.exports;
const selection = () => Object.fromEntries(['fcfe', 'fcff', 'justified_pe', 'justified_pb', 'graham'].map(key => [key, { enabled: false, weight: 0 }]));

test('sector policy enables recovered models and normalizes valid weights', () => {
    const next = reconcileModelSelection(selection(), { valuations: { fcfe: 200, fcff: 300 }, inputs: { model_weights: { fcfe: 20, fcff: 80 } } });
    assert.equal(next.fcfe.enabled, true);
    assert.equal(next.fcfe.weight, 20);
    assert.equal(next.fcff.weight, 80);
    assert.equal(weightedValuation({ fcfe: 200, fcff: 300 }, { fcfe: next.fcfe.weight, fcff: next.fcff.weight }), 280);
});

test('explicitly disabled models stay disabled and all-off returns zero', () => {
    const next = reconcileModelSelection(selection(), { valuations: { fcfe: 200 }, inputs: { model_weights: { fcfe: 100 } } }, true);
    assert.equal(next.fcfe.enabled, false);
    assert.equal(weightedValuation({ fcfe: 200 }, { fcfe: next.fcfe.weight }), 0);
});

test('bank CFO models cannot be enabled even with legacy API responses', () => {
    const result = { inputs: { is_bank: true }, valuations: { fcfe: 1e6, fcff: 1e6 } };
    assert.equal(isModelAvailable('fcff', result), false);
    assert.equal(isModelAvailable('fcfe', result), false);
});

test('invalid and unavailable results are excluded from both selection and blending', () => {
    assert.equal(isModelAvailable('fcfe', { valuations: { fcfe: NaN } }), false);
    assert.equal(isModelAvailable('fcfe', { valuations: { fcfe: 100 }, model_diagnostics: { fcfe: { available: false, applicable: true } } }), false);
    assert.equal(weightedValuation({ fcfe: NaN, fcff: 300 }, { fcfe: 50, fcff: 50 }), 300);
    assert.equal(weightedValuation({ fcfe: 200, fcff: 300 }, { fcfe: -50, fcff: 50 }), 300);
});
