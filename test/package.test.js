import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { archOf, declaredArches, elfArch, nativeFindings, packagePlugin } from '../src/package.js';

const elf = (machine) => {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(0x7f454c46, 0);
  b.writeUInt16LE(machine, 18);
  return b;
};

const tree = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'vpk-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), Buffer.isBuffer(content) || typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
};

const manifest = {
  id: 'example_plugin',
  version: '1.2.3',
  type: 'music_service',
  function: 'radio-paradise',
  title: 'Example',
  description: 'Example plugin',
  engines: { volumio: '>=4.0.0 <5.0.0', api: '1' },
  arch: ['armhf', 'amd64'],
  permissions: [],
  license: 'MIT',
};
const plugin = (extra = {}) => tree({
  'volumio-plugin.json': manifest,
  'package.json': { name: 'example_plugin', version: '1.2.3', main: 'index.js' },
  'index.js': 'module.exports = function () {};',
  'README.md': '# Example',
  LICENSE: 'MIT',
  'i18n/strings_en.json': '{}',
  'test/index.test.js': 'nothing',
  '.git/HEAD': 'ref',
  ...extra,
});
const options = (out) => ({ out, arch: 'amd64', epoch: 1700000000, functions: ['radio-paradise'], meta: { commit: 'abc' } });

test('maps Node architectures to Volumio ones', () => {
  assert.deepEqual(['arm', 'x64', 'arm64'].map(archOf), ['armhf', 'amd64', 'arm64']);
  assert.throws(() => archOf('ia32'), /ia32/);
});

test('lists the architectures a plugin declares, v1 or v2', () => {
  assert.deepEqual(declaredArches(tree({ 'volumio-plugin.json': manifest })), manifest.arch);
  assert.deepEqual(declaredArches(tree({ 'package.json': { name: 'p', volumio_info: { architectures: ['armhf', 'amd64'] } } })), ['armhf', 'amd64']);
});

test('an unknown or missing architecture stops the build before it starts', () => {
  assert.throws(() => declaredArches(tree({ 'package.json': { name: 'p', volumio_info: { architectures: ['armhf', 'i386'] } } })), /i386/);
  assert.throws(() => declaredArches(tree({ 'package.json': { name: 'p', volumio_info: {} } })), /no architecture/);
  assert.throws(() => declaredArches(tree({ 'README.md': '' })), /package\.json/);
});

test('reads the architecture of an ELF binary', () => {
  assert.deepEqual([elf(40), elf(62), elf(183)].map(elfArch), ['armhf', 'amd64', 'arm64']);
  assert.equal(elfArch(Buffer.from('not elf at all, really')), undefined);
});

test('a native module built for another architecture fails G3', () => {
  const dir = tree({ 'node_modules/foo/build/Release/foo.node': elf(62) });
  assert.deepEqual(nativeFindings(dir, 'amd64'), []);
  assert.deepEqual(nativeFindings(dir, 'armhf').map((f) => `${f.severity} ${f.rule} ${f.file}`), [
    'error G3.native-arch node_modules/foo/build/Release/foo.node',
  ]);
});

test('packages a plugin: zip at root, no tests or git, sha256 and provenance next to it', () => {
  const out = mkdtempSync(join(tmpdir(), 'vpk-out-'));
  const result = packagePlugin(plugin(), options(out));
  assert.equal(result.ok, true);
  assert.equal(result.zip, join(out, 'example_plugin-1.2.3-amd64.zip'));
  const list = spawnSync('unzip', ['-Z1', result.zip], { encoding: 'utf8' }).stdout.trim().split('\n');
  assert.deepEqual(list, ['LICENSE', 'README.md', 'i18n/strings_en.json', 'index.js', 'package.json', 'volumio-plugin.json']);
  assert.equal(readFileSync(`${result.zip}.sha256`, 'utf8'), `${result.sha256}  example_plugin-1.2.3-amd64.zip\n`);
  const provenance = JSON.parse(readFileSync(join(out, 'example_plugin-1.2.3-amd64.provenance.json'), 'utf8'));
  assert.equal(provenance.sha256, result.sha256);
  assert.equal(provenance.source.commit, 'abc');
  assert.deepEqual(provenance.gates, { errors: 0, warnings: 0, findings: [] });
});

test('the same source and epoch give the same bytes', () => {
  const src = plugin();
  const a = packagePlugin(src, options(mkdtempSync(join(tmpdir(), 'vpk-a-'))));
  const b = packagePlugin(src, options(mkdtempSync(join(tmpdir(), 'vpk-b-'))));
  assert.equal(a.sha256, b.sha256);
});

test('a gate error in the built package makes the build fail, findings in the provenance', () => {
  const out = mkdtempSync(join(tmpdir(), 'vpk-out-'));
  const result = packagePlugin(plugin({ 'index.js': "console.log('x');" }), { ...options(out), baseline: {} });
  assert.equal(result.ok, false);
  assert.deepEqual(result.provenance.gates.findings.map((f) => f.rule), ['G2.js.console-log']);
});

test('the gates see the files the build writes', () => {
  const out = mkdtempSync(join(tmpdir(), 'vpk-out-'));
  const src = plugin({
    'package.json': { name: 'example_plugin', version: '1.2.3', main: 'index.js', scripts: { build: 'node gen.js' } },
    'gen.js': "require('fs').writeFileSync('client.pem', '-----BEGIN' + ' PRIVATE KEY-----\\n');",
  });
  const result = packagePlugin(src, { ...options(out), baseline: {} });
  assert.ok(result.provenance.gates.findings.some((f) => f.rule === 'G2.secret' && f.file === 'client.pem'));
});

test('a v2 package.json carries the version the build leaves in the manifest', () => {
  const out = mkdtempSync(join(tmpdir(), 'vpk-out-'));
  const src = plugin({
    'package.json': { main: 'index.js', scripts: { build: 'node bump.js' } },
    'bump.js': "const f = 'volumio-plugin.json'; const m = JSON.parse(require('fs').readFileSync(f)); m.version = '1.2.4'; require('fs').writeFileSync(f, JSON.stringify(m));",
  });
  const result = packagePlugin(src, { ...options(out), baseline: {} });
  const shipped = JSON.parse(spawnSync('unzip', ['-p', result.zip, 'package.json'], { encoding: 'utf8' }).stdout);
  assert.equal(shipped.version, '1.2.4');
  assert.equal(result.provenance.version, '1.2.4');
});

test('a v2 manifest without engines is a finding, not a crash', () => {
  const out = mkdtempSync(join(tmpdir(), 'vpk-out-'));
  const { engines, ...rest } = manifest;
  const result = packagePlugin(plugin({ 'volumio-plugin.json': rest, 'package.json': { main: 'index.js' } }), { ...options(out), baseline: {} });
  assert.equal(result.ok, false);
  assert.ok(result.provenance.gates.findings.some((f) => f.rule === 'G1.schema' && /engines/.test(f.message)));
});

test('package --report-only reports gate errors without failing, but a build that cannot run still fails', () => {
  const cli = (dir, ...flags) => spawnSync(process.execPath, [new URL('../bin/volumio-plugin.js', import.meta.url).pathname, 'package', dir, '--out', mkdtempSync(join(tmpdir(), 'vpk-out-')), ...flags],
    { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1700000000' } });
  const noReadme = plugin();
  rmSync(join(noReadme, 'README.md'));

  const strict = cli(noReadme);
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /G1\.file\.readme/);
  const report = cli(noReadme, '--report-only');
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /^✖ example_plugin\n[\s\S]*G1\.file\.readme[\s\S]*\.zip\nsha256 [0-9a-f]{64}\n$/);

  const broken = plugin({ 'package.json': { name: 'example_plugin', version: '1.2.3', main: 'index.js', scripts: { build: 'exit 3' } } });
  const failed = cli(broken, '--report-only');
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /npm run build failed/);
});
