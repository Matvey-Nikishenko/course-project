import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createPrivateKey, createPublicKey, KeyObject } from 'node:crypto';
import jwt from 'jsonwebtoken';

export const JWT_ISSUER = 'marketplace-api';
export const JWT_AUDIENCE = 'marketplace';
export const ACCESS_TTL_SECONDS = 10 * 60;
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

/** RFC 8725 §3.1: verification names the algorithms it accepts. */
const ALLOWED_ALGORITHMS = ['ES256'] as const;

export type AccessClaims = {
  id: string;
  role: string;
  jti: string;
  familyId: string;
  exp: number;
};

export type SigningKeys = {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
};

export function loadSigningKeys(env: NodeJS.ProcessEnv): SigningKeys {
  const kid = env.JWT_KID ?? '';
  const privatePem = Buffer.from(env.JWT_PRIVATE_KEY ?? '', 'base64').toString('utf8');
  const publicPem = Buffer.from(env.JWT_PUBLIC_KEY ?? '', 'base64').toString('utf8');
  return {
    kid,
    privateKey: createPrivateKey(privatePem),
    publicKey: createPublicKey(publicPem),
  };
}

/** SHA-256 of the SPKI PEM. Dev and prod keys fingerprint differently. */
export function publicKeyFingerprint(publicKey: KeyObject): string {
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return createHash('sha256').update(pem).digest('hex');
}

export function hashRefreshToken(pepper: string, token: string): string {
  return createHmac('sha256', pepper).update(token).digest('hex');
}

export function signAccess(
  keys: SigningKeys,
  input: { userId: string; role: string; familyId: string; jti?: string },
): { token: string; jti: string } {
  const jti = input.jti ?? randomUUID();
  const token = jwt.sign(
    { role: input.role, family_id: input.familyId },
    keys.privateKey,
    {
      algorithm: 'ES256',
      expiresIn: ACCESS_TTL_SECONDS,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      subject: input.userId,
      jwtid: jti,
      keyid: keys.kid,
    },
  );
  return { token, jti };
}

export function verifyAccess(keys: SigningKeys, token: string): AccessClaims {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded.payload === 'string') {
    throw new Error('malformed access token');
  }
  if (decoded.header.kid !== keys.kid) {
    throw new Error('unknown signing key');
  }
  const payload = jwt.verify(token, keys.publicKey, {
    algorithms: [...ALLOWED_ALGORITHMS],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
  if (typeof payload === 'string') throw new Error('malformed access token');
  const familyId = payload.family_id;
  if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') {
    throw new Error('malformed access token');
  }
  if (typeof payload.jti !== 'string' || typeof familyId !== 'string' || typeof payload.exp !== 'number') {
    throw new Error('malformed access token');
  }
  return { id: payload.sub, role: payload.role, jti: payload.jti, familyId, exp: payload.exp };
}
