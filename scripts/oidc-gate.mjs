import { createPublicKey, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { request as httpsRequest } from 'node:https';

function getJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? httpsRequest : request;
    const req = lib(url, { timeout: 15000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          reject(new Error(`status=${status}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function fail(message) {
  console.error(message);
  console.log('iss=');
  console.log('aud=');
  console.log('sub=');
  console.log('sig-verified=0');
  console.log('policy-allow=0');
  process.exit(1);
}

function claim(value) {
  if (Array.isArray(value)) return value.map(String).join(',');
  if (value === undefined || value === null) return '';
  return String(value);
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function glob(pattern, value) {
  const body = pattern.split('*').map(escapeRegex).join('.*');
  return new RegExp(`^${body}$`).test(value);
}

function readToken() {
  if (process.env.OIDC_TOKEN_FILE) {
    return readFileSync(process.env.OIDC_TOKEN_FILE, 'utf8').trim();
  }
  return (process.env.OIDC_TOKEN ?? '').trim();
}

function decode(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature: parts[2] };
  } catch {
    return null;
  }
}

function verifyRs256(decoded, jwks) {
  if (decoded.header.alg !== 'RS256') return false;
  const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
  const kid = decoded.header.kid;
  const chosen = keys.filter((key) => !kid || key.kid === kid);
  const signature = Buffer.from(decoded.signature, 'base64url');
  for (const jwk of chosen.length > 0 ? chosen : keys) {
    try {
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      const ok = createVerify('RSA-SHA256').update(decoded.signingInput).verify(key, signature);
      if (ok) return true;
    } catch {
      // The next key in the set may be the one that signed this token.
    }
  }
  return false;
}

function allows(policy, payload) {
  const patterns = Array.isArray(policy.sub) ? policy.sub : [policy.sub];
  const sub = claim(payload.sub);
  const aud = payload.aud;
  const audOk = Array.isArray(aud) ? aud.map(String).includes(String(policy.aud)) : String(aud) === String(policy.aud);
  const subOk = patterns.some((pattern) => typeof pattern === 'string' && glob(pattern, sub));
  return payload.iss === policy.iss && audOk && subOk;
}

const policyPath = process.env.OIDC_POLICY;
if (!policyPath) fail('OIDC_POLICY is required');

let policy;
try {
  policy = JSON.parse(readFileSync(policyPath, 'utf8'));
} catch {
  fail('policy file is not readable');
}

const token = readToken();
const decoded = token ? decode(token) : null;
if (!decoded) fail('token is not a JWT');

const discovery = `${String(policy.iss).replace(/\/$/, '')}/.well-known/openid-configuration`;
if (!/^https?:\/\//.test(discovery)) fail('issuer is not an http url');

let jwksUri;
try {
  const body = await getJson(discovery);
  jwksUri = body.jwks_uri;
} catch (err) {
  fail(`discovery failed: ${err instanceof Error ? err.message : 'error'}`);
}

if (typeof jwksUri !== 'string' || !/^https?:\/\//.test(jwksUri)) fail('jwks_uri is missing');

let jwks;
try {
  jwks = await getJson(jwksUri);
} catch (err) {
  fail(`jwks fetch failed: ${err instanceof Error ? err.message : 'error'}`);
}

const verified = verifyRs256(decoded, jwks);
const allowed = verified && allows(policy, decoded.payload);

console.log(`iss=${claim(decoded.payload.iss)}`);
console.log(`aud=${claim(decoded.payload.aud)}`);
console.log(`sub=${claim(decoded.payload.sub)}`);
console.log(`sig-verified=${verified ? 1 : 0}`);
console.log(`policy-allow=${allowed ? 1 : 0}`);
if (!allowed) process.exit(1);
