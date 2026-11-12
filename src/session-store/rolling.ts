import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

export function sessionKey(id: string): string {
  return `session:${id}`;
}

export async function openSession(redis: Redis, ttlSeconds: number): Promise<string> {
  const id = randomUUID();
  await redis.set(sessionKey(id), JSON.stringify({ id }), 'EX', ttlSeconds);
  return id;
}

/** Reads the session and moves its TTL forward. A miss returns null. */
export async function touchSession(
  redis: Redis,
  id: string,
  ttlSeconds: number,
): Promise<string | null> {
  return redis.getex(sessionKey(id), 'EX', ttlSeconds);
}
