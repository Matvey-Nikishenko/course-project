import { spawn } from 'node:child_process';
import net from 'node:net';
import { INestApplication } from '@nestjs/common';
import { report } from './broker/demo-setup';
import {
  bootApi,
  closeDemo,
  DEMO_PASSWORD,
  http,
  resetUsers,
  upsertUser,
} from './auth/demo-support';
import { createStorageClient, ensureBucket, resetPrefix, storageConfig } from './storage/s3';
import { FILE_STATEMENTS } from './uploads/ddl';
import dataSource from './data-source';

const EMAILS = ['upload-demo@example.com'];
const FILENAME = '../../etc/passwd';
const CONTENT_TYPE = 'image/png';
const EXPIRES_SECONDS = 12;

function portAccepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(400);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function putWithoutKeys(url: string, bytes: Buffer, contentType: string): Promise<number> {
  const script = `
    const { URL } = require('node:url');
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', async () => {
      const res = await fetch(process.argv[1], {
        method: 'PUT',
        headers: { 'content-type': process.argv[2] },
        body: Buffer.concat(chunks),
      });
      console.log(String(res.status));
    });
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script, url, contentType], {
      env: { PATH: process.env.PATH ?? '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    child.stderr.on('data', () => undefined);
    child.stdin.end(bytes);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`offline PUT exited ${code}`));
        return;
      }
      resolve(Number(out.trim()));
    });
  });
}

function tamperKey(url: string): string {
  const parsed = new URL(url);
  const segments = parsed.pathname.split('/');
  segments[segments.length - 1] = 'tampered.png';
  parsed.pathname = segments.join('/');
  return parsed.toString();
}

async function ensureFiles(): Promise<void> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  for (const sql of FILE_STATEMENTS) await dataSource.query(sql);
}

async function main(): Promise<void> {
  process.env.PRESIGN_EXPIRES_SECONDS = String(EXPIRES_SECONDS);
  const storage = storageConfig();
  if (!storage?.endpoint) throw new Error('STORAGE_ENDPOINT is required');
  const client = createStorageClient(storage);
  await ensureBucket(client, storage.bucket);
  await resetPrefix(client, storage.bucket, 'uploads/');
  await ensureFiles();
  await resetUsers(EMAILS);
  await upsertUser(EMAILS[0], 'buyer', 0);

  const bytes = Buffer.from('avatar-bytes');
  let app: INestApplication | undefined;
  try {
    const first = await bootApi();
    app = first.app;
    const login = await http(first.base, 'POST', '/auth/login', {
      body: { email: EMAILS[0], password: DEMO_PASSWORD },
    });
    const token = String(login.json.access_token ?? '');
    const signedAt = Date.now();
    const expiry = await http(first.base, 'POST', '/uploads/intent', {
      token,
      body: { filename: FILENAME, content_type: CONTENT_TYPE, size_bytes: bytes.length },
    });
    const intent = await http(first.base, 'POST', '/uploads/intent', {
      token,
      body: { filename: FILENAME, content_type: CONTENT_TYPE, size_bytes: bytes.length },
    });
    const empty = await http(first.base, 'POST', '/uploads/intent', {
      token,
      body: { filename: FILENAME, content_type: CONTENT_TYPE, size_bytes: bytes.length },
    });
    const commitWithout = await http(first.base, 'POST', '/uploads/commit', {
      token,
      body: { id: empty.json.id },
    });
    const port = Number(new URL(first.base).port);
    await app.close();
    app = undefined;
    let alive = true;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      alive = await portAccepts(port);
      if (!alive) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const url = String(intent.json.url ?? '');
    const key = String(intent.json.key ?? '');
    const putOffline = await putWithoutKeys(url, bytes, CONTENT_TYPE);
    const tampered = await putWithoutKeys(tamperKey(url), bytes, CONTENT_TYPE);
    const wait = signedAt + EXPIRES_SECONDS * 1000 + 2000 - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const expired = await putWithoutKeys(String(expiry.json.url ?? ''), bytes, CONTENT_TYPE);

    const second = await bootApi();
    app = second.app;
    const commit = await http(second.base, 'POST', '/uploads/commit', {
      token,
      body: { id: intent.json.id },
    });

    const rows = {
      intent: intent.status,
      'key-from-server': key.includes('passwd') || key.includes('..') ? 0 : 1,
      'api-alive': alive ? 1 : 0,
      'put-offline': putOffline,
      commit: commit.status,
      'commit-without-bytes': commitWithout.status,
      tampered,
      expired,
    };
    const ok =
      rows.intent === 200 &&
      rows['key-from-server'] === 1 &&
      rows['api-alive'] === 0 &&
      rows['put-offline'] === 200 &&
      rows.commit === 200 &&
      rows['commit-without-bytes'] >= 400 &&
      rows['commit-without-bytes'] < 500 &&
      rows.tampered === 403 &&
      rows.expired === 403;
    await resetPrefix(client, storage.bucket, 'uploads/');
    await resetUsers(EMAILS);
    await closeDemo(app);
    app = undefined;
    client.destroy();
    report(rows, ok);
    process.exit(0);
  } finally {
    if (app) await closeDemo(app).catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
