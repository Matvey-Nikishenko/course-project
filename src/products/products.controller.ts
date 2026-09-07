import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { CursorPageQueryDto } from '../common/dto/cursor-page-query.dto';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  list(@Query() query: CursorPageQueryDto) {
    return this.productsService.list(query);
  }

  @Get(':id')
  one(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.findOne(id);
  }
}
