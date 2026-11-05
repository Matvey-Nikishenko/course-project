import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Env } from '../config/env.schema';
import { configuredRedisUrl } from '../redis/url';
import { LimitDecision, takeToken } from './window';

const API_LIMIT = 120;
const API_WINDOW_MS = 60_000;

@Injectable()
export class SlidingWindowService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlidingWindowService.name);
  private redis: Redis | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async onModuleInit(): Promise<void> {
    const url = configuredRedisUrl(this.config.get('REDIS_QUEUE_URL', { infer: true }));
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
      this.logger.error(`rate limit is off: ${message}`);
      redis.disconnect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) await this.redis.quit().catch(() => undefined);
  }

  /** Null means the shared store is not configured and the request proceeds. */
  async take(ip: string): Promise<LimitDecision | null> {
    if (!this.redis) return null;
    try {
      return await takeToken(this.redis, `rl:api:${ip}`, API_LIMIT, API_WINDOW_MS);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`rate limit failed open: ${message}`);
      return null;
    }
  }
}
