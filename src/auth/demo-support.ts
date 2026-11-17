import { INestApplication } from '@nestjs/common';
import dataSource from '../data-source';
import { AUTH_STATEMENTS } from './ddl';
import { hashPassword } from './passwords';

export const DEMO_PASSWORD = 'demo-password';

export function ensureDbUrl(): void {
  if (process.env.DB_URL) return;
  const user = process.env.DB_USER;
  const host = process.env.DB_HOST;
  const name = process.env.DB_NAME;
  if (!user || !host || !name) return;
  const port = process.env.DB_PORT ?? '5432';
  process.env.DB_URL = `postgres://${user}@${host}:${port}/${name}`;
}

export async function bootApi(): Promise<{ app: INestApplication; base: string }> {
  process.env.OUTBOX_AUTOSTART = '0';
  ensureDbUrl();
  const { createApp } = await import('../configure-app');
  const app = await createApp();
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') throw new Error('listen returned no port');
  return { app, base: `http://127.0.0.1:${address.port}` };
}

async function ready(): Promise<void> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  for (const sql of AUTH_STATEMENTS) await dataSource.query(sql);
}

function firstRow<T>(raw: unknown): T {
  const list = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : raw;
  if (!Array.isArray(list) || !list[0]) throw new Error('expected a row');
  return list[0] as T;
}

export async function resetUsers(emails: string[]): Promise<void> {
  await ready();
  await dataSource.query(
    `DELETE FROM orders WHERE buyer_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`,
    [emails],
  );
  await dataSource.query(
    `DELETE FROM products WHERE seller_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`,
    [emails],
  );
  await dataSource.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
}

export async function upsertUser(
  email: string,
  role: 'buyer' | 'seller',
  balance: number,
): Promise<string> {
  await ready();
  const hash = await hashPassword(DEMO_PASSWORD);
  const raw = await dataSource.query(
    `INSERT INTO users (email, role, balance_cents, password_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE
       SET role = EXCLUDED.role,
           balance_cents = EXCLUDED.balance_cents,
           password_hash = EXCLUDED.password_hash
     RETURNING id`,
    [email, role, balance, hash],
  );
  return String(firstRow<{ id: string }>(raw).id);
}

export async function insertProduct(
  sellerId: string,
  name: string,
  price: number,
  stock: number,
): Promise<string> {
  await ready();
  const raw = await dataSource.query(
    `INSERT INTO products (seller_id, name, description, price, stock)
     VALUES ($1, $2, '', $3, $4)
     RETURNING id`,
    [sellerId, name, price, stock],
  );
  return String(firstRow<{ id: string }>(raw).id);
}

export async function closeDemo(app: INestApplication | undefined): Promise<void> {
  if (app) {
    await app.close().catch(() => undefined);
  }
  if (dataSource.isInitialized) await dataSource.destroy();
}

export async function http(
  base: string,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = {};
    }
  }
  return { status: res.status, json };
}

export function tamperRole(access: string): string {
  const parts = access.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Record<string, unknown>;
  payload.role = 'admin';
  parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return parts.join('.');
}
