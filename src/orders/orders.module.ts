import { Module } from '@nestjs/common';
import { TypeormModule } from '../typeorm/typeorm.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [TypeormModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
