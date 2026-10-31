// Transpile the shared TypeScript source in memory, keeping both consumers in sync.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const sourceUrl = new URL('../frontend-next/src/lib/p2pSource.ts', import.meta.url);
const require = createRequire(new URL('../frontend-next/package.json', import.meta.url));
const typescript = require('typescript');
const source = await readFile(sourceUrl, 'utf8');
const javascript = typescript.transpileModule(source, {
    compilerOptions: { target: typescript.ScriptTarget.ES2022, module: typescript.ModuleKind.ES2022 },
}).outputText;
const { getP2PSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
process.stdout.write(JSON.stringify(await getP2PSnapshot()));
