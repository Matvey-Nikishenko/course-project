import { countEvents } from './broker/effects';
import { PREFETCH } from './broker/names';
import { closeDemo, openDemo, report } from './broker/demo-setup';
import { runBoundedConsumer } from './broker/consume-order-placed';
import { publishConfirmed } from './broker/publish-order-placed';
import { queueDepth } from './broker/topology';
import { DLQ } from './broker/names';

async function main(): Promise<void> {
  const demo = await openDemo();
  const rows = {
    published: 0,
    delivered: 0,
    effect: 0,
    acked: 0,
    dlq: 0,
    prefetch: PREFETCH,
  };
  try {
    const messages = [1, 2, 3, 4, 5].map((n) => ({
      contentType: 'application/json',
      body: Buffer.from(
        JSON.stringify({
          eventId: `demo:publish:${n}`,
          type: 'order.placed',
          occurredAt: '2026-10-22T00:00:00.000Z',
          data: { orderId: n, buyerId: 1, totalCents: 100, status: 'paid' },
        }),
      ),
    }));
    rows.published = await publishConfirmed(demo.brokerUrl, messages);
    const stats = await runBoundedConsumer({
      brokerUrl: demo.brokerUrl,
      tx: demo.tx,
      stopAfter: 5,
    });
    rows.delivered = stats.delivered;
    rows.acked = stats.acked;
    rows.effect = await countEvents(demo.tx, 'order_placed_effects', 'demo:publish:%');
    rows.dlq = await queueDepth(demo.conn, DLQ);
  } finally {
    await closeDemo(demo);
  }
  const ok =
    rows.published === 5 &&
    rows.delivered === 5 &&
    rows.effect === 5 &&
    rows.acked === 5 &&
    rows.dlq === 0 &&
    rows.prefetch >= 1 &&
    rows.prefetch <= 2000;
  report(rows, ok);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
