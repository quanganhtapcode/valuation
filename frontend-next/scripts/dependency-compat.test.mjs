import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const minimatch = require('minimatch');

test('legacy consumers resolve the callable API backed by patched minimatch', () => {
    const patched = createRequire(require.resolve('minimatch'))('minimatch-patched');
    for (const name of [
        'eslint', '@eslint/config-array', '@eslint/eslintrc',
        'eslint-plugin-react', 'eslint-plugin-import', 'eslint-plugin-jsx-a11y',
        '@typescript-eslint/typescript-estree', 'glob', 'readdir-glob',
    ]) {
        const consumer = createRequire(require.resolve(name));
        const matcher = consumer('minimatch');
        assert.equal(typeof matcher, 'function', name);
        assert(new matcher.Minimatch('*') instanceof patched.Minimatch, name);
        assert.equal(matcher('src/chart.tsx', '**/*.{ts,tsx}'), true, name);
        assert.equal(matcher('src/chart.js', '**/*.{ts,tsx}'), false, name);
    }
});

test('legacy default options and pattern helpers remain available', () => {
    assert.equal(minimatch('.hidden', '*'), false);
    const withDefaults = minimatch.defaults({ dot: true });
    assert.equal(withDefaults('.hidden', '*'), true);
    assert.equal(withDefaults.defaults({ nocase: true })('.HIDDEN', '.hidden'), true);
    assert.equal(new withDefaults.Minimatch('*').match('.hidden'), true);
    assert.deepEqual(minimatch.match(['a.ts', 'b.js'], '*.ts'), ['a.ts']);
    assert.deepEqual(['a.ts', 'b.js'].filter(minimatch.filter('*.ts')), ['a.ts']);
    assert.deepEqual(minimatch.braceExpand('*.{ts,tsx}'), ['*.ts', '*.tsx']);
    assert.equal(minimatch.makeRe('*.tsx').test('Chart.tsx'), true);
    assert.equal(new minimatch.Minimatch('**/*.ts').set[0][0], minimatch.GLOBSTAR);
});

test('glob and ExcelJS archive tooling still discover and zip matching files', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'valuation-archive-'));
    try {
        await mkdir(path.join(directory, 'nested'));
        await writeFile(path.join(directory, 'a.txt'), 'first');
        await writeFile(path.join(directory, 'nested/b.txt'), 'second');
        await writeFile(path.join(directory, 'nested/skip.csv'), 'skip');
        const glob = require('glob');
        assert.deepEqual(glob.sync('**/*.txt', { cwd: directory }).sort(), ['a.txt', 'nested/b.txt']);
        const archive = require('archiver')('zip');
        const chunks = [];
        const output = new Promise((resolve, reject) => {
            archive.on('data', chunk => chunks.push(chunk));
            archive.on('error', reject);
            archive.on('end', () => resolve(Buffer.concat(chunks)));
        });
        archive.glob('**/*.txt', { cwd: directory });
        await archive.finalize();
        const zip = await require('jszip').loadAsync(await output);
        assert.deepEqual(Object.keys(zip.files).sort(), ['a.txt', 'nested/b.txt']);
        assert.equal(await zip.file('nested/b.txt').async('string'), 'second');
        assert.equal(await readFile(path.join(directory, 'a.txt'), 'utf8'), 'first');
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('ExcelJS writes and reads formulas, styles and data bars with patched uuid', async () => {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Valuation');
    sheet.addRows([['Symbol', 'Price'], ['ACB', 42], ['BID', 50]]);
    sheet.getCell('B4').value = { formula: 'SUM(B2:B3)', result: 92 };
    sheet.getCell('B2').numFmt = '#,##0.00';
    sheet.addConditionalFormatting({
        ref: 'B2:B3',
        rules: [{
            type: 'dataBar',
            cfvo: [{ type: 'min' }, { type: 'max' }],
            color: { argb: 'FF00AA00' },
            gradient: false,
        }],
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const zip = await require('jszip').loadAsync(buffer);
    const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
    assert.match(xml, /x14:id>\{[A-F0-9-]{36}\}/);
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(buffer);
    assert.equal(loaded.getWorksheet('Valuation').getCell('B2').value, 42);
    assert.equal(loaded.getWorksheet('Valuation').getCell('B2').numFmt, '#,##0.00');
    assert.deepEqual(loaded.getWorksheet('Valuation').getCell('B4').value, { formula: 'SUM(B2:B3)', result: 92 });
});
