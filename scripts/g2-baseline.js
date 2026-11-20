#!/usr/bin/env node
// Records the G2 violations the published plugins have today, so only new ones block.
// Usage: node scripts/g2-baseline.js <dir with one folder per plugin>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rawG2 } from '../src/g2/index.js';
import { SHELLCHECK_VERSION, shellcheckVersion } from '../src/g2/shell.js';
import { countByKey } from '../src/g2/baseline.js';
import { GITLEAKS_VERSION, gitleaksVersion } from '../src/g2/secrets.js';

const root = process.argv[2];
if (!root) {
  process.stderr.write('Usage: node scripts/g2-baseline.js <plugins-dir>\n');
  process.exit(2);
}
// Without the pinned ShellCheck and gitleaks their counts would drop out of the baseline, and come back as new violations.
const pinned = [['ShellCheck', SHELLCHECK_VERSION, shellcheckVersion()], ['gitleaks', GITLEAKS_VERSION, gitleaksVersion()]];
for (const [tool, wanted, found] of pinned) {
  if (found === wanted) continue;
  process.stderr.write(`${tool} ${wanted} is required to record the baseline (found ${found ?? 'none'}): run it in the build container\n`);
  process.exit(1);
}

const idOf = (dir) => {
  const v2 = join(dir, 'volumio-plugin.json');
  return JSON.parse(readFileSync(existsSync(v2) ? v2 : join(dir, 'package.json'), 'utf8'))[existsSync(v2) ? 'id' : 'name'];
};

const entries = readdirSync(root)
  .map((name) => join(root, name))
  .filter((dir) => existsSync(join(dir, 'package.json')) || existsSync(join(dir, 'volumio-plugin.json')))
  .map((dir) => [idOf(dir), countByKey(rawG2(dir))])
  .filter(([, counts]) => Object.keys(counts).length > 0)
  .sort(([a], [b]) => a.localeCompare(b));

const out = new URL('../registry/g2-baseline.json', import.meta.url);
writeFileSync(out, `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`);
process.stdout.write(`${entries.length} plugins with known G2 violations written to registry/g2-baseline.json\n`);
