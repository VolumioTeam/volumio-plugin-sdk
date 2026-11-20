import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { schema } from '../src/manifest.js';

const registry = JSON.parse(readFileSync(new URL('../registry/functions.json', import.meta.url), 'utf8'));

test('function ids are unique and valid manifest values', () => {
  const ids = registry.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  const pattern = new RegExp(schema.properties.function.pattern);
  assert.deepEqual(ids.filter((id) => !pattern.test(id)), []);
});

test('a plugin belongs to one function only', () => {
  const plugins = registry.flatMap((f) => [f.plugin, ...(f.duplicates ?? [])]).filter(Boolean);
  assert.deepEqual(plugins.filter((p, i) => plugins.indexOf(p) !== i), []);
});

test('an undecided function lists at least two candidates', () => {
  assert.deepEqual(registry.filter((f) => f.plugin === null && (f.duplicates ?? []).length < 2).map((f) => f.id), []);
});
