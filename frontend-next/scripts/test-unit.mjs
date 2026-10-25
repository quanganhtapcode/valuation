import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const directory = new URL('../src/lib/', import.meta.url);
const files = readdirSync(directory).filter(name => name.endsWith('.test.ts')).sort()
  .map(name => fileURLToPath(new URL(name, directory)));
if (files.length === 0) throw new Error('No unit tests found');

const result = spawnSync(process.execPath, [
  '--require', fileURLToPath(new URL('./register-typescript.js', import.meta.url)),
  '--test', ...files,
], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
