import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

// Next's server test helpers expect the globals normally installed by Next.
globalThis.AsyncLocalStorage = AsyncLocalStorage;
const filename = fileURLToPath(new URL('../src/proxy.test.ts', import.meta.url));
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const sandboxModule = { exports: {} };
vm.runInNewContext(source, {
    module: sandboxModule, exports: sandboxModule.exports, require: createRequire(filename),
    process, console, URL,
}, { filename });
