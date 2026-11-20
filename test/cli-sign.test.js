import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = (...args) => spawnSync('node', [new URL('../bin/volumio-plugin.js', import.meta.url).pathname, ...args], { encoding: 'utf8' });

test('sign then verify a package; a changed zip or an unknown key fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vps-'));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(join(dir, 'pub.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
  writeFileSync(join(dir, 'priv.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const zip = join(dir, 'hello_volumio-1.0.0-armhf.zip');
  writeFileSync(zip, 'zip bytes');
  writeFileSync(join(dir, 'hello_volumio-1.0.0-armhf.provenance.json'), JSON.stringify({ id: 'hello_volumio', version: '1.0.0', arch: 'armhf', sha256: 'ignored' }));

  assert.equal(cli('sign', zip, '--key', join(dir, 'priv.pem'), '--key-id', 'dev-1').status, 0);
  const ok = cli('verify', zip, '--key', `dev-1=${join(dir, 'pub.pem')}`);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /hello_volumio 1\.0\.0 armhf/);

  assert.equal(cli('verify', zip, '--key', `other=${join(dir, 'pub.pem')}`).status, 1);
  appendFileSync(zip, 'tampered');
  assert.match(cli('verify', zip, '--key', `dev-1=${join(dir, 'pub.pem')}`).stderr, /sha256/);
  assert.equal(cli('sign', zip).status, 2);
});
