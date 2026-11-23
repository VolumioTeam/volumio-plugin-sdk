'use strict';

// Browse, play and search as Volumio calls them: `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Plugin = require('..');
const catalog = require('../catalog.json');
const { fakeVolumio, isKew } = require('./volumio');

const started = () => {
  const volumio = fakeVolumio();
  const plugin = new Plugin(volumio.context);
  plugin.onVolumioStart();
  plugin.onStart();
  return { plugin, volumio };
};

test('the plugin is in Browse while it runs', () => {
  const { plugin, volumio } = started();
  assert.deepEqual(volumio.browseSources.map((s) => s.uri), ['music_service/{{id}}']);
  plugin.onStop();
  assert.deepEqual(volumio.browseSources, []);
});

test('Browse lists the catalog, and each item plays its stream through MPD', async () => {
  const { plugin } = started();
  const browse = plugin.handleBrowseUri('music_service/{{id}}');
  assert.ok(isKew(browse));
  const items = (await browse).navigation.lists[0].items;
  assert.deepEqual(items.map((i) => i.title), catalog.map((t) => t.title));

  // A list of one: Favourites reads the first item.
  const [played, ...rest] = await plugin.explodeUri(items[0].uri);
  assert.deepEqual(rest, []);
  assert.equal(played.service, 'mpd');
  assert.equal(played.uri, catalog[0].url);
});

test('an unknown URI is rejected', async () => {
  const { plugin } = started();
  // assert.rejects takes native Promises only: the async function wraps the kew one.
  await assert.rejects(async () => plugin.handleBrowseUri('music_service/{{id}}/nowhere'));
  await assert.rejects(async () => plugin.explodeUri('music_service/{{id}}/track/nowhere'));
});

test('search finds by title, and resolves null when nothing matches', async () => {
  const { plugin } = started();
  const found = await plugin.search({ value: catalog[0].title.toUpperCase() });
  assert.equal(found.items[0].uri, (await plugin.handleBrowseUri('music_service/{{id}}')).navigation.lists[0].items[0].uri);
  assert.equal(await plugin.search({ value: 'no such track' }), null);
  assert.equal(await plugin.search({}), null);
});
