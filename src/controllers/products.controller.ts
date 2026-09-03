import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { CursorPageQueryDto } from '../dto/cursor-page-query.dto';
import { MemoryStore } from '../store';
import { paginate } from '../utils/pagination';

@Controller('products')
export class ProductsController {
  constructor(private readonly store: MemoryStore) {}

  @Get()
  list(@Query() query: CursorPageQueryDto) {
    return paginate(
      this.store.products.map((p) => ({ ...p })),
      query.limit ?? 10,
      query.cursor,
    );
  }

  @Get(':id')
  one(@Param('id', ParseIntPipe) id: number) {
    return this.store.getProduct(id);
  }
}
