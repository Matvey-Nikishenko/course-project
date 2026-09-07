import { Injectable } from '@nestjs/common';
import { CursorPageQueryDto } from '../common/dto/cursor-page-query.dto';
import { paginate } from '../common/pagination/pagination';
import { StoreService } from '../store/store.service';
import { CreateOrderItemDto } from './dto/create-order-item.dto';

@Injectable()
export class OrdersService {
  constructor(private readonly store: StoreService) {}

  list(query: CursorPageQueryDto) {
    return paginate(
      this.store.orders.map((o) => ({
        ...o,
        items: o.items.map((item) => ({ ...item })),
      })),
      query.limit ?? 10,
      query.cursor,
    );
  }

  findOne(id: number) {
    return this.store.getOrder(id);
  }

  create(items: CreateOrderItemDto[]) {
    return this.store.createOrder(items);
  }
}
