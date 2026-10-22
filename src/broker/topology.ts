import { Channel, ChannelModel } from 'amqplib';
import {
  DLQ,
  DLX,
  ORDER_PLACED_KEY,
  SHOP_EXCHANGE,
  UNROUTABLE_EXCHANGE,
  UNROUTABLE_QUEUE,
  WORK_QUEUE,
} from './names';

/**
 * Declared by the consumer and by demo bootstrap. The publisher does not call
 * this: it must not learn which queue is bound to the exchange.
 */
export async function assertTopology(ch: Channel): Promise<void> {
  await ch.assertExchange(UNROUTABLE_EXCHANGE, 'fanout', { durable: true });
  await ch.assertQueue(UNROUTABLE_QUEUE, { durable: true });
  await ch.bindQueue(UNROUTABLE_QUEUE, UNROUTABLE_EXCHANGE, '');

  await ch.assertExchange(DLX, 'topic', { durable: true });
  await ch.assertQueue(DLQ, {
    durable: true,
    arguments: { 'x-queue-type': 'quorum' },
  });
  await ch.bindQueue(DLQ, DLX, ORDER_PLACED_KEY);

  await ch.assertExchange(SHOP_EXCHANGE, 'topic', {
    durable: true,
    arguments: { 'alternate-exchange': UNROUTABLE_EXCHANGE },
  });
  await ch.assertQueue(WORK_QUEUE, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-dead-letter-exchange': DLX,
      'x-dead-letter-routing-key': ORDER_PLACED_KEY,
    },
  });
  await ch.bindQueue(WORK_QUEUE, SHOP_EXCHANGE, ORDER_PLACED_KEY);
}

async function drop(conn: ChannelModel, run: (ch: Channel) => Promise<unknown>): Promise<void> {
  const ch = await conn.createChannel();
  ch.on('error', () => undefined);
  try {
    await run(ch);
    await ch.close();
  } catch {
    // A missing queue/exchange is a 404, which closes this channel only.
  }
}

/** Demos start from an empty broker so a previous run cannot change the counts. */
export async function resetTopology(conn: ChannelModel): Promise<void> {
  for (const name of [WORK_QUEUE, DLQ, UNROUTABLE_QUEUE]) {
    await drop(conn, (ch) => ch.deleteQueue(name));
  }
  for (const name of [SHOP_EXCHANGE, DLX, UNROUTABLE_EXCHANGE]) {
    await drop(conn, (ch) => ch.deleteExchange(name));
  }
  const ch = await conn.createChannel();
  try {
    await assertTopology(ch);
  } finally {
    await ch.close();
  }
}

export async function queueDepth(conn: ChannelModel, queue: string): Promise<number> {
  const ch = await conn.createChannel();
  try {
    const status = await ch.checkQueue(queue);
    return status.messageCount;
  } finally {
    await ch.close();
  }
}

export function deathReason(headers: unknown): string {
  if (!headers || typeof headers !== 'object') return '';
  const record = headers as Record<string, unknown>;
  if (typeof record['x-first-death-reason'] === 'string') return record['x-first-death-reason'];
  const death = record['x-death'];
  if (Array.isArray(death) && death[0] && typeof death[0] === 'object') {
    const reason = (death[0] as { reason?: unknown }).reason;
    if (typeof reason === 'string') return reason;
  }
  return '';
}
