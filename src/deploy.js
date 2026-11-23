// `volumio-plugin deploy`: installs a plugin on a Volumio device on the local network, starts it,
// and returns what the device logged meanwhile. It talks to the backend as the web UI does: no SSH.
import { randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { connect } from './socketio.js';

const TIMEOUTS = {
  answer: 30000,
  // install.sh may apt-get install packages.
  install: 10 * 60000,
  // Volumio gives up on a slow onStart after 30 seconds.
  start: 60000,
  reboot: 5 * 60000,
};
// The device comes back from a reboot without telling anyone: ask again at this pace.
const RETRY_MS = 3000;
// journalctl hands a line to the live log a moment after the plugin writes it.
const LOG_GRACE_MS = 2000;
const LIVE_LOG = { endpoint: 'system_controller/system', method: 'enableLiveLog' };

/** Resolves with the data of the first `event` that `accept` takes; rejects after `timeout`. */
export const waitFor = (socket, event, accept = () => true, timeout = TIMEOUTS.answer) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`No ${event} from the device within ${timeout / 1000}s`));
    }, timeout);
    const listener = (data) => {
      if (!accept(data)) return;
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(data);
    };
    socket.on(event, listener);
  });

const ask = (socket, [emit, data], [event, accept, timeout]) => {
  const answer = waitFor(socket, event, accept, timeout);
  socket.emit(emit, data);
  return answer;
};

const listed = (list, { id, type }) => (list ?? []).find((p) => p.name === id && p.category === type);
const installedPlugin = (socket, plugin) => ask(socket, ['getInstalledPlugins'], ['pushInstalledPlugins']).then((list) => listed(list, plugin));
const plain = (html = '') => html.replace(/<br\s*\/?>/g, '\n').trim();

/** The address of this machine on the interface that reaches host. */
export const localAddressFor = (host) =>
  new Promise((resolve, reject) => {
    const udp = createSocket('udp4');
    udp.once('error', (error) => {
      udp.close();
      reject(error);
    });
    // UDP connect sends nothing: it only picks the route.
    udp.connect(80, host.replace(/:\d+$/, ''), () => {
      const { address } = udp.address();
      udp.close();
      resolve(address);
    });
  });

/** Serves one file at an unguessable URL on address, until close(). */
export const serveFile = (file, address) =>
  new Promise((resolve, reject) => {
    const path = `/${randomBytes(16).toString('hex')}.zip`;
    const server = createServer((req, res) => {
      if (req.method !== 'GET' || req.url !== path) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': statSync(file).size });
      createReadStream(file).pipe(res);
    });
    server.once('error', reject);
    server.listen(0, address, () => {
      resolve({ url: `http://${address}:${server.address().port}${path}`, close: () => server.close() });
    });
  });

/**
 * Installs the zip at url, or updates the plugin when the device already has it.
 * @returns {Promise<{ updated: boolean }>}
 */
export async function install(socket, plugin, url, timeouts = TIMEOUTS) {
  const updated = Boolean(await installedPlugin(socket, plugin));
  const request = updated
    ? ['updatePlugin', { url, category: plugin.type, name: plugin.id }]
    // confirm: the backend would otherwise ask the person at the device's screen first.
    : ['installPlugin', { url, confirm: true }];
  const status = await ask(socket, request, ['installPluginStatus', (s) => s.progress === 100 || s.progress === 0, timeouts.install]);
  if (status.progress === 0) throw new Error(`The device could not install ${plugin.id}: ${plain(status.message)}\n${plain(status.advancedLog)}`);
  return { updated };
}

/** Reboots the device and reconnects once its backend answers again. */
export async function reboot(socket, host, plugin, { connectTo = connect, timeouts = TIMEOUTS, retry = RETRY_MS } = {}) {
  await ask(socket, ['reboot'], ['disconnect', () => true, timeouts.reboot]);
  const deadline = Date.now() + timeouts.reboot;
  let back;
  for (;;) {
    back = await connectTo(host).catch(() => undefined);
    if (back && (await installedPlugin(back, plugin).then(() => true, () => false))) break;
    back?.close();
    if (Date.now() > deadline) throw new Error(`${host} did not come back within ${timeouts.reboot / 1000}s`);
    await sleep(retry);
  }
  // The backend answers before it has started every plugin. Let the boot start this one, or fail
  // to, before deploy restarts it: a plugin that fails in onStart never shows as running.
  const startBy = Date.now() + timeouts.start;
  while (!(await installedPlugin(back, plugin))?.active && Date.now() < startBy) await sleep(retry);
  return back;
}

/**
 * Starts the plugin, or stops and starts it again, with the device's live log on.
 * @returns {Promise<{ started: boolean, log: string }>}
 */
export async function startWithLog(socket, plugin, { restart, timeouts = TIMEOUTS, grace = LOG_GRACE_MS }) {
  const lines = [];
  const collect = ({ message }) => lines.push(message);
  socket.on('LLogProgress', collect);
  await ask(socket, ['callMethod', { ...LIVE_LOG, data: 'true' }], ['LLogOpen']);
  const target = { category: plugin.type, name: plugin.id };
  try {
    if (restart) await ask(socket, ['pluginManager', { action: 'disable', ...target }], ['pushInstalledPlugins', (l) => !listed(l, plugin)?.active]);
    // The backend answers only when onStart resolves: a plugin that fails to start times out here.
    const started = await ask(socket, ['pluginManager', { action: 'enable', ...target }], ['pushInstalledPlugins', (l) => listed(l, plugin)?.active, timeouts.start])
      .then(() => true, () => false);
    await sleep(grace);
    return { started, log: lines.join('') };
  } finally {
    socket.off('LLogProgress', collect);
    socket.emit('callMethod', { ...LIVE_LOG, data: 'false' });
  }
}

/**
 * Installs the zip of plugin on host and starts it. An update reboots the device: Volumio keeps
 * running the code it loaded first until its backend restarts.
 * @param {string} host
 * @param {{ id: string, type: string }} plugin
 * @param {string} zip
 * @param {{ connectTo?: Function, progress?: (line: string) => void }} [options]
 * @returns {Promise<{ updated: boolean, started: boolean, log: string }>}
 */
export async function deploy(host, plugin, zip, { connectTo = connect, progress = () => {} } = {}) {
  let socket = await connectTo(host);
  let server;
  try {
    server = await serveFile(zip, await localAddressFor(host));
    progress(`Installing ${plugin.id} on ${host}`);
    const { updated } = await install(socket, plugin, server.url).finally(() => server.close());
    if (updated) {
      progress(`Rebooting ${host} to load the new code: this takes a minute or two`);
      socket = await reboot(socket, host, plugin, { connectTo });
    }
    progress(`Starting ${plugin.id}`);
    return { updated, ...(await startWithLog(socket, plugin, { restart: updated })) };
  } finally {
    server?.close();
    socket.close();
  }
}

/** Writes the device's live log until `until` settles. */
export async function followLog(host, write, until, { connectTo = connect } = {}) {
  const socket = await connectTo(host);
  socket.on('LLogProgress', ({ message }) => write(message));
  socket.emit('callMethod', { ...LIVE_LOG, data: 'true' });
  try {
    await until;
  } finally {
    socket.emit('callMethod', { ...LIVE_LOG, data: 'false' });
    socket.close();
  }
}
