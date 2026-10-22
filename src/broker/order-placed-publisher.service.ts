import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema';
import { configuredBrokerUrl } from './broker-url';
import { OrderPlacedEvent } from './order-placed';
import { publishConfirmed } from './publish-order-placed';

@Injectable()
export class OrderPlacedPublisherService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async publish(event: OrderPlacedEvent): Promise<void> {
    const url = configuredBrokerUrl(this.config.get('BROKER_URL', { infer: true }));
    if (!url) return;
    await publishConfirmed(url, [
      { body: Buffer.from(JSON.stringify(event)), contentType: 'application/json' },
    ]);
  }
}
