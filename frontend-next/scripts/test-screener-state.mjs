import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const output = mkdtempSync(join(tmpdir(), 'valuation-screener-'));
try {
  for (const name of ['screenerState', 'screenerState.test']) {
    const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    });
    writeFileSync(join(output, `${name}.js`), compiled.outputText);
  }
  const result = spawnSync(process.execPath, [join(output, 'screenerState.test.js')], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(output, { recursive: true, force: true });
}
