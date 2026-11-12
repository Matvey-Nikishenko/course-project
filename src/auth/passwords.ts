import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scryptAsync(password, salt, 32)) as Buffer;
  return `scrypt:${salt.toString('base64url')}:${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [kind, salt, key] = stored.split(':');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const actual = (await scryptAsync(password, Buffer.from(salt, 'base64url'), 32)) as Buffer;
  const expected = Buffer.from(key, 'base64url');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
