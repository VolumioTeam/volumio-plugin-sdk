import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shellFindings } from '../src/g2/shell.js';

const rules = (script) => shellFindings(script, 'install.sh').map((f) => `${f.rule}:${f.line}`);
const safe = (body) => `#!/bin/sh\nset -eu\n${body}`;

test('a script without set -e', () => {
  assert.deepEqual(rules('#!/bin/bash\necho hi'), ['G2.shell.set-e:1']);
});

test('set -e on the shebang line does not count: Volumio runs install.sh with sh', () => {
  assert.deepEqual(rules('#!/bin/bash -e\necho hi'), ['G2.shell.set-e:1']);
});

test('pipefail stops install.sh: dash has none', () => {
  assert.deepEqual(rules('#!/bin/bash\nset -euo pipefail\necho hi'), ['G2.shell.pipefail:2']);
  assert.deepEqual(rules(safe('set -o pipefail\necho "pipefail is a bash option"')), ['G2.shell.pipefail:3']);
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

test('apt-get install of the packages declared in system.apt passes', () => {
  const apt = ['libfoo', 'bar'];
  const run = (body) => shellFindings(safe(body), 'install.sh', apt).map((f) => `${f.line}:${f.message}`);
  assert.deepEqual(run('apt-get update\nDEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends libfoo bar'), []);
  assert.deepEqual(run('sudo apt-get -o Dpkg::Options::=--force-confold install -y libfoo=1.2 bar:arm64'), []);
  assert.deepEqual(run('apt-get install -y \\\n  libfoo \\\n  bar'), []);
  assert.deepEqual(run('apt-get install -y libfoo && apt install bar'), []);
  assert.deepEqual(run('apt-get install "libfoo" \'bar\' >/dev/null 2>&1\napt-get install libfoo > /tmp/log\nbash -c "apt-get install libfoo"'), []);
  assert.deepEqual(run('apt-get --option Dpkg::Options::=--force-confold -t bookworm install libfoo'), []);
});

test('apt-get install of anything else names what is missing', () => {
  const run = (body) => shellFindings(safe(body), 'install.sh', ['libfoo']).map((f) => `${f.line}:${f.message}`);
  assert.deepEqual(run('apt-get install -y libfoo baz qux'), ['3:install.sh installs baz, qux, not declared in system.apt']);
  assert.deepEqual(run('apt-get install -y \\\n  libfoo \\\n  baz'), ['3:install.sh installs baz, not declared in system.apt']);
  assert.deepEqual(run('echo start && \\\n  apt-get install baz'), ['4:install.sh installs baz, not declared in system.apt']);
  assert.deepEqual(run('apt-get install -y $PACKAGES\napt-get install -f\napt-get install libfoo=$VERSION'), [
    '3:install.sh installs APT packages it does not name',
    '4:install.sh installs APT packages it does not name',
    '5:install.sh installs APT packages it does not name',
  ]);
  // An option value before install is not the subcommand; a redirection does not hide what follows it.
  assert.deepEqual(run('apt-get -o Dpkg::Options::=--force-confold install baz\napt-get install >/dev/null baz'), [
    '3:install.sh installs baz, not declared in system.apt',
    '4:install.sh installs baz, not declared in system.apt',
  ]);
  // A command string is read as code: what it installs is checked too.
  assert.deepEqual(run("sh -c 'apt-get install libfoo; apt-get install baz'"), ['3:install.sh installs baz, not declared in system.apt']);
  assert.deepEqual(run('apt-get install ./local.deb'), ['3:install.sh installs APT packages it does not name']);
});

test('one package-manager finding per line, so the baseline still counts lines', () => {
  const found = shellFindings(safe('npm install && apt-get install baz'), 'install.sh', []);
  assert.deepEqual(found.map((f) => `${f.line}:${f.message}`), ['3:install.sh runs a package manager; install.sh installs baz, not declared in system.apt']);
});

test('npm, pip and dpkg stay forbidden whatever system.apt declares', () => {
  const run = (body) => shellFindings(safe(body), 'install.sh', ['libfoo']).map((f) => f.rule);
  assert.deepEqual(run('npm install\npip3 install libfoo\ndpkg -i libfoo.deb'), Array(3).fill('G2.shell.package-manager'));
});
