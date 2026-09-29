import 'reflect-metadata';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { Job } from './entities/job';
import { Order } from './entities/order';
import { OrderItem } from './entities/order-item';
import { Product } from './entities/product';
import { User } from './entities/user';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Inject it from the secret store or export it for SKIP_VAULT=1.`);
  }
  return value;
}

export default new DataSource({
  type: 'postgres',
  host: required('DB_HOST'),
  port: Number(process.env.DB_PORT ?? '5432'),
  username: required('DB_USER'),
  password: process.env.DB_PASSWORD ?? '',
  database: required('DB_NAME'),
  entities: [User, Product, Order, OrderItem, Job],
  migrations: [join(__dirname, 'migrations', '*.js')],
  synchronize: false,
  logging: false,
  extra: { max: 50 },
});
