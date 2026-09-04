import { Module } from '@nestjs/common';
import { StoreModule } from '../store/store.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [StoreModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
