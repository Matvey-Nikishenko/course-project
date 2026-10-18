import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Subscription } from 'rxjs';
import { CursorPageQueryDto } from '../common/dto/cursor-page-query.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderEventsService, OrderStatusEvent } from './order-events.service';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderEvents: OrderEventsService,
  ) {}

  @Get()
  list(@Query() query: CursorPageQueryDto) {
    return this.ordersService.list(query);
  }

  @Get(':id/events')
  events(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    const lastRaw = req.header('last-event-id');
    const last = lastRaw === undefined || lastRaw === '' ? 0 : Number(lastRaw);
    const lastId = Number.isFinite(last) ? last : 0;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');

    let seen = lastId;
    const write = (event: OrderStatusEvent) => {
      if (event.id <= seen) return;
      seen = event.id;
      res.write(`id: ${event.id}\nevent: order.status\ndata: ${JSON.stringify(event)}\n\n`);
    };

    const subscription: Subscription = this.orderEvents.stream(id).subscribe({
      next: write,
      error: () => res.end(),
    });
    for (const event of this.orderEvents.since(id, lastId)) write(event);

    req.on('close', () => subscription.unsubscribe());
  }

  @Get(':id')
  one(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderStatusDto) {
    return this.ordersService.updateStatus(id, dto.status);
  }

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateOrderDto, @Res({ passthrough: true }) res: Response) {
    const order = await this.ordersService.create(dto);
    res.setHeader('Location', `/orders/${order.id}`);
    return order;
  }
}
