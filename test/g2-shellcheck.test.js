import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellDir } from '../src/g2/shell.js';

const hasShellcheck = !spawnSync('shellcheck', ['--version']).error;

test('a plugin cannot switch ShellCheck off', { skip: !hasShellcheck && 'shellcheck not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'g2sc-'));
  writeFileSync(join(dir, '.shellcheckrc'), 'disable=all\n');
  writeFileSync(join(dir, 'install.sh'), '#!/bin/bash\n# shellcheck disable=all\nset -euo pipefail\nunused=1\n');
  assert.deepEqual(shellDir(dir).map((f) => `${f.rule}:${f.line}`), ['G2.shellcheck.SC2034:4']);
});

test('a bare shellcheck comment does not hide the next line', { skip: !hasShellcheck && 'shellcheck not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'g2sc-'));
  writeFileSync(join(dir, 'install.sh'), '#!/bin/bash\nset -euo pipefail\n# shellcheck\nunused=1\n');
  assert.deepEqual(shellDir(dir).map((f) => `${f.rule}:${f.line}`), ['G2.shellcheck.SC2034:4']);
});

test('the baseline is not rewritten without the pinned ShellCheck', () => {
  const bin = mkdtempSync(join(tmpdir(), 'g2bin-'));
  writeFileSync(join(bin, 'shellcheck'), '#!/bin/sh\necho "version: 0.7.0"\n');
  chmodSync(join(bin, 'shellcheck'), 0o755);
  const registry = fileURLToPath(new URL('../registry/g2-baseline.json', import.meta.url));
  const before = statSync(registry).mtimeMs;
  const script = fileURLToPath(new URL('../scripts/g2-baseline.js', import.meta.url));
  // No ShellCheck at all (an empty PATH), then the wrong version.
  for (const path of [mkdtempSync(join(tmpdir(), 'g2empty-')), `${bin}:${dirname(process.execPath)}`]) {
    const run = spawnSync(process.execPath, [script, mkdtempSync(join(tmpdir(), 'g2root-'))], { encoding: 'utf8', env: { PATH: path } });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /ShellCheck/);
  }
  assert.equal(statSync(registry).mtimeMs, before);
});
