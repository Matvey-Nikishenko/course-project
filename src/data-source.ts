import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { Job } from './entities/job';
import { Order } from './entities/order';
import { OrderItem } from './entities/order-item';
import { Product } from './entities/product';
import { User } from './entities/user';

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
