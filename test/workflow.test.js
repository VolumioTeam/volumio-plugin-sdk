import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the reusable workflow builds with the SDK of its own release', () => {
  const { version } = JSON.parse(read('package.json'));
  const sdkRef = read('.github/workflows/build.yml').match(/sdk-ref:\n(?:\s+\w+:.*\n)*?\s+default:\s*(\S+)/)?.[1];
  assert.equal(sdkRef, `v${version}`);
});

test('actions are pinned by commit and the build image by digest', () => {
  for (const file of ['.github/workflows/build.yml', '.github/workflows/ci.yml']) {
    for (const [, ref] of read(file).matchAll(/uses:\s*[\w.-]+\/[\w./-]+@(\S+)/g)) assert.match(ref, /^[0-9a-f]{40}$/, file);
  }
  assert.match(read('scripts/build.sh'), /node:20-bookworm@sha256:[0-9a-f]{64}/);
});
