import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, licenceFindings } from '../src/licence.js';

test('licences are permissive, copyleft, missing or unknown', () => {
  for (const id of ['MIT', 'ISC', 'BSD-3-Clause', 'Apache-2.0', 'MPL-2.0', 'Zlib', 'CC0-1.0', 'Unlicense', '0BSD', 'BlueOak-1.0.0']) assert.equal(classify(id), 'permissive', id);
  for (const id of ['GPL-3.0-only', 'GPL-2.0-or-later', 'LGPL-2.1', 'AGPL-3.0', 'GPLV3', 'LGPL']) assert.equal(classify(id), 'copyleft', id);
  for (const id of [undefined, '', 'UNLICENSED', 'SEE LICENSE IN LICENSE.txt']) assert.equal(classify(id), 'missing', String(id));
  assert.equal(classify('WTFPL'), 'unknown');
});

test('an OR expression takes the best choice, AND the worst', () => {
  assert.equal(classify('(MIT OR GPL-3.0)'), 'permissive');
  assert.equal(classify('(MIT OR Apache-2.0) AND GPL-3.0-only'), 'copyleft');
  assert.equal(classify('MIT OR Apache-2.0 AND GPL-3.0-only'), 'permissive');
  assert.equal(classify('MIT AND GPL-3.0'), 'copyleft');
  assert.equal(classify('GPL-2.0 WITH Classpath-exception-2.0'), 'copyleft');
  assert.equal(classify({ type: 'MIT' }), 'permissive');
});

const installed = (deps) => {
  const dir = mkdtempSync(join(tmpdir(), 'lic-'));
  for (const [name, pkg] of Object.entries(deps)) {
    mkdirSync(join(dir, 'node_modules', name), { recursive: true });
    writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...pkg }));
  }
  return dir;
};
const brief = (findings) => findings.map((f) => `${f.severity} ${f.rule} ${f.message}`);

test('each installed dependency is checked: missing blocks v2, copyleft and unknown are warnings', () => {
  const dir = installed({
    ok: { license: 'MIT' },
    gpl: { license: 'GPL-3.0' },
    none: {},
    odd: { license: 'WTFPL' },
    '@scope/legacy': { licenses: [{ type: 'Apache-2.0' }] },
    'nested/node_modules/deep': { name: 'deep', license: 'UNLICENSED' },
  });
  assert.deepEqual(brief(licenceFindings(dir, 'v2')), [
    'warning G2.licence.copyleft gpl@1.0.0: GPL-3.0',
    'error G2.licence.missing deep@1.0.0: UNLICENSED',
    'error G2.licence.missing none@1.0.0: no licence',
    'warning G2.licence.unknown odd@1.0.0: WTFPL',
  ]);
  assert.deepEqual(licenceFindings(dir, 'v1').map((f) => f.severity), ['warning', 'warning', 'warning', 'warning']);
});
