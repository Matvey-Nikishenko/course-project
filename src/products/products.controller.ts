import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AccessClaims } from '../auth/tokens';
import { CursorPageQueryDto } from '../common/dto/cursor-page-query.dto';
import { Roles } from '../roles/roles.decorator';
import { RolesGuard } from '../roles/roles.guard';
import { CreateProductDto } from './dto/create-product.dto';
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

  @Post()
  @HttpCode(201)
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  create(@CurrentUser() user: AccessClaims, @Body() dto: CreateProductDto) {
    return this.productsService.createForSeller(user.id, dto);
  }
}
