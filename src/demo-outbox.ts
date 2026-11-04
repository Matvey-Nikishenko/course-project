import { INestApplication } from '@nestjs/common';
import dataSource from './data-source';
import { createApp } from './configure-app';
import { runBoundedConsumer } from './broker/consume-order-placed';
import { dataSourceTx } from './broker/effects';
import { requiredBrokerUrl } from './broker/broker-url';
import { publishConfirmed } from './broker/publish-order-placed';
import { report } from './broker/demo-setup';
import { OrderPlacedEvent } from './broker/order-placed';
import { closeDemo, measure, prepareDemo } from './outbox/demo-support';
import { relayOutbox } from './outbox/relay';

const KEY = 'demo:outbox:key';

async function publish(event: OrderPlacedEvent): Promise<void> {
  await publishConfirmed(requiredBrokerUrl(), [
    { body: Buffer.from(JSON.stringify(event)), contentType: 'application/json' },
  ]);
}

function ensureDbUrl(): void {
  if (process.env.DB_URL) return;
  const user = process.env.DB_USER;
  const host = process.env.DB_HOST;
  const name = process.env.DB_NAME;
  if (!user || !host || !name) return;
  const port = process.env.DB_PORT ?? '5432';
  process.env.DB_URL = `postgres://${user}@${host}:${port}/${name}`;
}

async function postOrder(base: string, body: unknown): Promise<string> {
  const res = await fetch(`${base}/orders`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status !== 201) throw new Error(`POST /orders ${res.status}: ${text}`);
  const json = JSON.parse(text) as { id: number };
  return String(json.id);
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
  process.env.OUTBOX_AUTOSTART = '0';
  ensureDbUrl();
  let app: INestApplication | undefined;
  try {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') throw new Error('demo server has no port');
    const base = `http://127.0.0.1:${address.port}`;
    const body = {
      buyer_id: Number(fixture.buyerId),
      items: [{ product_id: Number(fixture.productId), quantity: 1 }],
    };
    let orderId = '';
    for (let i = 0; i < 2; i += 1) {
      rows.requests += 1;
      orderId = await postOrder(base, body);
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
    if (app) await app.close().catch(() => undefined);
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
