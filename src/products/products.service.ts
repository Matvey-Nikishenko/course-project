import { Injectable } from '@nestjs/common';
import { CursorPageQueryDto } from '../common/dto/cursor-page-query.dto';
import { paginate } from '../common/pagination/pagination';
import { StoreService } from '../store/store.service';

@Injectable()
export class ProductsService {
  constructor(private readonly store: StoreService) {}

  list(query: CursorPageQueryDto) {
    return paginate(
      this.store.products.map((p) => ({ ...p })),
      query.limit ?? 10,
      query.cursor,
    );
  }

  findOne(id: number) {
    return this.store.getProduct(id);
  }
}
