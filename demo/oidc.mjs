import { createServer } from 'node:http';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const policy = JSON.parse(readFileSync('oidc/policy.json', 'utf8'));
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
jwk.kid = 'local-1';
jwk.use = 'sig';
jwk.alg = 'RS256';

let origin = '';
const server = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url?.startsWith('/.well-known/openid-configuration')) {
    res.end(JSON.stringify({ issuer: origin, jwks_uri: `${origin}/jwks` }));
    return;
  }
  if (req.url?.startsWith('/jwks')) {
    res.end(JSON.stringify({ keys: [jwk] }));
    return;
  }
  res.statusCode = 404;
  res.end('{}');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
origin = `http://127.0.0.1:${address.port}`;

const dir = mkdtempSync(join(tmpdir(), 'hw32-oidc-'));
const policyPath = join(dir, 'policy.json');
writeFileSync(policyPath, JSON.stringify({ ...policy, iss: origin }));

function sign(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'local-1' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const input = `${header}.${body}`;
  const signature = createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url');
  return `${input}.${signature}`;
}

const now = Math.floor(Date.now() / 1000);
const greenPayload = {
  iss: origin,
  aud: policy.aud,
  sub: 'repo:Matvey-Nikishenko/course-project:ref:refs/heads/main',
  iat: now,
  exp: now + 600,
};
const green = sign(greenPayload);
const foreign = sign({ ...greenPayload, sub: 'repo:EVIL/attacker:ref:refs/heads/main' });
const broken = `${green.slice(0, -1)}${green.endsWith('a') ? 'b' : 'a'}`;

function runCase(name, token) {
  console.log(`case=${name}`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/oidc-gate.mjs'], {
      env: { ...process.env, OIDC_TOKEN: token, OIDC_POLICY: policyPath },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', () => {
      const kept = [];
      for (const line of stdout.split('\n')) {
        if (/^(iss|aud|sub|sig-verified|policy-allow)=/.test(line)) {
          console.log(line);
          kept.push(line);
        }
      }
      for (const line of stderr.split('\n')) {
        if (line && !line.includes('eyJ')) console.error(line);
      }
      resolve(kept);
    });
  });
}

function field(lines, key) {
  const line = lines.find((item) => item.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1) : '';
}

const greenLines = await runCase('green', green);
const foreignLines = await runCase('foreign-sub', foreign);
const brokenLines = await runCase('bad-signature', broken);
server.close();

const ok =
  field(greenLines, 'sig-verified') === '1' &&
  field(greenLines, 'policy-allow') === '1' &&
  field(foreignLines, 'sig-verified') === '1' &&
  field(foreignLines, 'policy-allow') === '0' &&
  field(brokenLines, 'sig-verified') === '0' &&
  field(brokenLines, 'policy-allow') === '0';
if (!ok) process.exit(1);
