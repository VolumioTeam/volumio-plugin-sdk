// A socket.io v2 client (engine.io protocol 3), the protocol Volumio's backend speaks, on the
// WebSocket built into Node 22. Events only: no acks, no binary packets, no reconnection.

const CONNECT_TIMEOUT_MS = 10000;

/**
 * Connects to a Volumio device.
 * @param {string} host address or name, with an optional :port
 * @returns {Promise<{ on: Function, off: Function, emit: Function, close: Function }>}
 */
export function connect(host, { timeout = CONNECT_TIMEOUT_MS } = {}) {
  if (typeof WebSocket !== 'function') return Promise.reject(new Error('Talking to a device needs Node 22 or later'));
  const ws = new WebSocket(`ws://${host}/socket.io/?EIO=3&transport=websocket`);
  const listeners = new Map();
  const fire = (event, data) => [...(listeners.get(event) ?? [])].forEach((listener) => listener(data));
  let ping;

  ws.addEventListener('message', ({ data }) => {
    const packet = parse(String(data));
    if (packet.type === 'open') ping = setInterval(() => ws.send('2'), packet.pingInterval);
    else if (packet.type === 'event') fire(packet.event, packet.data);
    else if (packet.type === 'connect') fire('connect');
  });
  ws.addEventListener('close', () => {
    clearInterval(ping);
    fire('disconnect');
  });

  const socket = {
    on(event, listener) {
      listeners.set(event, new Set([...(listeners.get(event) ?? []), listener]));
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener);
    },
    emit(event, data) {
      ws.send(encode(event, data));
    },
    close() {
      ws.close();
    },
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error(`No answer from ${host} within ${timeout / 1000}s`)), timeout);
    const fail = (error) => {
      clearTimeout(timer);
      ws.close();
      reject(error);
    };
    ws.addEventListener('error', () => fail(new Error(`Cannot connect to ${host}`)));
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
  });
}

/** One engine.io text frame: open (0), pong (3), or a socket.io packet in a message (4). */
export function parse(frame) {
  if (frame[0] === '0') return { type: 'open', pingInterval: JSON.parse(frame.slice(1)).pingInterval };
  if (frame === '40') return { type: 'connect' };
  // 42, an optional ack id, then ["event", data].
  const event = /^42\d*(\[.*)$/s.exec(frame);
  if (!event) return { type: 'other' };
  try {
    const [name, data] = JSON.parse(event[1]);
    return { type: 'event', event: name, data };
  } catch {
    // The backend sends some payloads that are not JSON; no event here is one of them.
    return { type: 'other' };
  }
}

/** A socket.io event as an engine.io text frame. */
export const encode = (event, data) => `42${JSON.stringify(data === undefined ? [event] : [event, data])}`;
