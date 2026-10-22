import { Channel, ChannelModel, connect } from 'amqplib';
import { applyOrderPlaced, Tx } from './effects';
import { PREFETCH, WORK_QUEUE } from './names';
import { BadEvent, parseOrderPlaced } from './order-placed';
import { assertTopology } from './topology';

export type ConsumerStats = {
  delivered: number;
  acked: number;
  rejected: number;
};

async function attach(
  ch: Channel,
  tx: Tx,
  opts: { crashBeforeAck?: boolean; stopAfter?: number },
  stats: ConsumerStats,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let chain = Promise.resolve();
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    // prefetch may deliver several messages at once. One pg client cannot run
    // those queries concurrently, so the handlers share a chain.
    ch.consume(
      WORK_QUEUE,
      (msg) => {
        if (!msg) return;
        chain = chain.then(async () => {
          if (settled) return;
          stats.delivered += 1;
          try {
            const event = parseOrderPlaced(msg.content);
            await applyOrderPlaced(tx, event);
            if (opts.crashBeforeAck) {
              await new Promise(() => undefined);
            }
            ch.ack(msg);
            stats.acked += 1;
          } catch (err) {
            if (err instanceof BadEvent) {
              ch.reject(msg, false);
              stats.rejected += 1;
            } else {
              ch.nack(msg, false, true);
              fail(err);
              return;
            }
          }
          if (opts.stopAfter !== undefined && stats.acked + stats.rejected >= opts.stopAfter) {
            succeed();
          }
        }, fail);
      },
      { noAck: false },
    ).catch(fail);
  });
}

async function open(brokerUrl: string): Promise<{ conn: ChannelModel; ch: Channel }> {
  const conn = await connect(brokerUrl);
  conn.on('error', () => undefined);
  const ch = await conn.createChannel();
  ch.on('error', () => undefined);
  await assertTopology(ch);
  await ch.prefetch(PREFETCH);
  return { conn, ch };
}

export async function runBoundedConsumer(opts: {
  brokerUrl: string;
  tx: Tx;
  stopAfter: number;
  timeoutMs?: number;
}): Promise<ConsumerStats> {
  const { conn, ch } = await open(opts.brokerUrl);
  const stats: ConsumerStats = { delivered: 0, acked: 0, rejected: 0 };
  const timeoutMs = opts.timeoutMs ?? 20_000;
  let timer: NodeJS.Timeout | undefined;
  const pending = attach(ch, opts.tx, { stopAfter: opts.stopAfter }, stats);
  void pending.catch(() => undefined);
  try {
    await Promise.race([
      pending,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
    return stats;
  } finally {
    if (timer) clearTimeout(timer);
    try {
      await ch.close();
    } catch {
      // Channel already closed with the connection.
    }
    try {
      await conn.close();
    } catch {
      // The broker may already have dropped the socket.
    }
  }
}

/** Long-lived consumer for the API process. Ack is inside attach, after the insert. */
export async function startBackgroundConsumer(opts: {
  brokerUrl: string;
  tx: Tx;
  crashBeforeAck?: boolean;
}): Promise<{ close: () => Promise<void> }> {
  const { conn, ch } = await open(opts.brokerUrl);
  const stats: ConsumerStats = { delivered: 0, acked: 0, rejected: 0 };
  void attach(ch, opts.tx, { crashBeforeAck: opts.crashBeforeAck }, stats).catch(() => undefined);
  return {
    close: async () => {
      try {
        await conn.close();
      } catch {
        // Already closed.
      }
    },
  };
}
