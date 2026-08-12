import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(process.cwd(), 'src');
const strict = process.argv.includes('--strict');
const ignored = new Set(['lib/translations.ts', 'lib/i18nRouting.ts', 'lib/legalContent.ts']);
const findings = [];

function visit(path) {
  for (const name of readdirSync(path)) {
    const target = join(path, name);
    if (statSync(target).isDirectory()) visit(target);
    else if (/\.(ts|tsx)$/.test(name)) inspect(target);
  }
}

function inspect(path) {
  const file = relative(root, path).replaceAll('\\', '/');
  if (ignored.has(file) || file.endsWith('/layout.tsx') || file === 'app/layout.tsx') return;
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((line, index) => {
    const directLangConditional = /lang\s*===\s*['"](?:vi|en)['"].*\?.*['"`].*:\s*['"`]/.test(line);
    const localeAliasConditional = /\b(?:vi|isEnglish|isVietnamese)\s*\?.*['"`].*:\s*['"`]/.test(line);
    const bilingualInlineObject = /\bvi\s*:\s*['"`\[].*\ben\s*:\s*['"`\[]/.test(line);
    if (directLangConditional || localeAliasConditional || bilingualInlineObject) {
      findings.push(`${file}:${index + 1}: inline locale conditional`);
    }
  });
}

visit(root);

if (findings.length) {
  console.log(findings.join('\n'));
  console.log(`\n${findings.length} inline locale conditionals remain.`);
  if (strict) process.exitCode = 1;
} else {
  console.log('i18n audit passed: no inline locale conditionals.');
}
