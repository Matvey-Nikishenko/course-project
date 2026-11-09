import dataSource from './data-source';
import { report } from './broker/demo-setup';
import { queryProductCard } from './cache/product-card.query';
import { productCardKey, readThrough, warmKey } from './cache/read-through';
import { configValue, openRedis } from './redis/config';
import { requiredRedisUrl } from './redis/url';

const SELLER = 'cache-demo-seller@example.com';
const PRODUCT = 'Cache demo card';
const WARMED = 60;
const CONCURRENT = 20;

function rowsOf(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (Array.isArray(raw[0])) return raw[0] as Record<string, unknown>[];
  if (typeof raw[0] === 'object' && raw[0] !== null) return raw as Record<string, unknown>[];
  return [];
}

async function fixture(): Promise<string> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  const seller = rowsOf(
    await dataSource.query(
      `INSERT INTO users (email, role, balance_cents)
       VALUES ($1, 'seller', 0)
       ON CONFLICT (email) DO UPDATE SET balance_cents = users.balance_cents
       RETURNING id`,
      [SELLER],
    ),
  );
  const found = rowsOf(
    await dataSource.query(`SELECT id FROM products WHERE seller_id = $1 AND name = $2`, [
      seller[0].id,
      PRODUCT,
    ]),
  );
  if (found[0]) return String(found[0].id);
  const inserted = rowsOf(
    await dataSource.query(
      `INSERT INTO products (seller_id, name, description, price, stock)
       VALUES ($1, $2, '', 100, 50)
       RETURNING id`,
      [seller[0].id, PRODUCT],
    ),
  );
  return String(inserted[0].id);
}

async function main(): Promise<void> {
  const redis = openRedis(requiredRedisUrl('REDIS_URL'));
  const run = Date.now();
  const warmKeys: string[] = [];
  const rows = {
    'cache-lru': 0,
    'cache-maxmemory': 0,
    warmed: 0,
    'ttl-distinct': 0,
    concurrent: CONCURRENT,
    'db-calls': 0,
    'db-calls-warm': 0,
  };
  try {
    const policy = await configValue(redis, 'maxmemory-policy');
    const maxmemory = Number(await configValue(redis, 'maxmemory'));
    rows['cache-lru'] = policy !== 'noeviction' && policy !== '' ? 1 : 0;
    rows['cache-maxmemory'] = maxmemory > 0 ? 1 : 0;

    const productId = await fixture();
    for (let i = 0; i < WARMED; i += 1) {
      const key = `product:card:warm:${run}:${i}`;
      warmKeys.push(key);
      await warmKey(redis, key, '1');
    }
    const ttls = await Promise.all(warmKeys.map((key) => redis.ttl(key)));
    rows.warmed = warmKeys.length;
    rows['ttl-distinct'] = new Set(ttls).size;

    const key = productCardKey(productId);
    await redis.del(key);
    const cold = { queries: 0 };
    await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        readThrough(redis, key, () => queryProductCard(dataSource, productId, cold)),
      ),
    );
    rows['db-calls'] = cold.queries;

    const warm = { queries: 0 };
    await Promise.all(
      Array.from({ length: 100 }, () =>
        readThrough(redis, key, () => queryProductCard(dataSource, productId, warm)),
      ),
    );
    rows['db-calls-warm'] = warm.queries;
  } finally {
    if (warmKeys.length > 0) await redis.del(...warmKeys).catch(() => undefined);
    await redis.quit().catch(() => undefined);
    if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined);
  }
  const ok =
    rows['db-calls'] === 1 &&
    rows['db-calls-warm'] === 0 &&
    rows['cache-lru'] === 1 &&
    rows['cache-maxmemory'] === 1 &&
    rows.concurrent >= 20 &&
    rows.warmed >= 50 &&
    rows['ttl-distinct'] >= 5;
  report(rows, ok);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
