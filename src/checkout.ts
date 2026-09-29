import { DataSource } from 'typeorm';
import { Job } from './entities/job';
import { Order } from './entities/order';
import { OrderItem } from './entities/order-item';

export class CheckoutRejected extends Error {
  constructor(readonly code: 'out_of_stock' | 'insufficient_funds') {
    super(code);
    this.name = 'CheckoutRejected';
  }
}

/** TypeORM/pg sometimes returns rows, sometimes [rows, rowCount]. */
function returningRows<T extends Record<string, unknown>>(raw: unknown): T[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (Array.isArray(raw[0])) return raw[0] as T[];
  if (typeof raw[0] === 'object' && raw[0] !== null) return raw as T[];
  return [];
}

export async function checkout(
  ds: DataSource,
  input: { buyerId: string; productId: string; quantity: number },
): Promise<{ orderId: string }> {
  if (input.quantity < 1) {
    throw new Error('quantity must be >= 1');
  }

  return ds.transaction(async (manager) => {
    // Atomic decrement: the WHERE clause is the lock and the oversell check.
    const stockRows = returningRows<{ id: string; price: string | number }>(
      await manager.query(
        `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING id, price`,
        [input.quantity, input.productId],
      ),
    );
    if (stockRows.length === 0) {
      throw new CheckoutRejected('out_of_stock');
    }

    const unitPrice = Number(stockRows[0].price);
    const total = unitPrice * input.quantity;

    const payRows = returningRows<{ id: string }>(
      await manager.query(
        `UPDATE users SET balance_cents = balance_cents - $1 WHERE id = $2 AND balance_cents >= $1 RETURNING id`,
        [total, input.buyerId],
      ),
    );
    if (payRows.length === 0) {
      throw new CheckoutRejected('insufficient_funds');
    }

    const order = manager.create(Order, {
      buyer: { id: input.buyerId },
      status: 'paid',
      total,
      items: [
        manager.create(OrderItem, {
          product: { id: input.productId },
          quantity: input.quantity,
          unitPrice,
        }),
      ],
    });
    const saved = await manager.save(order);

    await manager.save(
      manager.create(Job, {
        kind: 'receipt',
        payload: { orderId: saved.id },
        processed: 0,
      }),
    );

    return { orderId: saved.id };
  });
}
