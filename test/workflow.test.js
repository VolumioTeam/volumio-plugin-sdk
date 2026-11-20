import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the reusable workflow builds with the SDK of its own release', () => {
  const { version } = JSON.parse(read('package.json'));
  const sdkRef = read('.github/workflows/build.yml').match(/sdk-ref:\n(?:\s+\w+:.*\n)*?\s+default:\s*(\S+)/)?.[1];
  assert.equal(sdkRef, `v${version}`);
});

// Every remote `uses:` value, quoted or not, that is not pinned to a commit; local ./ workflows are exempt.
const unpinned = (yaml) =>
  [...yaml.matchAll(/uses:\s*['"]?([^'"\s#]+)/g)].map(([, ref]) => ref).filter((ref) => !ref.startsWith('./') && !/@[0-9a-f]{40}$/.test(ref));

test('the pin check sees quoted references', () => {
  assert.deepEqual(unpinned("- uses: 'actions/checkout@v4'\n- uses: \"actions/setup-node@v4\"\n- uses: ./.github/workflows/build.yml"),
    ['actions/checkout@v4', 'actions/setup-node@v4']);
});

test('actions are pinned by commit and the build image by digest', () => {
  for (const file of ['.github/workflows/build.yml', '.github/workflows/ci.yml']) assert.deepEqual(unpinned(read(file)), [], file);
  assert.match(read('scripts/build.sh'), /node:20-bookworm@sha256:[0-9a-f]{64}/);
});
