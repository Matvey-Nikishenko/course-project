/** Topic exchange for domain events. The publisher knows this name and the routing key only. */
export const SHOP_EXCHANGE = 'shop.events';

export const ORDER_PLACED_KEY = 'order.placed';

export const WORK_QUEUE = 'orders.placed';

export const DLX = 'shop.events.dlx';

export const DLQ = 'orders.placed.dlq';

/** Catches a publish whose routing key matches no binding. A confirm alone would still succeed. */
export const UNROUTABLE_EXCHANGE = 'shop.unroutable';

export const UNROUTABLE_QUEUE = 'shop.unroutable';

/**
 * In-flight messages per consumer. One effect is a single insert (a few
 * milliseconds), so 50 of them stay far under the 30-minute consumer_timeout.
 * Quorum queues cap this at 2000. 1 would only add a round trip here.
 */
export const PREFETCH = 50;
