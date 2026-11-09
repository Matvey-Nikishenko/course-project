import Redis from 'ioredis';
import { report } from './broker/demo-setup';
import { requiredRedisUrl } from './redis/url';
import { applyLimit, takeToken } from './sliding-window/window';

const KEY = 'rl:demo:shared';
const LIMIT = 5;
const WINDOW_MS = 10_000;

function client(url: string): Redis {
  const redis = new Redis(url, { maxRetriesPerRequest: 2, connectTimeout: 2000 });
  redis.on('error', () => undefined);
  return redis;
}

async function main(): Promise<void> {
  const url = requiredRedisUrl('REDIS_QUEUE_URL');
  const pods = [client(url), client(url)];
  const rows = {
    instances: pods.length,
    limit: LIMIT,
    requests: 0,
    allowed: 0,
    blocked: 0,
    status: 0,
    'retry-after': 0,
  };
  try {
    await pods[0].del(KEY);
    const total = LIMIT + 2;
    for (let i = 0; i < total; i += 1) {
      rows.requests += 1;
      const decision = await takeToken(pods[i % pods.length], KEY, LIMIT, WINDOW_MS);
      const res = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        setHeader(name: string, value: string) {
          this.headers[name.toLowerCase()] = value;
        },
      };
      applyLimit(res, decision);
      if (decision.allowed) {
        rows.allowed += 1;
      } else {
        rows.blocked += 1;
        rows.status = res.statusCode;
        rows['retry-after'] = res.headers['retry-after'] ? 1 : 0;
      }
    }
  } finally {
    await pods[0].del(KEY).catch(() => undefined);
    await Promise.all(pods.map((redis) => redis.quit().catch(() => undefined)));
  }
  const ok =
    rows.status === 429 &&
    rows['retry-after'] === 1 &&
    rows.instances >= 2 &&
    rows.limit > 0 &&
    rows.allowed === rows.limit &&
    rows.blocked >= 1;
  report(rows, ok);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
