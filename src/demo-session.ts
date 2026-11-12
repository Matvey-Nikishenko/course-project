import Redis from 'ioredis';
import { report } from './broker/demo-setup';
import { configValue, openRedis } from './redis/config';
import { requiredRedisUrl } from './redis/url';
import { openSession, sessionKey, touchSession } from './session-store/rolling';

const TTL_SECONDS = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const url = requiredRedisUrl('REDIS_QUEUE_URL');
  const redis = openRedis(url);
  const rows = { requests: 0, sessions: 0, 'in-redis': 0, 'ttl-renewed': 0 };
  let id = '';
  try {
    const policy = await configValue(redis, 'maxmemory-policy');
    if (policy !== 'noeviction') throw new Error(`sessions are on ${policy}, want noeviction`);
    id = await openSession(redis, TTL_SECONDS);
    const ids = new Set<string>([id]);
    rows.requests += 1;
    await touchSession(redis, id, TTL_SECONDS);
    await sleep(2000);
    const before = await redis.ttl(sessionKey(id));
    rows.requests += 1;
    const touched = await touchSession(redis, id, TTL_SECONDS);
    const after = await redis.ttl(sessionKey(id));
    if (!touched) throw new Error('session missing on the renewing request');
    rows['ttl-renewed'] = after > before ? 1 : 0;
    await sleep(1500);
    rows.requests += 1;
    await touchSession(redis, id, TTL_SECONDS);
    rows.sessions = ids.size;
    const probe = new Redis(url, { maxRetriesPerRequest: 2, connectTimeout: 2000 });
    probe.on('error', () => undefined);
    try {
      rows['in-redis'] = (await probe.exists(sessionKey(id))) === 1 ? 1 : 0;
    } finally {
      await probe.quit().catch(() => undefined);
    }
  } finally {
    if (id) await redis.del(sessionKey(id)).catch(() => undefined);
    await redis.quit().catch(() => undefined);
  }
  const ok = rows.sessions === 1 && rows['in-redis'] === 1 && rows['ttl-renewed'] === 1 && rows.requests >= 3;
  report(rows, ok);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
