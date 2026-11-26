#!/usr/bin/env bash
# Writes ephemeral application secrets for one job.
# In GitHub Actions the values go to GITHUB_ENV and are not printed.
set -euo pipefail
node --input-type=module <<'JS'
import { appendFileSync } from 'node:fs';
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const pair = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const b64 = (value) => Buffer.from(value).toString('base64');
const values = {
  SKIP_VAULT: '1',
  PULUMI_STACK: 'ci',
  JWT_KID: 'ci',
  JWT_PRIVATE_KEY: b64(pair.privateKey),
  JWT_PUBLIC_KEY: b64(pair.publicKey),
  REFRESH_TOKEN_PEPPER: randomBytes(24).toString('hex'),
  STORAGE_ACCESS_KEY: 'ci-access-key',
  STORAGE_SECRET_KEY: randomBytes(16).toString('hex'),
  APP_DB_PASSWORD: randomBytes(18).toString('hex'),
  PULUMI_CONFIG_PASSPHRASE: randomBytes(18).toString('hex'),
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
  PROMETHEUS_URL: 'http://127.0.0.1:9090',
  TRACE_API_URL: 'http://127.0.0.1:3200',
  GRAFANA_URL: 'http://127.0.0.1:3000',
  GRAFANA_ADMIN_USER: 'admin',
  GRAFANA_ADMIN_PASSWORD: randomBytes(12).toString('hex'),
};

const dest = process.env.GITHUB_ENV;
if (dest) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n');
  appendFileSync(dest, `${lines}\n`);
} else {
  for (const [key, value] of Object.entries(values)) {
    process.stdout.write(`export ${key}=${JSON.stringify(value)}\n`);
  }
}
JS
