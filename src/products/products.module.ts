import { Module } from '@nestjs/common';
import { StoreModule } from '../store/store.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [StoreModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
