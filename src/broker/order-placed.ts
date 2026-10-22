export type OrderPlacedEvent = {
  eventId: string;
  type: 'order.placed';
  occurredAt: string;
  data: {
    orderId: number;
    buyerId: number;
    totalCents: number;
    status: string;
  };
};

export class BadEvent extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'BadEvent';
  }
}

export function orderPlacedEvent(input: {
  orderId: number;
  buyerId: number;
  totalCents: number;
  status: string;
  occurredAt: string;
}): OrderPlacedEvent {
  return {
    eventId: `order.placed:${input.orderId}`,
    type: 'order.placed',
    occurredAt: input.occurredAt,
    data: {
      orderId: input.orderId,
      buyerId: input.buyerId,
      totalCents: input.totalCents,
      status: input.status,
    },
  };
}

/** Stable id is the whole point: the consumer recognises a redelivery by eventId. */
export function parseOrderPlaced(body: Buffer): OrderPlacedEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new BadEvent('body is not json');
  }
  if (!raw || typeof raw !== 'object') throw new BadEvent('body is not an object');
  const record = raw as Record<string, unknown>;
  if (record.type !== 'order.placed') throw new BadEvent('type is not order.placed');
  if (typeof record.eventId !== 'string' || record.eventId.length < 1) {
    throw new BadEvent('eventId is missing');
  }
  if (typeof record.occurredAt !== 'string' || record.occurredAt.length < 1) {
    throw new BadEvent('occurredAt is missing');
  }
  const data = record.data;
  if (!data || typeof data !== 'object') throw new BadEvent('data is missing');
  const fields = data as Record<string, unknown>;
  const orderId = Number(fields.orderId);
  const buyerId = Number(fields.buyerId);
  const totalCents = Number(fields.totalCents);
  if (!Number.isInteger(orderId) || orderId < 1) throw new BadEvent('orderId is missing');
  if (!Number.isInteger(buyerId) || buyerId < 1) throw new BadEvent('buyerId is missing');
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new BadEvent('totalCents is missing');
  return {
    eventId: record.eventId,
    type: 'order.placed',
    occurredAt: record.occurredAt,
    data: {
      orderId,
      buyerId,
      totalCents,
      status: typeof fields.status === 'string' ? fields.status : 'paid',
    },
  };
}
