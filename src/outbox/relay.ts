import { DataSource } from 'typeorm';
import { OrderPlacedEvent, parseOrderPlaced } from '../broker/order-placed';

export class RelayCrashed extends Error {
  constructor() {
    super('relay crashed after publish and before published_at');
    this.name = 'RelayCrashed';
  }
}

export const RELAY_BATCH = 10;

function rowsOf<T extends Record<string, unknown>>(raw: unknown): T[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (Array.isArray(raw[0])) return raw[0] as T[];
  if (typeof raw[0] === 'object' && raw[0] !== null) return raw as T[];
  return [];
}

function eventFromPayload(payload: unknown): OrderPlacedEvent {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return parseOrderPlaced(Buffer.from(raw));
}

/**
 * Polls the outbox. attempts is committed before publish, so a crash between
 * publish and published_at still counts. published_at is set only after the
 * broker confirms. A crash in between delivers twice; the consumer collapses
 * that back to one effect.
 */
export async function relayOutbox(
  ds: DataSource,
  publish: (event: OrderPlacedEvent) => Promise<void>,
  opts?: { limit?: number; crashAfterPublish?: boolean; aggregateId?: string },
): Promise<number> {
  const limit = opts?.limit ?? RELAY_BATCH;
  const claimed = await ds.transaction(async (manager) => {
    const rows = rowsOf<{ id: string; payload: unknown }>(
      await manager.query(
        `SELECT id, payload
         FROM outbox
         WHERE published_at IS NULL
           AND ($2::text IS NULL OR aggregate_id = $2)
         ORDER BY created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $1`,
        [limit, opts?.aggregateId ?? null],
      ),
    );
    for (const row of rows) {
      await manager.query(`UPDATE outbox SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    }
    return rows;
  });

  let published = 0;
  for (const row of claimed) {
    await publish(eventFromPayload(row.payload));
    published += 1;
    if (opts?.crashAfterPublish) throw new RelayCrashed();
    await ds.query(`UPDATE outbox SET published_at = now() WHERE id = $1 AND published_at IS NULL`, [
      row.id,
    ]);
  }
  return published;
}

/** Hourly maintenance. Not on the relay tick: that predicate would seq-scan every 2s. */
export async function purgePublishedOutbox(ds: DataSource): Promise<void> {
  await ds.query(`DELETE FROM outbox WHERE published_at < now() - interval '7 days'`);
}
