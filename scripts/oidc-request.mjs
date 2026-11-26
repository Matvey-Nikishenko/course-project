import { writeFileSync } from 'node:fs';

const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL ?? '';
const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN ?? '';
const audience = process.env.OIDC_AUDIENCE ?? '';
const out = process.env.OIDC_TOKEN_FILE ?? '';

if (!requestUrl || !requestToken || !audience || !out) {
  console.error('oidc request is missing an input');
  process.exit(1);
}

const joiner = requestUrl.includes('?') ? '&' : '?';
const response = await fetch(`${requestUrl}${joiner}audience=${encodeURIComponent(audience)}`, {
  headers: { Authorization: `bearer ${requestToken}` },
});
if (!response.ok) {
  console.error(`oidc request status=${response.status}`);
  process.exit(1);
}

const body = await response.json();
if (typeof body.value !== 'string' || body.value.split('.').length !== 3) {
  console.error('oidc request returned no token');
  process.exit(1);
}

writeFileSync(out, body.value, { mode: 0o600 });
