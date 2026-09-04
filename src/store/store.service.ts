import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { CreateOrderItemDto } from '../orders/dto/create-order-item.dto';
import type { Order } from '../orders/entities/order';
import type { Product } from '../products/entities/product';

@Injectable()
export class StoreService {
  readonly products: Product[] = [
    { id: 1, title: 'Keyboard', price_cents: 260000, stock: 10, image_url: 'https://cdn.example/kb.jpg' },
    { id: 2, title: 'Mouse', price_cents: 125000, stock: 5, image_url: null },
    { id: 3, title: 'Mouse pad', price_cents: 45000, stock: 20, image_url: 'https://cdn.example/pad.jpg' },
  ];

  readonly orders: Order[] = [
    {
      id: 1,
      items: [{ product_id: 1, quantity: 1, unit_price_cents: 260000 }],
      total_cents: 260000,
      status: 'paid',
      created_at: '2026-08-20T09:12:00.000Z',
    },
  ];

  private nextOrderId = 2;

  getProduct(id: number): Product {
    const product = this.products.find((p) => p.id === id);
    if (!product) {
      throw new NotFoundException({
        code: 'not-found',
        detail: `product ${id} not found`,
      });
    }
    return { ...product };
  }

  getOrder(id: number): Order {
    const order = this.orders.find((o) => o.id === id);
    if (!order) {
      throw new NotFoundException({
        code: 'not-found',
        detail: `order ${id} not found`,
      });
    }
    return { ...order, items: order.items.map((item) => ({ ...item })) };
  }

  createOrder(items: CreateOrderItemDto[]): Order {
    const lines: { product: Product; quantity: number }[] = [];
    for (const item of items) {
      const product = this.products.find((p) => p.id === item.product_id);
      if (!product) {
        throw new UnprocessableEntityException({
          code: 'unknown-product',
          detail: `product ${item.product_id} not found`,
        });
      }
      if (product.stock < item.quantity) {
        throw new ConflictException({
          code: 'insufficient-stock',
          detail: `insufficient stock for product ${product.id}: have ${product.stock}, need ${item.quantity}`,
        });
      }
      lines.push({ product, quantity: item.quantity });
    }

    for (const line of lines) line.product.stock -= line.quantity;

    const orderItems = lines.map((line) => ({
      product_id: line.product.id,
      quantity: line.quantity,
      unit_price_cents: line.product.price_cents,
    }));
    const order: Order = {
      id: this.nextOrderId++,
      items: orderItems,
      total_cents: orderItems.reduce(
        (sum, item) => sum + item.unit_price_cents * item.quantity,
        0,
      ),
      status: 'new',
      created_at: new Date().toISOString(),
    };
    this.orders.push(order);
    return { ...order, items: order.items.map((item) => ({ ...item })) };
  }
}
