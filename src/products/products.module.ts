import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { TypeormModule } from '../typeorm/typeorm.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [TypeormModule, RedisModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
