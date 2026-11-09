import { randomInt, randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

/** Base plus a spread of 60 seconds, so one warm cycle does not expire together. */
const TTL_BASE_SECONDS = 300;
const TTL_JITTER_SECONDS = 60;

const UNLOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export function ttlWithJitter(): number {
  return TTL_BASE_SECONDS + randomInt(0, TTL_JITTER_SECONDS + 1);
}

export function productCardKey(id: number | string): string {
  return `product:card:${id}`;
}

/**
 * One database load for a cold key. Waiters poll the cache. The lock is
 * released only when the token still matches, so a late owner cannot delete
 * a lock somebody else already took.
 */
export async function readThrough<T>(redis: Redis, key: string, load: () => Promise<T>): Promise<T> {
  const lockKey = `lock:${key}`;
  const deadline = Date.now() + 4000;
  for (;;) {
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
    const token = randomUUID();
    const got = await redis.set(lockKey, token, 'PX', 5000, 'NX');
    if (got === 'OK') {
      try {
        const again = await redis.get(key);
        if (again !== null) return JSON.parse(again) as T;
        const value = await load();
        try {
          await redis.set(key, JSON.stringify(value), 'EX', ttlWithJitter());
        } catch {
          // A full cache must not fail the read that already reached Postgres.
        }
        return value;
      } finally {
        try {
          await redis.eval(UNLOCK_LUA, 1, lockKey, token);
        } catch {
          // The lock expires on its own.
        }
      }
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const last = await redis.get(key);
  if (last !== null) return JSON.parse(last) as T;
  throw new Error(`cache wait timed out for ${key}`);
}

/** Same jitter the card uses. The warm demo counts distinct TTLs of these keys. */
export async function warmKey(redis: Redis, key: string, value: string): Promise<void> {
  await redis.set(key, value, 'EX', ttlWithJitter());
}
