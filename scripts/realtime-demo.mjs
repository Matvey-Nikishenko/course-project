import { io, Socket } from 'socket.io-client';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const sameRoom = process.argv.includes('--same-room');

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function api(path, options = {}) {
  const res = await fetch(`${base}${path}`, options);
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    fail(`${options.method ?? 'GET'} ${path} → ${res.status} ${text}`);
  }
  return body;
}

function join(orderId, userId) {
  const socket = io(base, {
    transports: ['websocket'],
    reconnection: false,
    auth: { userId },
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error(`join timeout for order ${orderId}`));
    }, 5000);
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(err);
    });
    socket.on('connect', () => {
      socket.emit('join', { orderId }, (ack) => {
        clearTimeout(timer);
        if (!ack?.ok) {
          socket.disconnect();
          reject(new Error(`join refused for order ${orderId}: ${JSON.stringify(ack)}`));
          return;
        }
        resolve(socket);
      });
    });
  });
}

const cycle = ['new', 'paid', 'shipped', 'cancelled'];

const page = await api('/orders?limit=50');
const orders = page.items ?? [];
if (orders.length < 2) {
  fail('need at least 2 orders — run npm run seed before the demo');
}

const orderA = orders[0];
const orderB = orders[1];
const roomB = sameRoom ? orderA : orderB;
const expectB = sameRoom ? 1 : 0;
const nextStatus = cycle[(cycle.indexOf(orderA.status) + 1) % cycle.length];

/** @type {Socket[]} */
const sockets = [];
try {
  const socketA = await join(orderA.id, orderA.buyer_id);
  const socketB = await join(roomB.id, roomB.buyer_id);
  sockets.push(socketA, socketB);

  let aReceived = 0;
  let bReceived = 0;
  socketA.on('order.status', () => {
    aReceived += 1;
  });
  socketB.on('order.status', () => {
    bReceived += 1;
  });

  await api(`/orders/${orderA.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: nextStatus }),
  });

  await new Promise((resolve) => setTimeout(resolve, 800));

  console.log(`A_RECEIVED=${aReceived}`);
  console.log(`B_RECEIVED=${bReceived}`);
  process.exitCode = aReceived === 1 && bReceived === expectB ? 0 : 1;
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  for (const socket of sockets) socket.disconnect();
}
process.exit(process.exitCode ?? 1);
