import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { TypeormModule } from '../typeorm/typeorm.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersGateway } from './orders.gateway';
import { OrderEventsService } from './order-events.service';

@Module({
  imports: [TypeormModule, RedisModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersGateway, OrderEventsService],
})
export class OrdersModule {}
