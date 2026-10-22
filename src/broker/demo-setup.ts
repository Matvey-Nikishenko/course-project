import { existsSync, readFileSync } from 'node:fs';
import { ChannelModel, connect } from 'amqplib';
import { Client } from 'pg';
import { requiredBrokerUrl } from './broker-url';
import { deleteDemoRows, ensureEffectTables, Queryable, Tx } from './effects';
import { resetTopology } from './topology';

function loadDotEnv(): void {
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

function pgConfig(): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  const host = process.env.DB_HOST;
  const user = process.env.DB_USER;
  const database = process.env.DB_NAME;
  if (host && user && database) {
    return {
      host,
      port: Number(process.env.DB_PORT ?? '5432'),
      user,
      password: process.env.DB_PASSWORD ?? '',
      database,
    };
  }
  const raw = process.env.DATABASE_URL ?? process.env.DB_URL;
  if (!raw) {
    throw new Error('Missing DB_HOST/DB_USER/DB_NAME or DATABASE_URL for the effect log.');
  }
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: Number(url.port || '5432'),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
  };
}

export function clientTx(client: Client): Tx {
  return {
    query: (sql, params) => client.query(sql, params),
    async transaction(fn) {
      await client.query('BEGIN');
      try {
        const result = await fn({ query: (sql, params) => client.query(sql, params) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    },
  };
}

export type Demo = {
  brokerUrl: string;
  client: Client;
  tx: Tx;
  conn: ChannelModel;
};

async function connectPg(): Promise<{ brokerUrl: string; client: Client; tx: Tx }> {
  loadDotEnv();
  const brokerUrl = requiredBrokerUrl();
  const client = new Client(pgConfig());
  client.on('error', () => undefined);
  await client.connect();
  const tx = clientTx(client);
  await ensureEffectTables(tx);
  return { brokerUrl, client, tx };
}

/** Effect log only. Does not touch the broker, so a published message stays queued. */
export async function openEffectLog(): Promise<{ brokerUrl: string; client: Client; tx: Tx }> {
  return connectPg();
}

export async function openDemo(): Promise<Demo> {
  const base = await connectPg();
  await deleteDemoRows(base.tx);
  const conn = await connect(base.brokerUrl);
  conn.on('error', () => undefined);
  await resetTopology(conn);
  return { ...base, conn };
}

export async function closeDemo(demo: Demo): Promise<void> {
  try {
    await demo.conn.close();
  } catch {
    // Already closed.
  }
  await demo.client.end();
}

export async function poll(label: string, ready: () => Promise<boolean>, ms = 20_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timeout: ${label}`);
}

export function report(rows: Record<string, string | number>, ok: boolean): void {
  for (const [key, value] of Object.entries(rows)) {
    console.log(`${key}=${value}`);
  }
  if (!ok) process.exit(1);
}

export type { Queryable };
