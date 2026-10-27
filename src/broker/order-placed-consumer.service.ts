import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema';
import { TypeormService } from '../typeorm/typeorm.service';
import { configuredBrokerUrl } from './broker-url';
import { startBackgroundConsumer } from './consume-order-placed';
import { dataSourceTx, ensureEffectTables } from './effects';

@Injectable()
export class OrderPlacedConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderPlacedConsumerService.name);
  private close: (() => Promise<void>) | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly typeorm: TypeormService,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = configuredBrokerUrl(this.config.get('BROKER_URL', { infer: true }));
    if (!url) return;
    const tx = dataSourceTx(this.typeorm.ds);
    await ensureEffectTables(tx);
    const consumer = await startBackgroundConsumer({
      brokerUrl: url,
      tx,
      onError: (err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`order.placed consumer dropped the queue, reopening: ${message}`);
      },
    });
    this.close = consumer.close;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.close) await this.close();
  }
}
