import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { Env } from '../config/env.schema';
import { configuredRedisUrl } from '../redis/url';
import { TypeormService } from '../typeorm/typeorm.service';
import { CacheService } from '../cache/cache.service';
import { jobOptions, queueConnection, RATING_QUEUE, scheduleEvery } from './options';

const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class RatingJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RatingJobsService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly typeorm: TypeormService,
    private readonly cache: CacheService,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = configuredRedisUrl(this.config.get('REDIS_QUEUE_URL', { infer: true }));
    if (!url) return;
    this.queue = new Queue(RATING_QUEUE, { connection: queueConnection(url, false) });
    this.worker = new Worker(RATING_QUEUE, (job) => this.run(job.name, job.data), {
      connection: queueConnection(url, true),
      concurrency: 4,
    });
    this.queue.on('error', (err) => this.logger.error(`rating queue: ${err.message}`));
    this.worker.on('error', (err) => this.logger.error(`rating worker: ${err.message}`));
    try {
      await scheduleEvery(this.queue, 'rating-sweep', HOUR_MS, 'sweep');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`rating scheduler was not upserted: ${message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close().catch(() => undefined);
    if (this.queue) await this.queue.close().catch(() => undefined);
  }

  async enqueue(orderId: number): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.add('recalc', { orderId }, jobOptions(`rating-${orderId}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`rating job was not added: ${message}`);
    }
  }

  private async run(name: string, data: { orderId?: number }): Promise<void> {
    if (name !== 'recalc' || data.orderId === undefined) return;
    const rows = (await this.typeorm.ds.query(
      `SELECT product_id FROM order_items WHERE order_id = $1`,
      [data.orderId],
    )) as { product_id: string }[];
    const ids = rows.map((row) => Number(row.product_id));
    await this.cache.invalidate(ids);
    for (const id of ids) await this.cache.read(id);
  }
}
