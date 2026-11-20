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

test('a checksum in a comment or in echoed text is not a check', () => {
  assert.deepEqual(rules(safe('# TODO: sha256sum -c\ncurl -o payload https://example.com/p')), ['G2.shell.download:4']);
  assert.deepEqual(rules(safe('echo "sha256sum later"\nwget https://example.com/p')), ['G2.shell.download:4']);
});

test('a checksum piped from echo is a check', () => {
  assert.deepEqual(rules(safe('wget -O f https://example.com/f\necho "abc  f" | sha256sum -c -')), []);
});

test('text an echo prints is not a command; a string a shell runs is', () => {
  assert.deepEqual(rules(safe('echo "Run apt-get install foo manually"\nprintf \'%s\\n\' "use || true"')), []);
  assert.deepEqual(rules(safe('bash -c "apt-get install foo"')), ['G2.shell.package-manager:3']);
});

test('a trailing comment is not code', () => {
  assert.deepEqual(rules(safe('rm x # || true')), []);
});

test('a # inside quotes does not start a comment', () => {
  assert.deepEqual(rules(safe("echo ' #'; apt-get install foo\necho \"a # b\" && rm x || true")), ['G2.shell.package-manager:3', 'G2.shell.or-true:4']);
});

test('only the arguments of the print command are text', () => {
  assert.deepEqual(rules(safe("echo ready; bash -c 'apt-get install foo'\necho \"`apt-get install foo`\"")), ['G2.shell.package-manager:3', 'G2.shell.package-manager:4']);
  assert.deepEqual(rules(safe("echo 'apt-get install foo' && echo done")), []);
});
