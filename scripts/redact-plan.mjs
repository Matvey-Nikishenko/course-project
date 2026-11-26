import { readFileSync, writeFileSync } from 'node:fs';

const names = [
  'APP_DB_PASSWORD',
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'REFRESH_TOKEN_PEPPER',
  'STORAGE_SECRET_KEY',
  'GRAFANA_ADMIN_PASSWORD',
  'PULUMI_CONFIG_PASSPHRASE',
];
let text = readFileSync(process.argv[2], 'utf8');
for (const name of names) {
  const value = process.env[name] ?? '';
  if (value.length < 8) continue;
  text = text.split(value).join('***');
  const encoded = Buffer.from(value).toString('base64');
  if (encoded.length >= 8) text = text.split(encoded).join('***');
}
writeFileSync(process.argv[3], text);
