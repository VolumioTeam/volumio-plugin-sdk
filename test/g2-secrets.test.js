import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { secretFindings } from '../src/g2/secrets.js';

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
