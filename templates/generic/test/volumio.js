'use strict';

// A fake Volumio around the plugin, recording what the plugin asks of it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const libQ = require('kew');

exports.fakeVolumio = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-test-'));
  fs.copyFileSync(path.join(__dirname, '..', 'config.json'), path.join(dir, 'config.json'));
  const toasts = [];
  const logs = [];
  const browseSources = [];
  const coreCommand = {
    pluginManager: { getConfigurationFile: (context, name) => path.join(dir, name) },
    sharedVars: { get: (key) => (key === 'language_code' ? 'en' : undefined) },
    pushToastMessage: (type, title, message) => toasts.push({ type, title, message }),
    i18nJson: (dictionary, fallback, file) => libQ.resolve(JSON.parse(fs.readFileSync(file, 'utf8'))),
    volumioAddToBrowseSources: (source) => browseSources.push(source),
    volumioRemoveToBrowseSources: (name) => browseSources.splice(browseSources.findIndex((s) => s.name === name), 1),
  };
  const context = { coreCommand, logger: { info: (m) => logs.push(m), warn: () => {}, error: () => {} } };
  return { context, toasts, logs, browseSources };
};

// kew promises are objects with then and fail; native Promises are not.
exports.isKew = (p) => typeof p?.then === 'function' && typeof p.fail === 'function';
