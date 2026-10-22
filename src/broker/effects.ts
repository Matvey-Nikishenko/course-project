import { DataSource } from 'typeorm';
import { OrderPlacedEvent } from './order-placed';

export type Queryable = {
  query(sql: string, params?: unknown[]): Promise<unknown>;
};

export type Tx = Queryable & {
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
};

function rowsOf(raw: unknown): Record<string, unknown>[] {
  if (raw && typeof raw === 'object' && 'rows' in raw && Array.isArray((raw as { rows: unknown }).rows)) {
    return (raw as { rows: Record<string, unknown>[] }).rows;
  }
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (Array.isArray(raw[0])) return raw[0] as Record<string, unknown>[];
  if (typeof raw[0] === 'object' && raw[0] !== null) return raw as Record<string, unknown>[];
  return [];
}

export async function ensureEffectTables(q: Queryable): Promise<void> {
  await q.query(`
    CREATE TABLE IF NOT EXISTS order_placed_effects (
      event_id text PRIMARY KEY,
      order_id bigint NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await q.query(`
    CREATE TABLE IF NOT EXISTS order_placed_deliveries (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      event_id text NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function deleteDemoRows(q: Queryable): Promise<void> {
  await q.query(`DELETE FROM order_placed_deliveries WHERE event_id LIKE 'demo:%'`);
  await q.query(`DELETE FROM order_placed_effects WHERE event_id LIKE 'demo:%'`);
}

export async function countEvents(q: Queryable, table: 'order_placed_effects' | 'order_placed_deliveries', like: string): Promise<number> {
  const rows = rowsOf(
    await q.query(`SELECT count(*)::int AS n FROM ${table} WHERE event_id LIKE $1`, [like]),
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * The effect is the insert. ON CONFLICT DO NOTHING is idempotent; a second
 * delivery of the same eventId applies nothing. The delivery row is only a
 * counter so a demo can see the redelivery after the process is gone.
 */
export async function applyOrderPlaced(tx: Tx, event: OrderPlacedEvent): Promise<'applied' | 'skipped'> {
  return tx.transaction(async (q) => {
    const inserted = rowsOf(
      await q.query(
        `INSERT INTO order_placed_effects (event_id, order_id)
         VALUES ($1, $2)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [event.eventId, event.data.orderId],
      ),
    );
    await q.query(`INSERT INTO order_placed_deliveries (event_id) VALUES ($1)`, [event.eventId]);
    return inserted.length > 0 ? 'applied' : 'skipped';
  });
}

export function dataSourceTx(ds: DataSource): Tx {
  return {
    query: (sql, params) => ds.query(sql, params),
    transaction: (fn) =>
      ds.transaction((manager) => fn({ query: (sql, params) => manager.query(sql, params) })),
  };
}
