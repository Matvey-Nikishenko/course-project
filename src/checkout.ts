import { DataSource } from 'typeorm';
import { Job } from './entities/job';
import { Order } from './entities/order';
import { OrderItem } from './entities/order-item';
import { Product } from './entities/product';

export class CheckoutRejected extends Error {
  constructor(readonly code: 'out_of_stock' | 'insufficient_funds' | 'unknown_product') {
    super(code);
    this.name = 'CheckoutRejected';
  }
}

export type CheckoutLine = { productId: string; quantity: number };

/** TypeORM/pg sometimes returns rows, sometimes [rows, rowCount]. */
function returningRows<T extends Record<string, unknown>>(raw: unknown): T[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (Array.isArray(raw[0])) return raw[0] as T[];
  if (typeof raw[0] === 'object' && raw[0] !== null) return raw as T[];
  return [];
}

export async function checkout(
  ds: DataSource,
  input: { buyerId: string; items: CheckoutLine[] },
): Promise<{ orderId: string }> {
  if (input.items.length < 1 || input.items.some((item) => item.quantity < 1)) {
    throw new Error('checkout needs at least one line with quantity >= 1');
  }

  return ds.transaction(async (manager) => {
    const lines: { productId: string; quantity: number; unitPrice: number }[] = [];
    let total = 0;

    for (const item of input.items) {
      const stockRows = returningRows<{ id: string; price: string | number }>(
        await manager.query(
          `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING id, price`,
          [item.quantity, item.productId],
        ),
      );
      if (stockRows.length === 0) {
        const exists = await manager.findOne(Product, { where: { id: item.productId } });
        throw new CheckoutRejected(exists ? 'out_of_stock' : 'unknown_product');
      }
      const unitPrice = Number(stockRows[0].price);
      total += unitPrice * item.quantity;
      lines.push({ productId: item.productId, quantity: item.quantity, unitPrice });
    }

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
      items: lines.map((line) =>
        manager.create(OrderItem, {
          product: { id: line.productId },
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        }),
      ),
    });
    const saved = await manager.save(order);

    await manager.save(
      manager.create(Job, {
        kind: 'receipt',
        payload: { orderId: saved.id },
        processed: 0,
        attempts: 0,
      }),
    );

    return { orderId: saved.id };
  });
}
