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
import { CreateOrderItemDto } from './dto/create-order-item.dto';
import type { Order } from './entities/order';

const HTTP_BUYER_EMAIL = 'buyer-kateryna@example.com';

@Injectable()
export class OrdersService {
  constructor(private readonly typeorm: TypeormService) {}

  async list(query: CursorPageQueryDto) {
    const rows = await this.typeorm.ds.getRepository(OrderRow).find({
      relations: { items: { product: true } },
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
      relations: { items: { product: true } },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'not-found',
        detail: `order ${id} not found`,
      });
    }
    return this.toHttp(row);
  }

  async create(items: CreateOrderItemDto[]): Promise<Order> {
    const buyer = await this.typeorm.ds.getRepository(User).findOne({
      where: { email: HTTP_BUYER_EMAIL },
    });
    if (!buyer) {
      throw new UnprocessableEntityException({
        code: 'unknown-buyer',
        detail: `seed buyer ${HTTP_BUYER_EMAIL} is missing — run npm run seed`,
      });
    }

    try {
      const { orderId } = await checkout(this.typeorm.ds, {
        buyerId: buyer.id,
        items: items.map((item) => ({
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

  private toHttp(row: OrderRow): Order {
    const status = row.status === 'cancelled' ? 'cancelled' : row.status === 'new' ? 'new' : 'paid';
    return {
      id: Number(row.id),
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
