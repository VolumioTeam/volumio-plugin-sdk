import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromV1 } from '../src/fromV1.js';

const v1 = () => ({
  name: 'radio_paradise',
  version: '1.4.0',
  main: 'index.js',
  license: 'ISC',
  engines: { node: '>=20', volumio: '>=4' },
  volumio_info: {
    prettyName: 'Radio Paradise',
    icon: 'fa-music',
    plugin_type: 'music_service',
    os: ['bookworm'],
    architectures: ['armhf', 'amd64'],
    details: 'Listen to Radio Paradise',
    changelog: '',
    boot_priority: 10,
  },
});

test('maps the v1 fields that have a v2 home', () => {
  const { manifest } = fromV1(v1());
  assert.deepEqual(manifest, {
    id: 'radio_paradise',
    version: '1.4.0',
    type: 'music_service',
    title: 'Radio Paradise',
    description: 'Listen to Radio Paradise',
    icon: 'fa-music',
    changelog: '',
    bootPriority: 10,
    engines: { volumio: '>=4', api: '1' },
    arch: ['armhf', 'amd64'],
    license: 'ISC',
  });
});

test('lists what the author must add for v2', () => {
  assert.deepEqual(fromV1(v1()).todo, ['function', 'permissions']);
});

test('lists the v1 fields with no v2 home', () => {
  assert.deepEqual(fromV1(v1()).dropped, ['os']);
});

test('leaves missing v1 fields out instead of inventing them', () => {
  const { manifest } = fromV1({ name: 'x_y', version: '1.0.0', volumio_info: {} });
  assert.deepEqual(manifest, { id: 'x_y', version: '1.0.0', engines: { api: '1' } });
});

test('does not mutate its input', () => {
  const pkg = v1();
  const before = JSON.stringify(pkg);
  fromV1(pkg);
  assert.equal(JSON.stringify(pkg), before);
});
