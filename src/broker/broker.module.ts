import { Module } from '@nestjs/common';
import { TypeormModule } from '../typeorm/typeorm.module';
import { OrderPlacedConsumerService } from './order-placed-consumer.service';
import { OrderPlacedPublisherService } from './order-placed-publisher.service';

@Module({
  imports: [TypeormModule],
  providers: [OrderPlacedPublisherService, OrderPlacedConsumerService],
  exports: [OrderPlacedPublisherService],
})
export class BrokerModule {}
