import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

const TAKE_LUA = `
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local member = ARGV[3]
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])
if count < limit then
  redis.call('ZADD', KEYS[1], now, member)
  redis.call('PEXPIRE', KEYS[1], window)
  return {1, 0}
end
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local retry = 1
if oldest[2] then
  retry = math.ceil((tonumber(oldest[2]) + window - now) / 1000)
  if retry < 1 then retry = 1 end
end
return {0, retry}
`;

export type LimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export async function takeToken(
  redis: Redis,
  key: string,
  limit: number,
  windowMs: number,
): Promise<LimitDecision> {
  const raw = (await redis.eval(TAKE_LUA, 1, key, String(windowMs), String(limit), randomUUID())) as
    | unknown[]
    | null;
  const allowed = Number(raw?.[0] ?? 0) === 1;
  const retryAfterSeconds = Number(raw?.[1] ?? 1);
  return { allowed, retryAfterSeconds: allowed ? 0 : Math.max(1, retryAfterSeconds) };
}

export function applyLimit(
  res: { statusCode: number; setHeader(name: string, value: string): void },
  decision: LimitDecision,
): void {
  if (decision.allowed) return;
  res.statusCode = 429;
  res.setHeader('Retry-After', String(decision.retryAfterSeconds));
}
