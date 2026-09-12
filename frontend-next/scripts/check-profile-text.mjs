import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/profileText.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const context = { exports: {} };
vm.runInNewContext(outputText, context);
const { profileToText } = context.exports;
const cases = [
    ['<p>Ng&acirc;n h&agrave;ng Ngoại thương Việt Nam&nbsp;(VCB)</p>', 'Ngân hàng Ngoại thương Việt Nam (VCB)'],
    ['C&ocirc;ng ty FPT: 10.000 m&sup2;', 'Công ty FPT: 10.000 m²'],
    ['Đ&ocirc;ng Nam &Aacute; &amp; H&ograve;a Ph&aacute;t', 'Đông Nam Á & Hòa Phát'],
    ['&#x1ec7; &#7879; &Agrave; &agrave;', 'ệ ệ À à'],
    ['<style>bad</style><script>bad()</script><p>A</p><p>B</p>', 'A B'],
    ['&lt;script&gt;literal&lt;/script&gt;', '<script>literal</script>'],
    ['&unknown; &constructor; &#xD800;', '&unknown; &constructor; �'],
    [null, ''],
];
for (const [input, expected] of cases) assert.equal(profileToText(input), expected);
console.log(`${cases.length} profile text regression checks passed.`);
