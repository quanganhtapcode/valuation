import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const filename = fileURLToPath(new URL('../src/lib/valuationChartApi.test.ts', import.meta.url));
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(source, {
    module: mod, exports: mod.exports, require: createRequire(filename),
    process, console, URL, URLSearchParams, AbortController, AbortSignal,
}, { filename });
