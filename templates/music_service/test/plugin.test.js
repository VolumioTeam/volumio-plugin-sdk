'use strict';

// Runs the plugin as Volumio does, with a fake Volumio around it: `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Plugin = require('..');
const { fakeVolumio, isKew } = require('./volumio');
const { PLUGIN_NAME } = require('../i18n/strings_en.json');

test('every lifecycle method returns a kew promise', () => {
  const plugin = new Plugin(fakeVolumio().context);
  for (const method of ['onVolumioStart', 'onStart', 'onStop']) assert.ok(isKew(plugin[method]()), method);
});

test('the settings page shows the name in Browse, and Save renames the entry', async () => {
  const volumio = fakeVolumio();
  const plugin = new Plugin(volumio.context);
  plugin.onVolumioStart();
  plugin.onStart();
  assert.equal((await plugin.getUIConfig()).sections[0].content[0].value, PLUGIN_NAME);
  assert.equal(volumio.browseSources[0].name, PLUGIN_NAME);

  assert.ok(isKew(plugin.saveSettings({ browse_name: ' My music ' })));
  assert.deepEqual(volumio.browseSources.map((s) => s.name), ['My music']);
  assert.equal(volumio.toasts[0].type, 'success');

  plugin.saveSettings({ browse_name: '' });
  assert.deepEqual(volumio.browseSources.map((s) => s.name), [PLUGIN_NAME]);
});
