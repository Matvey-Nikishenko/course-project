import Redis from 'ioredis';

export function openRedis(url: string): Redis {
  const redis = new Redis(url, { maxRetriesPerRequest: 2, connectTimeout: 2000 });
  redis.on('error', () => undefined);
  return redis;
}

export async function configValue(redis: Redis, name: string): Promise<string> {
  const raw = (await redis.config('GET', name)) as string[] | null;
  if (!raw) return '';
  return String(raw[1] ?? '');
}
