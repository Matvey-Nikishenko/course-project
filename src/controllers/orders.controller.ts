import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CreateOrderDto } from '../dto/create-order.dto';
import { CursorPageQueryDto } from '../dto/cursor-page-query.dto';
import { MemoryStore } from '../store';
import { paginate } from '../utils/pagination';

@Controller('orders')
export class OrdersController {
  constructor(private readonly store: MemoryStore) {}

  @Get()
  list(@Query() query: CursorPageQueryDto) {
    return paginate(
      this.store.orders.map((o) => ({
        ...o,
        items: o.items.map((item) => ({ ...item })),
      })),
      query.limit ?? 10,
      query.cursor,
    );
  }

  @Get(':id')
  one(@Param('id', ParseIntPipe) id: number) {
    return this.store.getOrder(id);
  }

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateOrderDto, @Res({ passthrough: true }) res: Response) {
    const order = this.store.createOrder(dto.items);
    res.setHeader('Location', `/orders/${order.id}`);
    return order;
  }
}
