import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Env } from '../config/env.schema';
import { configuredRedisUrl } from '../redis/url';
import { touchSession } from './rolling';

/** A day. The demo passes a short TTL into the same function so a 2s wait is visible. */
export const SESSION_TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class SessionStoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionStoreService.name);
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
      this.logger.error(`session store is off: ${message}`);
      redis.disconnect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) await this.redis.quit().catch(() => undefined);
  }

  /** Sessions sit on the queue Redis. The cache instance evicts keys. */
  async touch(id: string): Promise<void> {
    if (!this.redis) return;
    try {
      await touchSession(this.redis, id, SESSION_TTL_SECONDS);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`session touch failed: ${message}`);
    }
  }
}
