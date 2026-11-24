import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('../scripts/changed-plugins.sh', import.meta.url).pathname;
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).stdout.trim();
const write = (root, file, content = '{}') => {
  mkdirSync(join(root, file, '..'), { recursive: true });
  writeFileSync(join(root, file), content);
};
const changed = (cwd, ...args) => spawnSync('bash', [script, ...args], { cwd, encoding: 'utf8' });

test('lists the plugin folders a change touches, or every plugin folder', () => {
  const repo = mkdtempSync(join(tmpdir(), 'sources-'));
  git(repo, 'init', '-q', '-b', 'master');
  for (const file of ['edited/package.json', 'removed/package.json', 'untouched/package.json', 'moved/package.json', 'docs/notes.md', 'README.md']) write(repo, file);
  write(repo, 'moved/lib.js', 'module.exports = 42;');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');

  write(repo, 'edited/index.js', 'x');
  write(repo, 'added/package.json');
  write(repo, 'docs/notes.md', 'changed');
  write(repo, 'README.md', 'changed');
  rmSync(join(repo, 'removed'), { recursive: true });
  renameSync(join(repo, 'moved/lib.js'), join(repo, 'docs/lib.js'));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'head');

  assert.deepEqual(JSON.parse(changed(repo, base, 'HEAD').stdout), ['added', 'edited', 'moved']);
  assert.deepEqual(JSON.parse(changed(repo, 'all').stdout), ['added', 'edited', 'moved', 'untouched']);
  assert.equal(changed(repo, base).status, 2);
});
