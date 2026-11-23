'use strict';

// Runs the plugin as Volumio does, with a fake Volumio around it: `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Plugin = require('..');
const { fakeVolumio, isKew } = require('./volumio');

test('every lifecycle method returns a kew promise', () => {
  const plugin = new Plugin(fakeVolumio().context);
  for (const method of ['onVolumioStart', 'onStart', 'onStop']) assert.ok(isKew(plugin[method]()), method);
});

test('the settings page shows the saved greeting, and Save stores a new one', async () => {
  const volumio = fakeVolumio();
  const plugin = new Plugin(volumio.context);
  plugin.onVolumioStart();
  plugin.onStart();
  assert.equal((await plugin.getUIConfig()).sections[0].content[0].value, 'Hello from Volumio');

  assert.ok(isKew(plugin.saveSettings({ greeting: 'Ciao' })));
  assert.equal(plugin.config.get('greeting'), 'Ciao');
  assert.equal(volumio.toasts[0].type, 'success');
});
