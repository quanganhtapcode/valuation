import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const filename = fileURLToPath(new URL('../tests/reportGenerator.test.ts', import.meta.url));
const testModule = new Module(filename);
testModule.filename = filename;
testModule.paths = Module._nodeModulePaths(fileURLToPath(new URL('../tests', import.meta.url)));
testModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
