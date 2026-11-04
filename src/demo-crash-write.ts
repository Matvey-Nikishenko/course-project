import dataSource from './data-source';
import { report } from './broker/demo-setup';
import { CheckoutCrashed, checkout } from './checkout';
import { closeDemo, measure, prepareDemo } from './outbox/demo-support';

const KEY = 'demo:crash-write:key';

async function main(): Promise<void> {
  const fixture = await prepareDemo(KEY);
  const rows = {
    'write-failed': 0,
    orders: 0,
    outbox: 0,
    published: 0,
    deliveries: 0,
    effect: 0,
  };
  try {
    try {
      await checkout(dataSource, {
        buyerId: fixture.buyerId,
        items: [{ productId: fixture.productId, quantity: 1 }],
        idempotencyKey: KEY,
        fingerprint: 'demo:crash-write',
        crashAfterOutbox: true,
      });
    } catch (err) {
      if (!(err instanceof CheckoutCrashed)) throw err;
      rows['write-failed'] = 1;
    }
    const measured = await measure(KEY);
    rows.orders = measured.orders;
    rows.outbox = measured.outbox;
    rows.deliveries = measured.deliveries;
    rows.effect = measured.effect;
  } finally {
    await closeDemo();
  }
  const ok =
    rows['write-failed'] === 1 &&
    rows.orders === 0 &&
    rows.outbox === 0 &&
    rows.published === 0 &&
    rows.deliveries === 0 &&
    rows.effect === 0;
  report(rows, ok);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
