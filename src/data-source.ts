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

function connectionFromUrl(): PgConn {
  const raw = process.env.DB_URL;
  if (!raw) {
    throw new Error(
      'Missing DB_HOST/DB_USER/DB_NAME (TypeORM CLI / SKIP_VAULT) or DB_URL (Nest).',
    );
  }
  const url = new URL(raw);
  const file = process.env.DB_PASSWORD_FILE ?? 'secrets/db_password';
  const password =
    process.env.DB_PASSWORD ?? (existsSync(file) ? readFileSync(file, 'utf8').trim() : '');
  return {
    host: url.hostname,
    port: Number(url.port || '5432'),
    username: decodeURIComponent(url.username),
    password,
    database: url.pathname.replace(/^\//, ''),
  };
}

const conn = connectionFromDbVars() ?? connectionFromUrl();

export default new DataSource({
  type: 'postgres',
  ...conn,
  entities: [User, Product, Order, OrderItem, Job],
  migrations: [join(__dirname, 'migrations', '*.js')],
  synchronize: false,
  logging: false,
  extra: { max: Number(process.env.DB_POOL_MAX ?? '50') },
});
