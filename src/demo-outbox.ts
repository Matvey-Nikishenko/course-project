import dataSource from './data-source';
import { runBoundedConsumer } from './broker/consume-order-placed';
import { dataSourceTx } from './broker/effects';
import { requiredBrokerUrl } from './broker/broker-url';
import { publishConfirmed } from './broker/publish-order-placed';
import { report } from './broker/demo-setup';
import { checkout } from './checkout';
import { OrderPlacedEvent } from './broker/order-placed';
import { closeDemo, measure, prepareDemo } from './outbox/demo-support';
import { relayOutbox } from './outbox/relay';

const KEY = 'demo:outbox:key';

async function publish(event: OrderPlacedEvent): Promise<void> {
  await publishConfirmed(requiredBrokerUrl(), [
    { body: Buffer.from(JSON.stringify(event)), contentType: 'application/json' },
  ]);
}

async function main(): Promise<void> {
  const fixture = await prepareDemo(KEY);
  const rows = {
    requests: 0,
    orders: 0,
    outbox: 0,
    published: 0,
    deliveries: 0,
    effect: 0,
    processed: 0,
  };
  try {
    let orderId = '';
    for (let i = 0; i < 2; i += 1) {
      rows.requests += 1;
      const placed = await checkout(dataSource, {
        buyerId: fixture.buyerId,
        items: [{ productId: fixture.productId, quantity: 1 }],
        idempotencyKey: KEY,
        fingerprint: 'demo:outbox',
      });
      orderId = placed.orderId;
    }
    rows.published = await relayOutbox(dataSource, publish, { aggregateId: orderId });
    await runBoundedConsumer({
      brokerUrl: requiredBrokerUrl(),
      tx: dataSourceTx(dataSource),
      stopAfter: 1,
    });
    const measured = await measure(KEY);
    rows.orders = measured.orders;
    rows.outbox = measured.outbox;
    rows.deliveries = measured.deliveries;
    rows.effect = measured.effect;
    rows.processed = measured.processed;
  } finally {
    await closeDemo();
  }
  const ok =
    rows.requests === 2 &&
    rows.orders === 1 &&
    rows.outbox === 1 &&
    rows.published === 1 &&
    rows.deliveries === 1 &&
    rows.effect === 1 &&
    rows.processed === 1;
  report(rows, ok);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
