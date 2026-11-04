import { connect } from 'amqplib';
import dataSource from '../data-source';
import { requiredBrokerUrl } from '../broker/broker-url';
import { dataSourceTx, ensureEffectTables } from '../broker/effects';
import { resetTopology } from '../broker/topology';
import { OUTBOX_STATEMENTS } from './ddl';

const SELLER = 'outbox-demo-seller@example.com';
const BUYER = 'outbox-demo-buyer@example.com';
const PRODUCT = 'Outbox demo widget';

export type Fixture = { buyerId: string; productId: string };

function rowsOf(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (Array.isArray(raw[0])) return raw[0] as Record<string, unknown>[];
  if (typeof raw[0] === 'object' && raw[0] !== null) return raw as Record<string, unknown>[];
  return [];
}

async function scalar(sql: string, params: unknown[]): Promise<number> {
  const rows = rowsOf(await dataSource.query(sql, params));
  return Number(rows[0]?.n ?? 0);
}

export async function prepareDemo(key: string): Promise<Fixture> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  for (const statement of OUTBOX_STATEMENTS) await dataSource.query(statement);
  await ensureEffectTables(dataSourceTx(dataSource));
  await cleanup(key);

  const seller = rowsOf(
    await dataSource.query(
      `INSERT INTO users (email, role, balance_cents)
       VALUES ($1, 'seller', 0)
       ON CONFLICT (email) DO UPDATE SET balance_cents = users.balance_cents
       RETURNING id`,
      [SELLER],
    ),
  );
  const buyer = rowsOf(
    await dataSource.query(
      `INSERT INTO users (email, role, balance_cents)
       VALUES ($1, 'buyer', 100000000)
       ON CONFLICT (email) DO UPDATE SET balance_cents = 100000000
       RETURNING id`,
      [BUYER],
    ),
  );
  const found = rowsOf(
    await dataSource.query(`SELECT id FROM products WHERE seller_id = $1 AND name = $2`, [
      seller[0].id,
      PRODUCT,
    ]),
  );
  let productId = found[0] ? String(found[0].id) : '';
  if (!productId) {
    const inserted = rowsOf(
      await dataSource.query(
        `INSERT INTO products (seller_id, name, description, price, stock)
         VALUES ($1, $2, '', 100, 100)
         RETURNING id`,
        [seller[0].id, PRODUCT],
      ),
    );
    productId = String(inserted[0].id);
  } else {
    await dataSource.query(`UPDATE products SET stock = 100, price = 100 WHERE id = $1`, [productId]);
  }

  const conn = await connect(requiredBrokerUrl());
  conn.on('error', () => undefined);
  try {
    await resetTopology(conn);
  } finally {
    await conn.close();
  }
  return { buyerId: String(buyer[0].id), productId };
}

async function cleanup(key: string): Promise<void> {
  const owned = rowsOf(
    await dataSource.query(
      `SELECT order_id FROM idempotency_keys WHERE key = $1 AND order_id IS NOT NULL`,
      [key],
    ),
  );
  for (const row of owned) {
    const orderId = String(row.order_id);
    const eventId = `order.placed:${orderId}`;
    await dataSource.query(`DELETE FROM order_placed_deliveries WHERE event_id = $1`, [eventId]);
    await dataSource.query(`DELETE FROM order_placed_effects WHERE event_id = $1`, [eventId]);
    await dataSource.query(`DELETE FROM processed_messages WHERE message_id = $1`, [eventId]);
    await dataSource.query(`DELETE FROM outbox WHERE aggregate_id = $1`, [orderId]);
    await dataSource.query(`DELETE FROM order_items WHERE order_id = $1`, [orderId]);
    await dataSource.query(`DELETE FROM jobs WHERE payload->>'orderId' = $1`, [orderId]);
    await dataSource.query(`DELETE FROM orders WHERE id = $1`, [orderId]);
  }
  await dataSource.query(`DELETE FROM idempotency_keys WHERE key = $1`, [key]);
}

export async function measure(key: string): Promise<{
  orders: number;
  outbox: number;
  deliveries: number;
  effect: number;
  processed: number;
}> {
  const owned = rowsOf(
    await dataSource.query(
      `SELECT order_id FROM idempotency_keys WHERE key = $1 AND order_id IS NOT NULL`,
      [key],
    ),
  );
  if (owned.length === 0) {
    return { orders: 0, outbox: 0, deliveries: 0, effect: 0, processed: 0 };
  }
  const orderId = String(owned[0].order_id);
  const eventId = `order.placed:${orderId}`;
  return {
    orders: owned.length,
    outbox: await scalar(`SELECT count(*)::int AS n FROM outbox WHERE aggregate_id = $1`, [orderId]),
    deliveries: await scalar(`SELECT count(*)::int AS n FROM order_placed_deliveries WHERE event_id = $1`, [eventId]),
    effect: await scalar(`SELECT count(*)::int AS n FROM order_placed_effects WHERE event_id = $1`, [eventId]),
    processed: await scalar(
      `SELECT count(*)::int AS n FROM processed_messages WHERE message_id = $1 AND consumer = 'order-placed'`,
      [eventId],
    ),
  };
}

export async function closeDemo(): Promise<void> {
  if (dataSource.isInitialized) await dataSource.destroy();
}
