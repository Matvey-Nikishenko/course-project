import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CursorPageQueryDto } from '../common/dto/cursor-page-query.dto';
import { paginate } from '../common/pagination/pagination';
import { CheckoutRejected, checkout } from '../checkout';
import { Order as OrderRow } from '../entities/order';
import { User } from '../entities/user';
import { TypeormService } from '../typeorm/typeorm.service';
import { OrderEventsService } from './order-events.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatusName } from './dto/update-order-status.dto';
import type { Order } from './entities/order';

@Injectable()
export class OrdersService {
  constructor(
    private readonly typeorm: TypeormService,
    private readonly orderEvents: OrderEventsService,
  ) {}

  async list(query: CursorPageQueryDto) {
    const rows = await this.typeorm.ds.getRepository(OrderRow).find({
      relations: { buyer: true, items: { product: true } },
      order: { id: 'ASC' },
    });
    return paginate(
      rows.map((row) => this.toHttp(row)),
      query.limit ?? 10,
      query.cursor,
    );
  }

  async findOne(id: number) {
    const row = await this.typeorm.ds.getRepository(OrderRow).findOne({
      where: { id: String(id) },
      relations: { buyer: true, items: { product: true } },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'not-found',
        detail: `order ${id} not found`,
      });
    }
    return this.toHttp(row);
  }

  async create(dto: CreateOrderDto): Promise<Order> {
    const buyer = await this.typeorm.ds.getRepository(User).findOne({
      where: { id: String(dto.buyer_id) },
    });
    if (!buyer) {
      throw new UnprocessableEntityException({
        code: 'unknown-buyer',
        detail: `buyer ${dto.buyer_id} is not in the database`,
      });
    }

    try {
      const { orderId } = await checkout(this.typeorm.ds, {
        buyerId: buyer.id,
        items: dto.items.map((item) => ({
          productId: String(item.product_id),
          quantity: item.quantity,
        })),
      });
      return this.findOne(Number(orderId));
    } catch (err) {
      if (err instanceof CheckoutRejected) {
        if (err.code === 'unknown_product') {
          throw new UnprocessableEntityException({
            code: 'unknown-product',
            detail: 'one of the products is not in the catalog',
          });
        }
        if (err.code === 'out_of_stock') {
          throw new ConflictException({
            code: 'insufficient-stock',
            detail: 'insufficient stock for one of the products',
          });
        }
        throw new ConflictException({
          code: 'insufficient-funds',
          detail: 'buyer balance cannot cover this order',
        });
      }
      throw err;
    }
  }

  /** Buyer id as stored, or null when the order does not exist. Used by the gateway. */
  async ownerId(orderId: number): Promise<string | null> {
    const row = await this.typeorm.ds.getRepository(OrderRow).findOne({
      where: { id: String(orderId) },
      relations: { buyer: true },
    });
    return row?.buyer?.id ?? null;
  }

  async updateStatus(id: number, status: OrderStatusName): Promise<Order> {
    const repo = this.typeorm.ds.getRepository(OrderRow);
    const row = await repo.findOne({ where: { id: String(id) } });
    if (!row) {
      throw new NotFoundException({
        code: 'not-found',
        detail: `order ${id} not found`,
      });
    }
    row.status = status;
    await repo.save(row);
    this.orderEvents.publish(id, status);
    return this.findOne(id);
  }

  private toHttp(row: OrderRow): Order {
    const status = row.status;
    return {
      id: Number(row.id),
      buyer_id: Number(row.buyer.id),
      items: row.items.map((item) => ({
        product_id: Number(item.product.id),
        quantity: item.quantity,
        unit_price_cents: item.unitPrice,
      })),
      total_cents: row.total,
      status,
      created_at: row.createdAt.toISOString(),
    };
  }
}
