import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { filter } from 'rxjs/operators';
import { TypeormService } from '../typeorm/typeorm.service';

export type OrderStatusEvent = {
  id: number;
  orderId: number;
  status: string;
};

const BUFFER_LIMIT = 100;

/** TypeORM/pg sometimes returns rows, sometimes [rows, rowCount]. */
function queryRows(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (Array.isArray(raw[0])) return raw[0] as Record<string, unknown>[];
  if (typeof raw[0] === 'object' && raw[0] !== null) return raw as Record<string, unknown>[];
  return [];
}

/**
 * Live fan-out is a Subject (one process). The numbered log is Postgres, so a
 * restarted process still answers Last-Event-ID from the rows it wrote.
 */
@Injectable()
export class OrderEventsService {
  private readonly events = new Subject<OrderStatusEvent>();

  readonly events$ = this.events.asObservable();

  constructor(private readonly typeorm: TypeormService) {}

  static room(orderId: number): string {
    return `orders:${orderId}`;
  }

  async publish(orderId: number, status: string): Promise<OrderStatusEvent> {
    const event = await this.typeorm.ds.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1::bigint)', [orderId]);
      const inserted = queryRows(
        await manager.query(
          `INSERT INTO order_status_events (order_id, event_id, status)
           VALUES (
             $1,
             (SELECT coalesce(max(event_id), 0) + 1 FROM order_status_events WHERE order_id = $1),
             $2
           )
           RETURNING event_id`,
          [orderId, status],
        ),
      );
      await manager.query(
        `DELETE FROM order_status_events
         WHERE order_id = $1
           AND event_id <= (
             SELECT event_id FROM order_status_events
             WHERE order_id = $1
             ORDER BY event_id DESC
             OFFSET $2 LIMIT 1
           )`,
        [orderId, BUFFER_LIMIT],
      );
      return {
        id: Number(inserted[0].event_id),
        orderId,
        status,
      };
    });
    this.events.next(event);
    return event;
  }

  async since(orderId: number, lastEventId: number): Promise<OrderStatusEvent[]> {
    const rows = queryRows(
      await this.typeorm.ds.query(
        `SELECT event_id, status
         FROM order_status_events
         WHERE order_id = $1 AND event_id > $2
         ORDER BY event_id`,
        [orderId, lastEventId],
      ),
    );
    return rows.map((row) => ({
      id: Number(row.event_id),
      orderId,
      status: String(row.status),
    }));
  }

  stream(orderId: number): Observable<OrderStatusEvent> {
    return this.events$.pipe(filter((event) => event.orderId === orderId));
  }
}
