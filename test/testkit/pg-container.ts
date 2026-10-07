import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export interface PgHandle {
  container: StartedPostgreSqlContainer;
  pool: Pool;
  startupMs: number;
  uri: string;
  stop(): Promise<void>;
}

/**
 * Maps testcontainer URI (password in the URL) onto the Nest contract:
 * DB_URL without a password + a temp password file. DATABASE_URL is also set
 * because data-source.ts accepts it — it is issued by the container, not the vault.
 */
export function applyTestEnv(uri: string): void {
  const url = new URL(uri);
  const password = decodeURIComponent(url.password);
  const host = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
  const port = url.port || '5432';
  const database = url.pathname.replace(/^\//, '').replace(/\?.*$/, '');
  const user = decodeURIComponent(url.username);

  const dir = mkdtempSync(join(tmpdir(), 'marketplace-test-'));
  const passwordFile = join(dir, 'db_password');
  writeFileSync(passwordFile, password);

  process.env.DATABASE_URL = uri;
  process.env.DB_URL = `postgres://${user}@${host}:${port}/${database}`;
  process.env.DB_PASSWORD = password;
  process.env.DB_PASSWORD_FILE = passwordFile;
  process.env.DB_HOST = host;
  process.env.DB_PORT = port;
  process.env.DB_USER = user;
  process.env.DB_NAME = database;
  process.env.DB_POOL_MAX = process.env.DB_POOL_MAX ?? '5';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'error';
}

export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query(
    'TRUNCATE jobs, order_items, orders, products, users RESTART IDENTITY CASCADE',
  );
}

export async function startPg(label = ''): Promise<PgHandle> {
  const t0 = Date.now();
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const startupMs = Date.now() - t0;
  const uri = container.getConnectionUri();
  applyTestEnv(uri);

  const pool = new Pool({ connectionString: uri });
  const { buildDataSource } = await import('../../src/data-source');
  const ds = buildDataSource();
  await ds.initialize();
  await ds.runMigrations();
  await ds.destroy();

  // eslint-disable-next-line no-console
  console.log(
    `[testkit] postgres:16-alpine${label ? ` ${label}` : ''} ready in ${startupMs} ms → ${uri}`,
  );

  return {
    container,
    pool,
    startupMs,
    uri,
    async stop() {
      await pool.end();
      await container.stop();
    },
  };
}
