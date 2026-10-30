import dataSource from './data-source';
import { runBoundedConsumer } from './broker/consume-order-placed';
import { dataSourceTx } from './broker/effects';
import { requiredBrokerUrl } from './broker/broker-url';
import { report } from './broker/demo-setup';
import { publishConfirmed } from './broker/publish-order-placed';
import { OrderPlacedEvent } from './broker/order-placed';
import { checkout } from './checkout';
import { closeDemo, measure, prepareDemo } from './outbox/demo-support';
import { RelayCrashed, relayOutbox } from './outbox/relay';

const KEY = 'demo:crash-relay:key';

async function publish(event: OrderPlacedEvent): Promise<void> {
  await publishConfirmed(requiredBrokerUrl(), [
    { body: Buffer.from(JSON.stringify(event)), contentType: 'application/json' },
  ]);
}

async function main(): Promise<void> {
  const fixture = await prepareDemo(KEY);
  const rows = {
    published: 0,
    deliveries: 0,
    applied: 0,
    effect: 0,
    processed: 0,
  };
  try {
    const placed = await checkout(dataSource, {
      buyerId: fixture.buyerId,
      items: [{ productId: fixture.productId, quantity: 1 }],
      idempotencyKey: KEY,
      fingerprint: 'demo:crash-relay',
    });
    try {
      await relayOutbox(dataSource, publish, {
        crashAfterPublish: true,
        limit: 1,
        aggregateId: placed.orderId,
      });
    } catch (err) {
      if (!(err instanceof RelayCrashed)) throw err;
      rows.published += 1;
    }
    rows.published += await relayOutbox(dataSource, publish, { aggregateId: placed.orderId });
    await runBoundedConsumer({
      brokerUrl: requiredBrokerUrl(),
      tx: dataSourceTx(dataSource),
      stopAfter: 2,
    });
    const measured = await measure(KEY);
    rows.deliveries = measured.deliveries;
    rows.applied = measured.effect;
    rows.effect = measured.effect;
    rows.processed = measured.processed;
  } finally {
    await closeDemo();
  }
  const ok =
    rows.published >= 2 &&
    rows.deliveries >= 2 &&
    rows.applied === 1 &&
    rows.effect === 1 &&
    rows.processed === 1;
  report(rows, ok);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
