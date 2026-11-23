import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encode, parse } from '../src/socketio.js';
import { install, reboot, serveFile, startWithLog } from '../src/deploy.js';

const plugin = { id: 'my_radio', type: 'music_service' };
const fast = { answer: 200, install: 200, start: 200, reboot: 200 };

// A Volumio backend as deploy sees it: each emitted event runs its handler, which answers with fire().
const fakeDevice = (handlers) => {
  const listeners = new Map();
  const emitted = [];
  const fire = (event, data) => [...(listeners.get(event) ?? [])].forEach((listener) => listener(data));
  const socket = {
    on: (event, listener) => listeners.set(event, new Set([...(listeners.get(event) ?? []), listener])),
    off: (event, listener) => listeners.get(event)?.delete(listener),
    emit: (event, data) => {
      emitted.push([event, data]);
      queueMicrotask(() => handlers[event]?.(data, fire));
    },
    close: () => emitted.push(['close']),
  };
  return { socket, emitted, fire };
};
const listing = (active) => (data, fire) => fire('pushInstalledPlugins', [{ name: 'my_radio', category: 'music_service', active }]);

test('socket.io v2 frames: open, connect, events with or without an ack id, payloads that are not JSON', () => {
  assert.deepEqual(parse('0{"sid":"x","pingInterval":25000,"pingTimeout":60000}'), { type: 'open', pingInterval: 25000 });
  assert.deepEqual(parse('40'), { type: 'connect' });
  assert.deepEqual(parse('42["pushState",{"status":"play"}]'), { type: 'event', event: 'pushState', data: { status: 'play' } });
  assert.deepEqual(parse('4212["pushQueue",[]]'), { type: 'event', event: 'pushQueue', data: [] });
  assert.deepEqual(parse('42["broken",'), { type: 'other' });
  assert.deepEqual(parse('3'), { type: 'other' });
  assert.equal(encode('getState'), '42["getState"]');
  assert.equal(encode('installPlugin', { url: 'u', confirm: true }), '42["installPlugin",{"url":"u","confirm":true}]');
});

test('a new plugin is installed without asking at the device, an installed one is updated', async () => {
  const done = (data, fire) => fire('installPluginStatus', { progress: 100 });
  const fresh = fakeDevice({ getInstalledPlugins: (d, fire) => fire('pushInstalledPlugins', []), installPlugin: done });
  assert.deepEqual(await install(fresh.socket, plugin, 'http://x/p.zip', fast), { updated: false });
  assert.deepEqual(fresh.emitted.at(-1), ['installPlugin', { url: 'http://x/p.zip', confirm: true }]);

  const present = fakeDevice({ getInstalledPlugins: listing(true), updatePlugin: done });
  assert.deepEqual(await install(present.socket, plugin, 'http://x/p.zip', fast), { updated: true });
  assert.deepEqual(present.emitted.at(-1), ['updatePlugin', { url: 'http://x/p.zip', category: 'music_service', name: 'my_radio' }]);
});

test('a failed install reports the device install log, install.sh output included', async () => {
  const device = fakeDevice({
    getInstalledPlugins: (d, fire) => fire('pushInstalledPlugins', []),
    installPlugin: (d, fire) => {
      fire('installPluginStatus', { progress: 70, message: 'Installing' });
      fire('installPluginStatus', { progress: 0, message: 'Error: exit 100', advancedLog: 'Downloading<br>E: Unable to locate package foo' });
    },
  });
  await assert.rejects(install(device.socket, plugin, 'http://x/p.zip', fast), /could not install my_radio: Error: exit 100\nDownloading\nE: Unable to locate package foo/);
});

test('the plugin starts with the live log on, which is switched off again', async () => {
  const device = fakeDevice({
    callMethod: ({ data }, fire) => data === 'true' && fire('LLogOpen', { message: 'Starting Live Log...\n' }),
    pluginManager: ({ action }, fire) => {
      if (action === 'enable') fire('LLogProgress', { message: 'info: my_radio: started\n' });
      listing(action === 'enable')(undefined, fire);
    },
  });
  assert.deepEqual(await startWithLog(device.socket, plugin, { restart: true, timeouts: fast, grace: 0 }), { started: true, log: 'info: my_radio: started\n' });
  assert.deepEqual(device.emitted.map(([event, data]) => data?.action ?? data?.data ?? event), ['true', 'disable', 'enable', 'false']);
});

test('a plugin whose onStart never resolves is reported as not started', async () => {
  const device = fakeDevice({
    callMethod: ({ data }, fire) => data === 'true' && fire('LLogOpen', {}),
    pluginManager: (d, fire) => fire('LLogProgress', { message: 'error: my_radio: no network\n' }),
  });
  assert.deepEqual(await startWithLog(device.socket, plugin, { restart: false, timeouts: fast, grace: 0 }), { started: false, log: 'error: my_radio: no network\n' });
  assert.deepEqual(device.emitted.at(-1), ['callMethod', { endpoint: 'system_controller/system', method: 'enableLiveLog', data: 'false' }]);
});

test('after a reboot, deploy reconnects only once the plugin runs again', async () => {
  const device = fakeDevice({ reboot: (d, fire) => fire('disconnect') });
  // Refused while it boots, then up with the plugin still starting, then up with it running.
  const [starting, running] = [false, true].map((active) => fakeDevice({ getInstalledPlugins: listing(active) }));
  const answers = [undefined, starting, running];
  const connectTo = async () => answers.shift()?.socket ?? Promise.reject(new Error('ECONNREFUSED'));
  const back = await reboot(device.socket, 'volumio.local', plugin, { connectTo, timeouts: { ...fast, reboot: 2000 }, retry: 0 });
  assert.equal(back, running.socket);
  assert.deepEqual(starting.emitted.at(-1), ['close']);
});

test('the zip is served at its unguessable URL only', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'p.zip'), 'PK');
  const server = await serveFile(join(dir, 'p.zip'), '127.0.0.1');
  t.after(server.close);
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\.zip$/);
  assert.equal(await (await fetch(server.url)).text(), 'PK');
  assert.equal((await fetch(new URL('/other.zip', server.url))).status, 404);
});
