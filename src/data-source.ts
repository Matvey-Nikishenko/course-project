import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { Job } from './entities/job';
import { Order } from './entities/order';
import { OrderItem } from './entities/order-item';
import { Product } from './entities/product';
import { User } from './entities/user';

// TypeORM CLI and this module both evaluate the DataSource at import time,
// which is before ConfigModule reads .env. Load it here when the shell did not.
function loadDotEnv(): void {
  if (process.env.DB_URL || process.env.DATABASE_URL || process.env.DB_HOST) return;
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnv();

type PgConn = {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
};

function connectionFromDbVars(): PgConn | null {
  const host = process.env.DB_HOST;
  const username = process.env.DB_USER;
  const database = process.env.DB_NAME;
  if (!host || !username || !database) return null;
  return {
    host,
    port: Number(process.env.DB_PORT ?? '5432'),
    username,
    password: process.env.DB_PASSWORD ?? '',
    database,
  };
}

function passwordFromUrlOrFile(url: URL): string {
  if (url.password) return decodeURIComponent(url.password);
  if (process.env.DB_PASSWORD) return process.env.DB_PASSWORD;
  const file = process.env.DB_PASSWORD_FILE ?? 'secrets/db_password';
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
}

function connectionFromUrl(): PgConn {
  const raw = process.env.DATABASE_URL ?? process.env.DB_URL;
  if (!raw) {
    throw new Error(
      'Missing DB_HOST/DB_USER/DB_NAME (TypeORM CLI / SKIP_VAULT) or DATABASE_URL/DB_URL.',
    );
  }
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: Number(url.port || '5432'),
    username: decodeURIComponent(url.username),
    password: passwordFromUrlOrFile(url),
    database: url.pathname.replace(/^\//, '').replace(/\?.*$/, ''),
  };
}

export function buildDataSource(): DataSource {
  const conn = connectionFromDbVars() ?? connectionFromUrl();
  return new DataSource({
    type: 'postgres',
    ...conn,
    entities: [User, Product, Order, OrderItem, Job],
    migrations: [join(__dirname, 'migrations', '*.js')],
    synchronize: false,
    logging: false,
    extra: { max: Number(process.env.DB_POOL_MAX ?? '50') },
  });
}

/** TypeORM CLI (`-d dist/data-source.js`) needs an instance; env is already set. */
export default buildDataSource();
