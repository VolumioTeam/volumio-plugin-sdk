import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandboxInstall, SANDBOX_IMAGE } from '../src/sandbox.js';

// Runs only where scripts/sandbox-image.sh has built the image.
const hasImage = spawnSync('docker', ['image', 'inspect', SANDBOX_IMAGE], { stdio: 'ignore' }).status === 0;
const skip = !hasImage && `${SANDBOX_IMAGE} not built`;

// The hello example as a package, with install.sh replaced when given.
const pkg = (t, install) => {
  const dir = mkdtempSync(join(tmpdir(), 'g4-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(new URL('../examples/hello', import.meta.url), join(dir, 'src'), { recursive: true });
  if (install === null) rmSync(join(dir, 'src', 'install.sh'));
  else if (install) writeFileSync(join(dir, 'src', 'install.sh'), `#!/bin/sh\n${install}\n`);
  assert.equal(spawnSync('zip', ['-qr', join(dir, 'p.zip'), '.'], { cwd: join(dir, 'src') }).status, 0);
  return join(dir, 'p.zip');
};
const rules = ({ findings }) => findings.map((f) => `${f.rule} ${f.path ?? f.message.split('\n')[0]}`);

test('the hello example installs with nothing to report', { skip }, (t) => {
  assert.deepEqual(sandboxInstall(pkg(t)), { id: 'hello_volumio', source: 'v1', findings: [] });
});

test('writes outside the plugin and new units are reported', { skip }, (t) => {
  const result = sandboxInstall(pkg(t, 'echo "volumio ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/x\ntouch /etc/systemd/system/x.service'));
  assert.deepEqual(rules(result), ['G4.service adds or changes the systemd unit x.service', 'G4.write /etc/sudoers.d/x']);
});

test('a failing, hanging or missing install.sh fails the install', { skip }, (t) => {
  assert.deepEqual(rules(sandboxInstall(pkg(t, 'echo broken >&2; exit 3'))), ['G4.install install.sh exited with 3']);
  assert.deepEqual(rules(sandboxInstall(pkg(t, 'sleep 30'), { timeout: 3000 })), ['G4.install install.sh did not finish in 3 s']);
  assert.deepEqual(rules(sandboxInstall(pkg(t, null))), ['G4.install install.sh is missing: Volumio refuses the install']);
});
