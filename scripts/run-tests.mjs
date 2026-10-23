// Cross-version test runner (Node 18, 20, 24). Passes explicit file paths to
// `node --test` instead of relying on shell globbing or version-specific discovery.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'tests');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort()
  .map((f) => join(dir, f));

if (files.length === 0) {
  console.error(`No *.test.mjs files found in ${dir}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
