import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import {
  createStorageClient,
  ensureBucket,
  headObject,
  MIN_PART_BYTES,
  resetPrefix,
  storageConfig,
} from './storage/s3';
import { FILE_STATEMENTS } from './uploads/ddl';
import dataSource from './data-source';

const EMAILS = ['multipart-demo@example.com'];

async function ensureFiles(): Promise<void> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  for (const sql of FILE_STATEMENTS) await dataSource.query(sql);
}

function resumeInNewProcess(input: {
  base: string;
  token: string;
  id: number;
  file: string;
  partSize: number;
}): Promise<number> {
  const script = `
    const fs = require('node:fs');
    const input = JSON.parse(process.argv[1]);
    (async () => {
      const res = await fetch(input.base + '/uploads/resume', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + input.token,
        },
        body: JSON.stringify({ id: input.id }),
      });
      const body = await res.json();
      const file = fs.readFileSync(input.file);
      for (const part of body.parts) {
        const start = (part.part_number - 1) * input.partSize;
        const slice = file.subarray(start, Math.min(start + input.partSize, file.length));
        const put = await fetch(part.url, { method: 'PUT', body: slice });
        if (put.status !== 200) process.exit(2);
      }
      console.log(String(body.parts.length));
    })().catch(() => process.exit(1));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script, JSON.stringify(input)], {
      env: { PATH: process.env.PATH ?? '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`resume process exited ${code}`));
        return;
      }
      resolve(Number(out.trim()));
    });
  });
}

async function main(): Promise<void> {
  const storage = storageConfig();
  if (!storage) throw new Error('storage configuration is required');
  const client = createStorageClient(storage);
  await ensureBucket(client, storage.bucket);
  await resetPrefix(client, storage.bucket, 'uploads/');
  await ensureFiles();
  await resetUsers(EMAILS);
  await upsertUser(EMAILS[0], 'buyer', 0);

  const file = Buffer.alloc(MIN_PART_BYTES * 2 + 1, 7);
  file[file.length - 1] = 9;
  const dir = mkdtempSync(join(tmpdir(), 'hw26-multipart-'));
  const filePath = join(dir, 'object.bin');
  writeFileSync(filePath, file);

  let app: INestApplication | undefined;
  try {
    const booted = await bootApi();
    app = booted.app;
    const login = await http(booted.base, 'POST', '/auth/login', {
      body: { email: EMAILS[0], password: DEMO_PASSWORD },
    });
    const token = String(login.json.access_token ?? '');
    const intent = await http(booted.base, 'POST', '/uploads/intent', {
      token,
      body: {
        filename: '../../etc/passwd',
        content_type: 'application/octet-stream',
        size_bytes: file.length,
      },
    });
    const parts = (intent.json.parts ?? []) as { part_number: number; url: string }[];
    const partSize = Number(intent.json.part_size);
    for (const part of parts.filter((item) => item.part_number < 3)) {
      const start = (part.part_number - 1) * partSize;
      const slice = file.subarray(start, start + partSize);
      const put = await fetch(part.url, { method: 'PUT', body: slice });
      if (put.status !== 200) throw new Error(`part ${part.part_number} PUT ${put.status}`);
    }

    const headBefore = await headObject(client, storage.bucket, String(intent.json.key));
    const resumed = await resumeInNewProcess({
      base: booted.base,
      token,
      id: Number(intent.json.id),
      file: filePath,
      partSize,
    });
    const commit = await http(booted.base, 'POST', '/uploads/commit', {
      token,
      body: { id: intent.json.id },
    });
    const head = await headObject(client, storage.bucket, String(intent.json.key));
    const etag = (head?.etag ?? '').replace(/"/g, '');
    const md5 = createHash('md5').update(file).digest('hex');

    const rows = {
      'head-before-complete': headBefore ? 200 : 404,
      'resumed-parts': resumed,
      complete: commit.status,
      'size-match': head?.size === file.length ? 1 : 0,
      'etag-multipart': /-\d+$/.test(etag) && etag !== md5 ? 1 : 0,
    };
    const ok =
      rows['head-before-complete'] === 404 &&
      rows['resumed-parts'] === 1 &&
      rows.complete === 200 &&
      rows['size-match'] === 1 &&
      rows['etag-multipart'] === 1;
    await resetPrefix(client, storage.bucket, 'uploads/');
    await resetUsers(EMAILS);
    await closeDemo(app);
    app = undefined;
    client.destroy();
    rmSync(dir, { recursive: true, force: true });
    report(rows, ok);
    process.exit(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (app) await closeDemo(app).catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
