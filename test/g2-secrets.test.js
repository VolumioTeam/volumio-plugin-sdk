import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GITLEAKS_VERSION, secretFindings } from '../src/g2/secrets.js';

const tree = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'g2s-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
};
// Built at runtime so this file holds no token a scanner would flag.
const fake = (prefix, length, alphabet = 'A') => prefix + alphabet.repeat(length);

test('private keys and service tokens are found, with their position', () => {
  const dir = tree({
    'keys/dev.pem': `${'-----BEGIN'} PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n`,
    'index.js': `const a = 1;\nconst aws = '${fake('AKIA', 16)}';\nconst gh = '${fake('ghp_', 36, 'a')}';\n`,
    'config.json': `{"slack": "${fake('xoxb-', 20, '1')}", "google": "${fake('AIza', 35, 'b')}", "stripe": "${fake('sk_live_', 24, 'c')}"}`,
  });
  assert.deepEqual(secretFindings(dir).map((f) => `${f.rule}:${f.file}:${f.line} ${f.message}`), [
    'G2.secret:config.json:1 a Slack token in the package',
    'G2.secret:config.json:1 a Google API key in the package',
    'G2.secret:config.json:1 a Stripe live key in the package',
    'G2.secret:index.js:2 an AWS access key in the package',
    'G2.secret:index.js:3 a GitHub token in the package',
    'G2.secret:keys/dev.pem:1 a private key in the package',
  ]);
});

test('the finding never carries the secret itself', () => {
  const token = fake('ghp_', 36, 'z');
  const [finding] = secretFindings(tree({ 'index.js': `const t = '${token}';` }));
  assert.ok(!JSON.stringify(finding).includes(token));
});

test('dependencies, git data and binary files are not scanned', () => {
  const key = fake('AKIA', 16);
  const dir = tree({
    'node_modules/dep/index.js': key,
    '.git/config': key,
    'icon.png': Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]), Buffer.from(key)]),
  });
  assert.deepEqual(secretFindings(dir), []);
});

test('ordinary code is clean', () => {
  assert.deepEqual(secretFindings(tree({ 'index.js': "const key = 'public-id';\n// BEGIN PUBLIC KEY is fine\n" })), []);
});

test('a file with a NUL byte anywhere is binary, not only in its first 8000 bytes', () => {
  const key = fake('AKIA', 16);
  const dir = tree({ 'firmware.bin': Buffer.concat([Buffer.from('a'.repeat(9000)), Buffer.from([0]), Buffer.from(key)]) });
  assert.deepEqual(secretFindings(dir), []);
});

const hasGitleaks = !spawnSync('gitleaks', ['version']).error;
// Fixed values: gitleaks skips a generic key that contains a dictionary word, which random ones often do.
const KEY_1 = 'x7Kq9Zt2Wm4R' + 'p8Vn3Bs6Hy1Jc5Lf';
const KEY_2 = 'Q3wZ8kT6rN2m' + 'X9pL4vB7cJ1hD5gS';

test('gitleaks finds what the built-in patterns do not, and a plugin cannot silence it', { skip: !hasGitleaks && 'gitleaks not installed' }, () => {
  const dir = tree({
    'index.js': `const a = 1;\nconst apiKey = "${KEY_1}";\nconst other_api_key = "${KEY_2}"; // gitleaks:allow\n`,
    '.gitleaks.toml': "[allowlist]\npaths = ['''.*''']\n",
  });
  writeFileSync(join(dir, '.gitleaksignore'), `${dir}/index.js:generic-api-key:2\nindex.js:generic-api-key:2\n`);
  assert.deepEqual(secretFindings(dir).map((f) => `${f.rule}:${f.file}:${f.line} ${f.message}`), [
    'G2.secret.generic-api-key:index.js:2 generic-api-key (gitleaks) in the package',
    'G2.secret.generic-api-key:index.js:3 generic-api-key (gitleaks) in the package',
  ]);
});

test('a line both scanners flag is one finding', { skip: !hasGitleaks && 'gitleaks not installed' }, () => {
  const dir = tree({ 'index.js': `const aws = '${'AKIA' + 'Q7ZT2WM4RPJVN3BS'}';\n` });
  assert.deepEqual(secretFindings(dir).map((f) => `${f.rule}:${f.line}`), ['G2.secret:1']);
});

test('the build container installs the gitleaks version the baseline is recorded with', () => {
  const tools = readFileSync(new URL('../scripts/install-tools.sh', import.meta.url), 'utf8');
  assert.match(tools, new RegExp(`^GITLEAKS_VERSION=${GITLEAKS_VERSION.replace(/\./g, '\\.')}$`, 'm'));
});

test('the baseline is not rewritten without the pinned gitleaks', () => {
  const bin = mkdtempSync(join(tmpdir(), 'g2bin-'));
  writeFileSync(join(bin, 'shellcheck'), '#!/bin/sh\necho "version: 0.9.0"\n');
  chmodSync(join(bin, 'shellcheck'), 0o755);
  const registry = fileURLToPath(new URL('../registry/g2-baseline.json', import.meta.url));
  const before = readFileSync(registry, 'utf8');
  const script = fileURLToPath(new URL('../scripts/g2-baseline.js', import.meta.url));
  const run = spawnSync(process.execPath, [script, mkdtempSync(join(tmpdir(), 'g2root-'))], { encoding: 'utf8', env: { PATH: bin } });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /gitleaks/);
  assert.equal(readFileSync(registry, 'utf8'), before);
});
