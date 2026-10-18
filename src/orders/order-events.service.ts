import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { filter } from 'rxjs/operators';

export type OrderStatusEvent = {
  id: number;
  orderId: number;
  status: string;
};

const BUFFER_LIMIT = 100;

/**
 * One bus for both transports. The gateway and the SSE controller subscribe;
 * neither owns the history. The buffer is what Last-Event-ID replays from.
 */
@Injectable()
export class OrderEventsService {
  private readonly events = new Subject<OrderStatusEvent>();
  private readonly buffers = new Map<number, OrderStatusEvent[]>();
  private readonly nextId = new Map<number, number>();

  readonly events$ = this.events.asObservable();

  static room(orderId: number): string {
    return `orders:${orderId}`;
  }

  publish(orderId: number, status: string): OrderStatusEvent {
    const id = (this.nextId.get(orderId) ?? 0) + 1;
    this.nextId.set(orderId, id);
    const event: OrderStatusEvent = { id, orderId, status };
    const buffer = this.buffers.get(orderId) ?? [];
    buffer.push(event);
    if (buffer.length > BUFFER_LIMIT) buffer.shift();
    this.buffers.set(orderId, buffer);
    this.events.next(event);
    return event;
  }

  since(orderId: number, lastEventId: number): OrderStatusEvent[] {
    return (this.buffers.get(orderId) ?? []).filter((event) => event.id > lastEventId);
  }

  stream(orderId: number): Observable<OrderStatusEvent> {
    return this.events$.pipe(filter((event) => event.orderId === orderId));
  }
}
