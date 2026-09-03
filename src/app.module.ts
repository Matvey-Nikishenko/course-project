import { Module } from '@nestjs/common';
import { OrdersController } from './controllers/orders.controller';
import { ProductsController } from './controllers/products.controller';
import { MemoryStore } from './store';

@Module({
  controllers: [ProductsController, OrdersController],
  providers: [MemoryStore],
})
export class AppModule {}
