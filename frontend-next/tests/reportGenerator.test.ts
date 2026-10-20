/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts: typeof import('typescript') = require('typescript');
const ExcelJS: typeof import('exceljs') = require('exceljs');

// Run with: node scripts/test-valuation-export.mjs
// Compile the browser module without adding a test framework or invoking downloads.
const filename = path.resolve(__dirname, '../src/lib/reportGenerator.ts');
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = module.paths;
compiled.require = (id: string) => id === './apiCore' ? { API_BASE: '/api' } : require(id);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const { ReportGenerator } = compiled.exports;

function fixture(years = 5) {
    const generator = new ReportGenerator();
    generator.projectionYears = years;
    const workbook = new ExcelJS.Workbook();
    const data = {
        inputs: { current_price: 20000, eps_ttm: 2000, bvps: 15000, shares_outstanding: 100000000, rev_per_share: 30000 },
        valuations: { fcfe: 30000, fcff: 28000, justified_pe: 36000, justified_pb: 30000, graham: 25980, justified_ps: 45000 },
        fcfe_details: { annual_growth: 0.08, discount_rate: 0.12, terminal_growth: 0.03, years },
        fcff_details: { discount_rate: 0.10, net_debt_per_share: 5000 },
        export: { calculation: {
            dcf_fcfe: { operating_cf: 300e9, net_borrowing: 20e9 },
            dcf_fcff: { capex_net: 50e9, interest_after_tax: 10e9 },
            justified_pe: { eps_metric_used: 2400, pe_used: 15 },
            justified_pb: { pb_used: 2 }, justified_ps: { ps_used: 1.5 },
        } },
    };
    const weights = { fcfe: 25, fcff: 25, justified_pe: 20, justified_pb: 20, graham: 10 };
    generator.createAssumptionsSheet(workbook.addWorksheet('Assumptions'), {}, data, {}, weights, 'FPT', null, { income: [], balance: [], cashflow: [], years: [] });
    for (const type of ['FCFE', 'FCFF']) generator.buildDCFSheet(workbook.addWorksheet(`${type} Model`), type, data);
    generator.createComparablesSheet(workbook.addWorksheet('Comparables'), data);
    generator.createForecastDriversSheet(workbook.addWorksheet('Forecast Drivers'), { income: [], cashflow: [] }, data, 'FPT');
    generator.createSummarySheet(workbook.addWorksheet('Summary'), {}, data, weights, 'FPT');
    generator.styleWorkbook(workbook);
    return { generator, workbook };
}

for (const years of [1, 5, 10, 20]) {
    test(`DCF and summary reference equity results with ${years} projection years`, () => {
        const { generator, workbook } = fixture(years);
        for (const type of ['FCFE', 'FCFF']) {
            const sheet = workbook.getWorksheet(`${type} Model`)!;
            const row = generator.computeDCFIntrinsicRow(type);
            assert.match(sheet.getCell(row, 1).text, /INTRINSIC EQUITY VALUE/);
            assert.ok(sheet.getCell(row, 2).formula);
            const upside = sheet.getRow(row + 2).getCell(2);
            assert.match(upside.formula, new RegExp(`B${row}-B${row + 1}`));
        }
        const summary = workbook.getWorksheet('Summary')!;
        assert.match(summary.getCell('B17').formula, /FCFF Model/);
        assert.match(summary.getCell('B21').formula, /B26\*Assumptions!B29/);
        assert.equal(workbook.getWorksheet('Assumptions')!.getCell('B62').value, 0);
        assert.equal(workbook.getWorksheet('Comparables')!.getCell('B5').formula, 'Assumptions!B25');
        const drivers = workbook.getWorksheet('Forecast Drivers')!;
        assert.equal(drivers.columnCount, years + 2);
        assert.equal(drivers.getCell('C7').formula, 'Assumptions!B19');
        assert.match(workbook.getWorksheet('FCFE Model')!.getCell('B13').formula, /IF\(B11>0/);
        assert.equal(workbook.getWorksheet('Assumptions')!.getCell('B19').value, 0.08);
        assert.equal(workbook.getWorksheet('Assumptions')!.getCell('B21').value, 0.12);
    });
}

test('serialized workbook preserves formulas and Data Download typography', async () => {
    const { workbook } = fixture();
    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.load(await workbook.xlsx.writeBuffer());
    reloaded.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => {
        if (cell.isMerged && cell.master.address !== cell.address) return;
        assert.equal(cell.font.name, 'Calibri');
        if (cell.formula) {
            assert.ok(!cell.formula.startsWith('='));
            assert.ok(!cell.formula.includes('#REF!'));
        }
    })));
    const summary = reloaded.getWorksheet('Summary')!;
    assert.equal((summary.getCell('A1').fill as import('exceljs').FillPattern).fgColor?.argb, '00308C');
    assert.ok(summary.getCell('B23').formula);
    assert.ok(summary.getCell('D16').formula);
    assert.match(summary.getCell('B29').formula, /IF\(OR/);
});

const { workbookEvaluator } = require('./helpers/workbookEvaluator.mjs');
const liveFixtures = require('./fixtures/valuation-export.json');
const closeTo = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < 0.01, `${label}: ${actual} vs ${expected}`);

for (const symbol of ['FPT', 'VCB']) {
    test(`${symbol}: formulas reconcile with API results and recalculate after edits`, async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ year: 2025, isa1: 100e9, isa5: 30e9, isa11: 20e9, isa20: 15e9, isa23: 2000, bsa78: 100e9, bsa53: 200e9, cfa18: 30e9, cfa19: -5e9 }] }));
        try {
            const data = structuredClone(liveFixtures[symbol]);
            const workbook: import('exceljs').Workbook = await new ReportGenerator({ show() {} }).createWorkbook({}, data, {}, {}, symbol);
            const evaluator = workbookEvaluator(workbook);
            for (const [address, key] of [['B16', 'fcfe'], ['B17', 'fcff'], ['B18', 'justified_pe'], ['B19', 'justified_pb'], ['B20', 'graham'], ['B23', 'weighted_average']]) {
                closeTo(evaluator.read('Summary', address), data.valuations[key], `${symbol} ${key}`);
            }
            workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => {
                if (cell.formula) evaluator.read(sheet.name, cell.address);
            })));
            assert.equal(workbook.calcProperties.fullCalcOnLoad, true);
            assert.equal(workbook.getWorksheet('Sector Peers')!.getColumn(1).width, 5);
            assert.equal(workbook.getWorksheet('Summary')!.getCell('A1').font.size, 18);
            assert.equal(workbook.getWorksheet('Assumptions')!.getCell('B19').protection.locked, false);
            const assumptions = workbook.getWorksheet('Assumptions')!;
            for (const r of [57, 58, 59, 60, 61, 62]) assumptions.getCell(r, 2).value = r === 59 ? 100 : 0;
            assumptions.getCell('B25').value = 3000;
            assumptions.getCell('B27').value = 12;
            evaluator.reset();
            closeTo(evaluator.read('Summary', 'B23'), 36000, 'edited weighted value');
            closeTo(evaluator.read('Summary', 'B27'), 36000, 'edited verdict fair value');
            assumptions.getCell('B7').value = 0;
            assumptions.getCell('B15').value = 0;
            assumptions.getCell('B20').value = 0.50;
            evaluator.reset();
            closeTo(evaluator.read('Summary', 'E23'), 0, 'zero-price upside');
            assert.equal(evaluator.read('Summary', 'B29'), 'N/A');
            closeTo(evaluator.read('FCFE Model', 'B13'), 0, 'zero-shares cash flow');
            assumptions.getCell('B21').value = -1;
            assumptions.getCell('B22').value = -1;
            evaluator.reset();
            for (const name of ['FCFE Model', 'FCFF Model']) {
                workbook.getWorksheet(name)!.eachRow(row => row.eachCell(cell => {
                    if (cell.formula) evaluator.read(name, cell.address);
                }));
            }
            for (const r of [57, 58, 59, 60, 61, 62]) assumptions.getCell(r, 2).value = 0;
            evaluator.reset();
            closeTo(evaluator.read('Summary', 'B23'), 0, 'all-zero weights');
            if (process.env.VALUATION_EXPORT_ARTIFACT_DIR) {
                const original: import('exceljs').Workbook = await new ReportGenerator({ show() {} }).createWorkbook({}, data, {}, {}, symbol);
                const folder = process.env.VALUATION_EXPORT_ARTIFACT_DIR;
                fs.mkdirSync(folder, { recursive: true });
                const originalEvaluator = workbookEvaluator(original);
                original.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => {
                    if (cell.formula) cell.value = { formula: cell.formula, result: originalEvaluator.read(sheet.name, cell.address) };
                })));
                await original.xlsx.writeFile(path.join(folder, `${symbol}_Valuation_Model.xlsx`));
                fs.writeFileSync(path.join(folder, `${symbol}_workbook.json`), JSON.stringify(original.model));
            }
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
}
