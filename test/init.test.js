import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initPlugin } from '../src/init.js';
import { check } from '../src/check.js';
import { toV1 } from '../src/fromV1.js';

const FUNCTION = JSON.parse(readFileSync(new URL('../registry/functions.json', import.meta.url), 'utf8'))[0].id;
const options = { id: 'my_radio', type: 'music_service', function: FUNCTION, title: 'My "best" radio', description: 'Plays my radio' };
const tmp = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'init-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'plugin');
};
const json = (dir, file) => JSON.parse(readFileSync(join(dir, file), 'utf8'));

test('a new plugin passes every check with nothing to report', (t) => {
  const dir = tmp(t);
  initPlugin(dir, options);
  assert.deepEqual(check(dir).findings, []);
  assert.equal(json(dir, 'volumio-plugin.json').title, 'My "best" radio');
  assert.equal(json(dir, 'i18n/strings_en.json').PLUGIN_NAME, 'My "best" radio');
  assert.equal(json(dir, 'UIConfig.json').sections[0].onSave.endpoint, 'music_service/my_radio');
  assert.match(readFileSync(join(dir, 'index.js'), 'utf8'), /class MyRadio \{/);
  assert.ok(existsSync(join(dir, '.gitignore')));
});

test('its own tests pass against the fake Volumio', (t) => {
  const dir = tmp(t);
  initPlugin(dir, options);
  assert.equal(spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir }).status, 0);
  // Without NODE_TEST_CONTEXT, which would make the plugin's runner report to this one and exit 0.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const result = spawnSync('npm', ['test'], { cwd: dir, encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('bad values and a folder in use write nothing', (t) => {
  const dir = tmp(t);
  assert.throws(() => initPlugin(dir, { ...options, id: 'my-radio' }), /id must match/);
  assert.ok(!existsSync(dir));
  initPlugin(dir, options);
  assert.throws(() => initPlugin(dir, options), /not empty/);
});

test('an id starting with a digit still gives a valid class name', (t) => {
  const dir = tmp(t);
  initPlugin(dir, { ...options, id: '80s_radio' });
  assert.match(readFileSync(join(dir, 'index.js'), 'utf8'), /class Plugin80sRadio \{/);
});

test('the package.json Volumio reads comes from the manifest', () => {
  const manifest = { id: 'my_radio', version: '1.2.0', type: 'music_service', title: 'My radio', description: 'Plays', icon: 'fa-music',
    engines: { volumio: '>=4.0.0 <5.0.0', api: '2' }, arch: ['armhf', 'amd64'], license: 'MIT' };
  assert.deepEqual(toV1(manifest, { private: true, main: 'index.js', engines: { node: '>=20' }, dependencies: { kew: '^0.7.0' } }), {
    private: true, main: 'index.js', dependencies: { kew: '^0.7.0' },
    name: 'my_radio', version: '1.2.0', description: 'Plays', license: 'MIT',
    engines: { node: '>=20', volumio: '>=4.0.0 <5.0.0' },
    volumio_info: { plugin_type: 'music_service', prettyName: 'My radio', details: 'Plays', icon: 'fa-music', architectures: ['armhf', 'amd64'], os: ['bookworm'] },
  });
});

test('a v2 source may not set what package generates', (t) => {
  const dir = tmp(t);
  initPlugin(dir, options);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...json(dir, 'package.json'), name: 'x', version: '1.0.0', volumio_info: {} }));
  assert.deepEqual(check(dir).findings.map((f) => f.message), ['name', 'version', 'volumio_info']
    .map((k) => `package.json sets ${k}, which is generated from volumio-plugin.json`));
  assert.deepEqual(check(dir, { built: true }).findings.filter((f) => f.rule === 'G1.package-json'), []);
});
