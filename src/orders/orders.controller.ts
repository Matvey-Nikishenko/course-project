import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CursorPageQueryDto } from '../common/dto/cursor-page-query.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  list(@Query() query: CursorPageQueryDto) {
    return this.ordersService.list(query);
  }

  @Get(':id')
  one(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.findOne(id);
  }

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateOrderDto, @Res({ passthrough: true }) res: Response) {
    const order = this.ordersService.create(dto.items);
    res.setHeader('Location', `/orders/${order.id}`);
    return order;
  }
}
