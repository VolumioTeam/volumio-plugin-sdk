'use strict';

// Runs the plugin as Volumio does, with a fake Volumio around it: `npm test`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const libQ = require('kew');
const Plugin = require('..');

const fakeVolumio = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-test-'));
  fs.copyFileSync(path.join(__dirname, '..', 'config.json'), path.join(dir, 'config.json'));
  const toasts = [];
  const logs = [];
  const coreCommand = {
    pluginManager: { getConfigurationFile: (context, name) => path.join(dir, name) },
    sharedVars: { get: (key) => (key === 'language_code' ? 'en' : undefined) },
    pushToastMessage: (type, title, message) => toasts.push({ type, title, message }),
    i18nJson: (dictionary, fallback, file) => libQ.resolve(JSON.parse(fs.readFileSync(file, 'utf8'))),
  };
  const context = { coreCommand, logger: { info: (m) => logs.push(m), warn: () => {}, error: () => {} } };
  return { context, toasts, logs };
};

// kew promises are objects with then and fail; native Promises are not.
const isKew = (p) => typeof p?.then === 'function' && typeof p.fail === 'function';

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
