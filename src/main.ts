import './observability/otel';
import net from 'node:net';
import { assertAuthSecrets } from './auth/secrets';
import { lifecycle } from './lifecycle';
import { logger } from './observability/logger';

// Before Nest, and before the database pool. A missing signing key has to be
// the error the process names. Importing the app graph first can fail on Postgres
// and hide the variable.
assertAuthSecrets(process.env);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dbEndpoint(): { host: string; port: number } | null {
  const raw = process.env.DB_URL;
  if (!raw) return null;
  const url = new URL(raw);
  return { host: url.hostname, port: Number(url.port || '5432') };
}

async function waitForDatabase(): Promise<void> {
  const target = dbEndpoint();
  if (!target) return;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.connect(target);
      const done = (ok: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(500);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
    if (open) return;
    await sleep(500);
  }
}

async function bootstrap(): Promise<void> {
  const warmup = Number(process.env.WARMUP_MS ?? '0');
  const drain = Number(process.env.DRAIN_MS ?? '0');
  if (Number.isFinite(warmup) && warmup > 0) await sleep(warmup);
  await waitForDatabase();

  const { createApp } = await import('./configure-app');
  const { ConfigService } = await import('@nestjs/config');
  const app = await createApp();
  const config = app.get(ConfigService);
  const port = config.get('PORT');
  await app.listen(port);
  lifecycle.ready = true;
  logger.info({ port }, 'listening');

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    lifecycle.ready = false;
    if (Number.isFinite(drain) && drain > 0) await sleep(drain);
    await app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => {
    void stop();
  });
  process.once('SIGINT', () => {
    void stop();
  });
}

bootstrap();
