import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shellFindings } from '../src/g2/shell.js';

const rules = (script) => shellFindings(script, 'install.sh').map((f) => `${f.rule}:${f.line}`);
const safe = (body) => `#!/bin/bash\nset -euo pipefail\n${body}`;

test('a script without set -e', () => {
  assert.deepEqual(rules('#!/bin/bash\necho hi'), ['G2.shell.set-e:1']);
});

test('set -e on the shebang line counts', () => {
  assert.deepEqual(rules('#!/bin/bash -e\necho hi'), []);
});

test('|| true and || : hide failures', () => {
  assert.deepEqual(rules(safe('rm x || true\nrm y || :\nrm z || echo no')), ['G2.shell.or-true:3', 'G2.shell.or-true:4']);
});

test('package managers', () => {
  const body = 'apt-get -y install libfoo\nnpm install --production\npip3 install foo\ndpkg -i foo.deb';
  assert.deepEqual(rules(safe(body)), [
    'G2.shell.package-manager:3',
    'G2.shell.package-manager:4',
    'G2.shell.package-manager:5',
    'G2.shell.package-manager:6',
  ]);
});

test('a download without a checksum; with one it passes', () => {
  assert.deepEqual(rules(safe('wget https://x/y.tar')), ['G2.shell.download:3']);
  assert.deepEqual(rules(safe('curl -o y https://x/y\necho "abc  y" | sha256sum -c')), []);
});

test('writing sudoers', () => {
  assert.deepEqual(rules(safe('echo "volumio ALL=(ALL) NOPASSWD: /bin/cp" > /etc/sudoers.d/x')), ['G2.shell.sudoers:3']);
});

test('commented lines are ignored', () => {
  assert.deepEqual(rules(safe('# apt-get install foo\n  # wget x')), []);
});
