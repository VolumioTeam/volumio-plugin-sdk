import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from '../src/manifest.js';

const draft = () => ({
  id: 'radio_paradise',
  version: '2.1.0',
  type: 'music_service',
  function: 'radio-paradise',
  title: 'Radio Paradise',
  description: 'Listen to Radio Paradise',
  icon: 'fa-music',
  bootPriority: 10,
  engines: { volumio: '>=4.0.0 <5.0.0', api: '2' },
  arch: ['armhf', 'amd64', 'arm64'],
  permissions: ['playback', 'browse-source', 'ui:toast'],
  network: ['api.radioparadise.com'],
  system: {
    apt: ['libfoo1'],
    services: ['radio_paradise-helper.service'],
    writes: ['/data/plugins/music_service/radio_paradise'],
  },
  settings: 'settings.schema.json',
  test: { credentials: [], scenarios: 'test/scenarios.json' },
  license: 'MIT',
});

const paths = (errors) => errors.map((e) => e.path);

test('accepts the draft manifest from the proposal', () => {
  assert.deepEqual(validateManifest(draft()), []);
});

test('rejects an id with a hyphen', () => {
  assert.deepEqual(paths(validateManifest({ ...draft(), id: 'radio-paradise' })), ['/id']);
});

test('rejects an unknown permission', () => {
  assert.deepEqual(paths(validateManifest({ ...draft(), permissions: ['root'] })), ['/permissions/0']);
});

test('accepts a call permission on another plugin', () => {
  assert.deepEqual(validateManifest({ ...draft(), permissions: ['plugin:spop.getState'] }), []);
});

test('rejects api other than 2', () => {
  assert.deepEqual(paths(validateManifest({ ...draft(), engines: { volumio: '>=4', api: '1' } })), ['/engines/api']);
});

test('reports a missing required field by its name', () => {
  const { function: _omit, ...noFunction } = draft();
  assert.deepEqual(paths(validateManifest(noFunction)), ['/function']);
});

test('rejects a boot priority outside 1-100', () => {
  assert.deepEqual(paths(validateManifest({ ...draft(), bootPriority: 0 })), ['/bootPriority']);
});

test('rejects unknown top-level keys', () => {
  assert.deepEqual(paths(validateManifest({ ...draft(), prettyName: 'Radio Paradise' })), ['/prettyName']);
});
