import { Module } from '@nestjs/common';
import { TypeormModule } from '../typeorm/typeorm.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [TypeormModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
