// Keeps .env.example from drifting away from the schema, in both directions.
// Source of truth is src/config/env.schema.ts, so this script reads the
// compiled schema rather than re-declaring the variable list.
import { readFileSync } from 'node:fs';
import { envSchema } from '../dist/config/env.schema.js';

const EXAMPLE = new URL('../.env.example', import.meta.url);

const schemaKeys = Object.keys(envSchema.shape).sort();
const fileKeys = readFileSync(EXAMPLE, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#') && line.includes('='))
  .map((line) => line.slice(0, line.indexOf('=')).trim())
  .sort();

const missing = schemaKeys.filter((key) => !fileKeys.includes(key));
const extra = fileKeys.filter((key) => !schemaKeys.includes(key));

if (missing.length || extra.length) {
  if (missing.length) console.error(`✗ missing from .env.example: ${missing.join(', ')}`);
  if (extra.length) console.error(`✗ in .env.example but not in the schema: ${extra.join(', ')}`);
  process.exit(1);
}

console.log(`✓ .env.example matches the schema (${schemaKeys.length} variables)`);
