import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema';
import { relayOutbox } from '../outbox/relay';
import { TypeormService } from '../typeorm/typeorm.service';
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
  private ticking = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly typeorm: TypeormService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.url = configuredBrokerUrl(this.config.get('BROKER_URL', { infer: true }));
    if (!this.url) return;
    await this.ensure();
    this.timer = setInterval(() => {
      void this.tick();
    }, 2000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.opening = null;
    const current = this.publisher;
    this.publisher = null;
    if (current) await current.close();
  }

  private async tick(): Promise<void> {
    if (this.ticking || this.disposed) return;
    this.ticking = true;
    try {
      await relayOutbox(this.typeorm.ds, (event) => this.confirm(event));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`outbox relay failed: ${message}`);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * The order row is already committed. A broker failure is logged and does
   * not become an HTTP 500 for that order.
   */
  /** Throws when the broker does not confirm. The relay uses this so published_at stays unset. */
  async confirm(event: OrderPlacedEvent): Promise<void> {
    if (!this.url || this.disposed) throw new Error('broker publisher is not running');
    const job = this.tail.then(() => this.send(event));
    this.tail = job.then(
      () => undefined,
      () => undefined,
    );
    await job;
  }

  async publish(event: OrderPlacedEvent): Promise<void> {
    try {
      await this.confirm(event);
    } catch (err) {
      this.logger.error(`order.placed ${event.eventId} was not confirmed: ${this.messageOf(err)}`);
    }
  }

  private async send(event: OrderPlacedEvent): Promise<void> {
    const body = Buffer.from(JSON.stringify(event));
    const publisher = await this.ensure();
    try {
      await publisher.publish([{ body, contentType: 'application/json' }]);
    } catch (err) {
      if (this.publisher === publisher) this.publisher = null;
      await publisher.close();
      throw err;
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
