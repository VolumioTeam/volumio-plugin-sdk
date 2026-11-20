import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from '../src/check.js';

const v2Manifest = {
  id: 'radio_paradise',
  version: '2.1.0',
  type: 'music_service',
  function: 'radio-paradise',
  title: 'Radio Paradise',
  description: 'Listen to Radio Paradise',
  engines: { volumio: '>=4.0.0 <5.0.0', api: '2' },
  arch: ['armhf', 'amd64'],
  permissions: ['playback'],
  license: 'MIT',
};

const v1Package = {
  name: 'radio_paradise',
  version: '1.4.0',
  main: 'index.js',
  license: 'ISC',
  engines: { node: '>=20', volumio: '>=4' },
  volumio_info: { plugin_type: 'music_service', architectures: ['armhf'], prettyName: 'Radio Paradise', details: 'Listen', os: ['bookworm'] },
};

const plugin = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'vp-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
};

const required = { 'README.md': '# x', LICENSE: 'MIT', 'i18n/strings_en.json': '{}' };
const opts = { functions: ['radio-paradise'] };
const rules = (result) => result.findings.map((f) => `${f.severity} ${f.rule}`);

test('a complete v2 plugin passes', () => {
  const dir = plugin({ ...required, 'volumio-plugin.json': v2Manifest, 'package.json': { main: 'index.js' } });
  const result = check(dir, opts);
  assert.equal(result.source, 'v2');
  assert.deepEqual(result.findings, []);
});

test('reports each missing required file of the source', () => {
  const dir = plugin({ 'volumio-plugin.json': v2Manifest, 'package.json': { main: 'index.js' } });
  assert.deepEqual(rules(check(dir, opts)), ['error G1.file.readme', 'error G1.file.license']);
});

test('a built package must also carry the English strings', () => {
  const dir = plugin({ 'README.md': '# x', LICENSE: 'MIT', 'volumio-plugin.json': v2Manifest, 'package.json': { main: 'index.js' } });
  assert.deepEqual(rules(check(dir, { ...opts, built: true })), ['error G1.file.i18n']);
});

test('a v1 plugin without a LICENSE file only gets a warning', () => {
  const { LICENSE: _omit, ...noLicense } = required;
  const dir = plugin({ ...noLicense, 'package.json': v1Package });
  assert.deepEqual(rules(check(dir, opts)), ['warning G1.file.license', 'todo G1.v2-fields']);
});

test('a function outside the registry is an error', () => {
  const dir = plugin({ ...required, 'volumio-plugin.json': v2Manifest, 'package.json': { main: 'index.js' } });
  assert.deepEqual(rules(check(dir, { functions: [] })), ['error G1.function']);
});

test('an invalid volumio range is an error', () => {
  const manifest = { ...v2Manifest, engines: { volumio: 'four', api: '2' } };
  const dir = plugin({ ...required, 'volumio-plugin.json': manifest, 'package.json': { main: 'index.js' } });
  assert.deepEqual(rules(check(dir, opts)), ['error G1.engines']);
});

test('main must be index.js in the built package, for the crypter', () => {
  const dir = plugin({ ...required, 'volumio-plugin.json': v2Manifest, 'package.json': { main: './dist/index.js' } });
  assert.deepEqual(rules(check(dir, { ...opts, built: true })), ['error G1.main']);
});

test('the source may point main at a build folder', () => {
  const dir = plugin({ ...required, 'volumio-plugin.json': v2Manifest, 'package.json': { main: './dist/index.js' } });
  assert.deepEqual(rules(check(dir, opts)), []);
});

test('a v1 plugin is read through the shim; new v2 fields are todo, not errors', () => {
  const dir = plugin({ ...required, 'package.json': v1Package });
  const result = check(dir, opts);
  assert.equal(result.source, 'v1');
  assert.deepEqual(rules(result), ['todo G1.v2-fields']);
  assert.deepEqual(result.dropped, ['os']);
});

test('a v1 name with a hyphen is a schema error on id', () => {
  const dir = plugin({ ...required, 'package.json': { ...v1Package, name: 'gpio-buttons' } });
  const schemaErrors = check(dir, opts).findings.filter((f) => f.rule === 'G1.schema');
  assert.deepEqual(schemaErrors.map((f) => f.path), ['/id']);
});

test('unreadable JSON is a finding, not a crash', () => {
  const dir = plugin({ ...required, 'volumio-plugin.json': '{ nope', 'package.json': { main: 'index.js' } });
  assert.deepEqual(rules(check(dir, opts)), ['error G1.json']);
});

test('a folder with neither manifest is a finding', () => {
  const dir = plugin(required);
  assert.deepEqual(rules(check(dir, opts)), ['error G1.manifest']);
});

test('the bundled registry is used when none is given', () => {
  const manifest = { ...v2Manifest, function: 'spotify-connect' };
  const dir = plugin({ ...required, 'volumio-plugin.json': manifest, 'package.json': { main: 'index.js' } });
  assert.deepEqual(rules(check(dir)), []);
});

test('G2 runs with G1: a v2 plugin with console.log fails', () => {
  const dir = plugin({ ...required, 'volumio-plugin.json': v2Manifest, 'package.json': { main: 'index.js' }, 'index.js': "console.log('x');" });
  assert.deepEqual(rules(check(dir, { ...opts, baseline: {} })), ['error G2.js.console-log']);
});

test('G2 on a v1 plugin in its baseline: one warning per known rule and file', () => {
  const dir = plugin({ ...required, 'package.json': v1Package, 'index.js': "console.log('x');\nconsole.log('y');" });
  const baseline = { radio_paradise: { 'G2.js.console-log|index.js': 2 } };
  assert.deepEqual(rules(check(dir, { ...opts, baseline })), ['warning G2.js.console-log', 'todo G1.v2-fields']);
});

test('a v1 built package with main in a build folder only gets a warning', () => {
  const dir = plugin({ ...required, 'package.json': { ...v1Package, main: './dist/index.js' } });
  assert.deepEqual(rules(check(dir, { ...opts, built: true, baseline: {} })), ['warning G1.main', 'todo G1.v2-fields']);
});

test('the result carries the version', () => {
  const dir = plugin({ ...required, 'volumio-plugin.json': v2Manifest, 'package.json': { main: 'index.js' } });
  assert.equal(check(dir, opts).version, '2.1.0');
});
