import { Channel } from 'amqplib';
import { countEvents } from './broker/effects';
import { DLQ, WORK_QUEUE } from './broker/names';
import { closeDemo, openDemo, poll, report } from './broker/demo-setup';
import { runBoundedConsumer } from './broker/consume-order-placed';
import { publishConfirmed } from './broker/publish-order-placed';
import { deathReason, queueDepth } from './broker/topology';

const REASONS = new Set(['rejected', 'expired', 'maxlen', 'delivery_limit']);

async function readReason(ch: Channel): Promise<string> {
  const msg = await ch.get(DLQ, { noAck: false });
  if (!msg) return '';
  const reason = deathReason(msg.properties.headers);
  ch.nack(msg, false, true);
  return reason;
}

async function main(): Promise<void> {
  const demo = await openDemo();
  const rows = {
    rejected: 0,
    work: -1,
    dlq: -1,
    'dlq-reason': '',
    effect: 0,
  };
  try {
    await publishConfirmed(demo.brokerUrl, [
      { body: Buffer.from('not-a-contract'), contentType: 'text/plain' },
    ]);
    const stats = await runBoundedConsumer({
      brokerUrl: demo.brokerUrl,
      tx: demo.tx,
      stopAfter: 1,
    });
    rows.rejected = stats.rejected;
    await poll('work queue empty', async () => (await queueDepth(demo.conn, WORK_QUEUE)) === 0);
    await poll('dlq holds the poison', async () => (await queueDepth(demo.conn, DLQ)) === 1);
    const ch = await demo.conn.createChannel();
    try {
      rows['dlq-reason'] = await readReason(ch);
    } finally {
      await ch.close();
    }
    await poll('dlq depth restored', async () => (await queueDepth(demo.conn, DLQ)) === 1);
    rows.work = await queueDepth(demo.conn, WORK_QUEUE);
    rows.dlq = await queueDepth(demo.conn, DLQ);
    rows.effect = await countEvents(demo.tx, 'order_placed_effects', 'demo:%');
  } finally {
    await closeDemo(demo);
  }
  const ok =
    rows.rejected === 1 &&
    rows.work === 0 &&
    rows.dlq === 1 &&
    REASONS.has(rows['dlq-reason']) &&
    rows.effect === 0;
  report(rows, ok);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
