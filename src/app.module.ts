import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validate } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { OrdersModule } from './orders/orders.module';
import { ProductsModule } from './products/products.module';
import { StoreModule } from './store/store.module';

@Module({
  imports: [
    // validate runs before the DI graph is built: a broken variable stops the
    // process here instead of surfacing on the first request in production.
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      envFilePath: '.env',
    }),
    DatabaseModule,
    HealthModule,
    StoreModule,
    ProductsModule,
    OrdersModule,
  ],
})
export class AppModule {}
