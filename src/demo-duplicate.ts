import { spawn } from 'node:child_process';
import path from 'node:path';
import { runBoundedConsumer, startBackgroundConsumer } from './broker/consume-order-placed';
import { closeDemo, openDemo, openEffectLog, poll, report } from './broker/demo-setup';
import { countEvents } from './broker/effects';
import { WORK_QUEUE } from './broker/names';
import { publishConfirmed } from './broker/publish-order-placed';
import { queueDepth } from './broker/topology';

const EVENT_ID = 'demo:duplicate:1';

async function crashConsumer(): Promise<void> {
  const log = await openEffectLog();
  await startBackgroundConsumer({
    brokerUrl: log.brokerUrl,
    tx: log.tx,
    crashBeforeAck: true,
  });
  await new Promise(() => undefined);
}

async function main(): Promise<void> {
  if (process.argv.includes('--crash')) {
    await crashConsumer();
    return;
  }

  const demo = await openDemo();
  const rows = { deliveries: 0, effect: 0, skipped: 0 };
  let child: ReturnType<typeof spawn> | undefined;
  try {
    await publishConfirmed(demo.brokerUrl, [
      {
        contentType: 'application/json',
        body: Buffer.from(
          JSON.stringify({
            eventId: EVENT_ID,
            type: 'order.placed',
            occurredAt: '2026-10-22T00:00:00.000Z',
            data: { orderId: 1, buyerId: 1, totalCents: 100, status: 'paid' },
          }),
        ),
      },
    ]);

    let stderr = '';
    let earlyExit: number | null = null;
    child = spawn(process.execPath, [path.join(__dirname, 'demo-duplicate.js'), '--crash'], {
      env: process.env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('exit', (code, signal) => {
      if (signal !== 'SIGKILL') earlyExit = code;
    });

    await poll('effect committed before ack', async () => {
      if (earlyExit !== null) {
        throw new Error(`crash consumer exited ${earlyExit}: ${stderr}`);
      }
      const effects = await countEvents(demo.tx, 'order_placed_effects', EVENT_ID);
      return effects === 1;
    });
    await new Promise<void>((resolve) => {
      if (!child || child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once('exit', () => resolve());
      child.kill('SIGKILL');
    });

    await poll(
      'broker redelivered the unacked message',
      async () => (await queueDepth(demo.conn, WORK_QUEUE)) >= 1,
    );
    await runBoundedConsumer({ brokerUrl: demo.brokerUrl, tx: demo.tx, stopAfter: 1 });
    rows.deliveries = await countEvents(demo.tx, 'order_placed_deliveries', EVENT_ID);
    rows.effect = await countEvents(demo.tx, 'order_placed_effects', EVENT_ID);
    rows.skipped = rows.deliveries - rows.effect;
  } finally {
    if (child && child.exitCode === null && !child.killed) child.kill('SIGKILL');
    await closeDemo(demo);
  }
  const ok = rows.deliveries >= 2 && rows.effect === 1 && rows.skipped >= 1;
  report(rows, ok);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
