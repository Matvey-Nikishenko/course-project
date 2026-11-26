import { readFileSync, writeFileSync } from 'node:fs';

const manifest = readFileSync(process.argv[2], 'utf8');
const names = [
  'APP_DB_PASSWORD',
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'REFRESH_TOKEN_PEPPER',
  'STORAGE_SECRET_KEY',
  'GRAFANA_ADMIN_PASSWORD',
];
let hits = 0;
for (const name of names) {
  const value = process.env[name] ?? '';
  if (value.length < 8) continue;
  hits += manifest.split(value).length - 1;
}
const line = `secret-in-manifest=${hits}`;
if (process.argv[3]) writeFileSync(process.argv[3], `${line}\n`);
console.log(line);
if (hits !== 0) process.exit(1);
