import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { TypeormModule } from '../typeorm/typeorm.module';
import { OrderPlacedConsumerService } from './order-placed-consumer.service';
import { OrderPlacedPublisherService } from './order-placed-publisher.service';

@Module({
  imports: [TypeormModule, RedisModule],
  providers: [OrderPlacedPublisherService, OrderPlacedConsumerService],
  exports: [OrderPlacedPublisherService],
})
export class BrokerModule {}
