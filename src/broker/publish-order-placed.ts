import { connect } from 'amqplib';
import { ORDER_PLACED_KEY, SHOP_EXCHANGE } from './names';

export type Outbound = { body: Buffer; contentType: string };

/**
 * Confirm channel only. No queue, no binding: a publisher that asserts its
 * listener's queue has learned who is listening.
 */
export async function publishConfirmed(brokerUrl: string, messages: Outbound[]): Promise<number> {
  const conn = await connect(brokerUrl);
  conn.on('error', () => undefined);
  try {
    const ch = await conn.createConfirmChannel();
    ch.on('error', () => undefined);
    for (const message of messages) {
      ch.publish(SHOP_EXCHANGE, ORDER_PLACED_KEY, message.body, {
        persistent: true,
        contentType: message.contentType,
      });
    }
    await ch.waitForConfirms();
    return messages.length;
  } finally {
    await conn.close();
  }
}
