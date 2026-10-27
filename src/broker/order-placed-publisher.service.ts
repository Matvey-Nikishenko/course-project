import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema';
import { configuredBrokerUrl } from './broker-url';
import { OrderPlacedEvent } from './order-placed';
import { ConfirmedPublisher } from './publish-order-placed';

@Injectable()
export class OrderPlacedPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderPlacedPublisherService.name);
  private url: string | undefined;
  private publisher: ConfirmedPublisher | null = null;
  private opening: Promise<ConfirmedPublisher> | null = null;
  private tail: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async onModuleInit(): Promise<void> {
    this.url = configuredBrokerUrl(this.config.get('BROKER_URL', { infer: true }));
    if (!this.url) return;
    await this.ensure();
  }

  async onModuleDestroy(): Promise<void> {
    this.disposed = true;
    this.opening = null;
    const current = this.publisher;
    this.publisher = null;
    if (current) await current.close();
  }

  /**
   * The order row is already committed. A broker failure is logged and does
   * not become an HTTP 500 for that order.
   */
  async publish(event: OrderPlacedEvent): Promise<void> {
    if (!this.url || this.disposed) return;
    const job = this.tail.then(() => this.send(event));
    this.tail = job.then(
      () => undefined,
      () => undefined,
    );
    await job;
  }

  private async send(event: OrderPlacedEvent): Promise<void> {
    const body = Buffer.from(JSON.stringify(event));
    let publisher: ConfirmedPublisher;
    try {
      publisher = await this.ensure();
    } catch (err) {
      this.logger.error(`order.placed ${event.eventId} was not confirmed: ${this.messageOf(err)}`);
      return;
    }
    try {
      await publisher.publish([{ body, contentType: 'application/json' }]);
    } catch (err) {
      if (this.publisher === publisher) this.publisher = null;
      await publisher.close();
      this.logger.error(`order.placed ${event.eventId} was not confirmed: ${this.messageOf(err)}`);
    }
  }

  private async ensure(): Promise<ConfirmedPublisher> {
    if (this.publisher) return this.publisher;
    if (!this.url) throw new Error('BROKER_URL is not set');
    if (!this.opening) {
      const url = this.url;
      this.opening = ConfirmedPublisher.open(url, (dropped) => {
        if (this.publisher === dropped) this.publisher = null;
      }).then((publisher) => {
        this.publisher = publisher;
        return publisher;
      });
      void this.opening.finally(() => {
        this.opening = null;
      });
    }
    return this.opening;
  }

  private messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
