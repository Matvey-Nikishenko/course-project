import { spawn } from 'node:child_process';
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { report } from './broker/demo-setup';
import { createApp } from './configure-app';
import { requiredRedisUrl } from './redis/url';

function ensureDbUrl(): void {
  if (process.env.DB_URL) return;
  const user = process.env.DB_USER;
  const host = process.env.DB_HOST;
  const name = process.env.DB_NAME;
  if (!user || !host || !name) return;
  const port = process.env.DB_PORT ?? '5432';
  process.env.DB_URL = `postgres://${user}@${host}:${port}/${name}`;
}

async function bootApi(): Promise<{ app: INestApplication; base: string }> {
  process.env.OUTBOX_AUTOSTART = '0';
  ensureDbUrl();
  const app = await createApp();
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') throw new Error('listen returned no port');
  return { app, base: `http://127.0.0.1:${address.port}` };
}

async function closeDemo(app: INestApplication | undefined): Promise<void> {
  if (app) await app.close().catch(() => undefined);
}

const LIMIT = 5;
const WINDOW_MS = 10_000;
const CLIENT = '203.0.113.22';
const REQUESTS = LIMIT + 2;

const CHILD = `
const base = process.argv[1];
const ip = process.argv[2];
const n = Number(process.argv[3]);
(async () => {
  for (let i = 0; i < n; i += 1) {
    const res = await fetch(base + '/health', { headers: { 'x-forwarded-for': ip } });
    console.log(res.status + ' ' + (res.headers.get('retry-after') ? '1' : '0'));
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

function hit(base: string, count: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', CHILD, base, CLIENT, String(count)], {
      env: { PATH: process.env.PATH ?? '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += String(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(err || `pod exited ${code}`));
      else resolve(out);
    });
  });
}

async function main(): Promise<void> {
  process.env.RATE_LIMIT = String(LIMIT);
  process.env.RATE_LIMIT_WINDOW_MS = String(WINDOW_MS);
  const redis = new Redis(requiredRedisUrl('REDIS_QUEUE_URL'), {
    maxRetriesPerRequest: 2,
    connectTimeout: 2000,
  });
  redis.on('error', () => undefined);
  const rows = {
    instances: 2,
    limit: LIMIT,
    requests: REQUESTS,
    allowed: 0,
    blocked: 0,
    status: 0,
    'retry-after': 0,
  };
  let app: Awaited<ReturnType<typeof bootApi>>['app'] | undefined;
  try {
    await redis.del(`rl:api:${CLIENT}`);
    const booted = await bootApi();
    app = booted.app;
    const outputs = await Promise.all([hit(booted.base, 4), hit(booted.base, 3)]);
    for (const line of outputs.join('\n').split('\n')) {
      const [status, retry] = line.trim().split(' ');
      if (!status) continue;
      if (status === '200') rows.allowed += 1;
      else {
        rows.blocked += 1;
        rows.status = Number(status);
        if (retry === '1') rows['retry-after'] = 1;
      }
    }
  } finally {
    await redis.del(`rl:api:${CLIENT}`).catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await closeDemo(app);
  }
  const ok =
    rows.status === 429 &&
    rows['retry-after'] === 1 &&
    rows.instances >= 2 &&
    rows.allowed === rows.limit &&
    rows.blocked >= 1 &&
    rows.requests === rows.allowed + rows.blocked;
  report(rows, ok);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
