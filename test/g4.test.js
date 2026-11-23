import { test } from 'node:test';
import assert from 'node:assert/strict';
import { g4, parseDiff } from '../src/g4.js';

const manifest = {
  id: 'hello', type: 'user_interface',
  network: ['api.example.com', '*.cdn.example.com'],
  system: { apt: ['jq'], services: ['hello.service'], writes: ['/etc/hello'] },
};
const empty = { changes: [], packages: [], packageFiles: [], hosts: [] };
const rules = (findings) => findings.map((f) => `${f.rule} ${f.path ?? f.message}`);

test('parseDiff reads docker diff lines', () => {
  assert.deepEqual(parseDiff('C /etc\nA /etc/hello\nD /opt/x\n'),
    [{ kind: 'C', path: '/etc' }, { kind: 'A', path: '/etc/hello' }, { kind: 'D', path: '/opt/x' }]);
});

test('a plugin that does only what it declares passes', () => {
  const run = {
    changes: parseDiff([
      'C /data', 'C /data/plugins', 'A /data/plugins/user_interface', 'A /data/plugins/user_interface/hello', 'A /data/plugins/user_interface/hello/index.js',
      'C /etc', 'A /etc/hello', 'A /etc/hello/conf', 'C /usr', 'C /usr/bin', 'A /usr/bin/jq',
      'C /etc/systemd/system', 'A /etc/systemd/system/hello.service', 'A /etc/systemd/system/multi-user.target.wants',
      'A /etc/systemd/system/multi-user.target.wants/hello.service', 'C /var/lib/dpkg', 'C /var/lib/dpkg/status', 'C /tmp', 'A /tmp/installog',
    ].join('\n')),
    packages: ['jq'], packageFiles: ['/usr/bin/jq'], hosts: ['api.example.com', 'img.cdn.example.com'],
  };
  assert.deepEqual(g4(manifest, run), []);
});

test('undeclared packages, units, writes and hosts are errors on v2', () => {
  const run = {
    changes: parseDiff('C /opt\nA /opt/hello\nA /opt/hello/a\nA /opt/hello/b\nC /etc\nC /etc/sudoers.d\nA /etc/sudoers.d/hello\n' +
      'C /etc/systemd/system\nA /etc/systemd/system/mpd.service.d\nA /etc/systemd/system/mpd.service.d/override.conf\nD /boot/config.txt'),
    packages: ['curl'], packageFiles: [], hosts: ['cdn.example.com', 'evil.test'],
  };
  const findings = g4(manifest, run);
  assert.deepEqual(rules(findings), [
    'G4.apt installs the package curl',
    'G4.service adds or changes the systemd unit mpd.service',
    'G4.write /opt/hello',
    'G4.write /etc/sudoers.d/hello',
    'G4.write /boot/config.txt',
    'G4.network contacts cdn.example.com',
    'G4.network contacts evil.test',
  ]);
  assert.ok(findings.every((f) => f.severity === 'error' && f.fix));
});

test('v1 plugins get warnings, and an empty v1 manifest declares nothing', () => {
  const run = { ...empty, changes: parseDiff('C /etc\nA /etc/hello'), packages: ['jq'] };
  const findings = g4({ id: 'hello', type: 'user_interface' }, run, { source: 'v1' });
  assert.deepEqual(rules(findings), ['G4.apt installs the package jq', 'G4.write /etc/hello']);
  assert.ok(findings.every((f) => f.severity === 'warning'));
});

test('what the sandbox does without the plugin is not the plugin', () => {
  const baseline = { changes: parseDiff('C /var\nC /var/lib\nA /var/lib/volumio-state'), packages: [], packageFiles: [], hosts: ['updates2.volumio.org'] };
  const run = { ...baseline, changes: parseDiff('C /var\nC /var/lib\nA /var/lib/volumio-state\nA /var/lib/hello') };
  assert.deepEqual(rules(g4(manifest, run, { baseline })), ['G4.write /var/lib/hello']);
});
