const PLACEHOLDER_USER = 'USER';
const PLACEHOLDER_PASSWORD = 'PASSWORD';

/** Example file uses this placeholder so a copied .env does not dial a fake user. */
export function configuredRedisUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.username === PLACEHOLDER_USER && url.password === PLACEHOLDER_PASSWORD) return undefined;
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

export function requiredRedisUrl(name: 'REDIS_URL' | 'REDIS_QUEUE_URL'): string {
  const url = configuredRedisUrl(process.env[name]);
  if (!url) throw new Error(`${name} is not set`);
  return url;
}
