import { ChannelModel, ConfirmChannel, connect } from 'amqplib';
import { ORDER_PLACED_KEY, SHOP_EXCHANGE } from './names';

export type Outbound = { body: Buffer; contentType: string };

/**
 * One confirm channel for the life of the holder. Checkout reuses it.
 * A publisher that asserts queues would be learning who listens, so this
 * only publishes to the exchange.
 */
export class ConfirmedPublisher {
  private constructor(
    private readonly conn: ChannelModel,
    private readonly channel: ConfirmChannel,
  ) {}

  static async open(
    brokerUrl: string,
    onDrop?: (publisher: ConfirmedPublisher) => void,
  ): Promise<ConfirmedPublisher> {
    const conn = await connect(brokerUrl);
    try {
      const channel = await conn.createConfirmChannel();
      const publisher = new ConfirmedPublisher(conn, channel);
      const drop = () => onDrop?.(publisher);
      conn.on('error', drop);
      conn.on('close', drop);
      channel.on('error', drop);
      channel.on('close', drop);
      return publisher;
    } catch (err) {
      try {
        await conn.close();
      } catch {
        // The socket is already gone.
      }
      throw err;
    }
  }

  async publish(messages: Outbound[]): Promise<number> {
    for (const message of messages) {
      this.channel.publish(SHOP_EXCHANGE, ORDER_PLACED_KEY, message.body, {
        persistent: true,
        contentType: message.contentType,
      });
    }
    await this.channel.waitForConfirms();
    return messages.length;
  }

  async close(): Promise<void> {
    try {
      await this.channel.close();
    } catch {
      // Already closed.
    }
    try {
      await this.conn.close();
    } catch {
      // Already closed.
    }
  }
}

/** One connection for a single batch, then close. The API process does not use this. */
export async function publishConfirmed(brokerUrl: string, messages: Outbound[]): Promise<number> {
  const publisher = await ConfirmedPublisher.open(brokerUrl);
  try {
    return await publisher.publish(messages);
  } finally {
    await publisher.close();
  }
}
