import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Env } from '../config/env.schema';
import { configuredRedisUrl } from '../redis/url';
import { TypeormService } from '../typeorm/typeorm.service';
import { ProductCard, QueryMeter, queryProductCard } from './product-card.query';
import { productCardKey, readThrough } from './read-through';

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private redis: Redis | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly typeorm: TypeormService,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = configuredRedisUrl(this.config.get('REDIS_URL', { infer: true }));
    if (!url) return;
    const redis = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1000,
      retryStrategy: () => null,
    });
    redis.on('error', () => undefined);
    try {
      await redis.connect();
      this.redis = redis;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`product cache is off: ${message}`);
      redis.disconnect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) await this.redis.quit().catch(() => undefined);
  }

  async read(id: number): Promise<ProductCard | null> {
    const meter: QueryMeter = { queries: 0 };
    const load = () => queryProductCard(this.typeorm.ds, String(id), meter);
    if (!this.redis) return load();
    try {
      return await readThrough(this.redis, productCardKey(id), load);
    } catch (err) {
      if (meter.queries > 0) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`product cache read failed: ${message}`);
      return load();
    }
  }

  async invalidate(ids: number[]): Promise<void> {
    if (!this.redis || ids.length === 0) return;
    try {
      await this.redis.del(...ids.map((id) => productCardKey(id)));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`product cache invalidate failed: ${message}`);
    }
  }
}
