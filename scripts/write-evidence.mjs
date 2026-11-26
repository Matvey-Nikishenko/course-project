import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.EVIDENCE_DIR ?? '.';
const out = process.env.EVIDENCE_OUT ?? 'evidence.txt';

function read(name) {
  try {
    return readFileSync(join(dir, name), 'utf8');
  } catch {
    return '';
  }
}

function pick(text, key) {
  const line = text.split('\n').find((item) => item.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : '';
}

const digest = read('digest.txt');
const rollout = read('rollout.txt');
const oidc = read('oidc.txt');
const buildLog = read('build.log');
const invocations = buildLog.split('\n').filter((line) => line.trim().length > 0).length;

let deployed = '';
try {
  const deployment = JSON.parse(read('deployment.json'));
  const image = deployment.spec.template.spec.containers[0].image ?? '';
  const match = String(image).match(/sha256:[0-9a-f]{64}/);
  deployed = match ? match[0] : '';
} catch {
  deployed = '';
}

const scanExit = read('scan-exit.txt').trim();
const secretLine = pick(read('secret-in-manifest.txt'), 'secret-in-manifest');

const lines = [
  `run-id=${process.env.RUN_ID ?? ''}`,
  `head-sha=${process.env.HEAD_SHA ?? ''}`,
  `image-ref=${pick(digest, 'image-ref')}`,
  `built-digest=${pick(digest, 'built-digest')}`,
  `deployed-digest=${deployed}`,
  `build-invocations=${invocations}`,
  'creds-source=oidc',
  `oidc-iss=${pick(oidc, 'iss')}`,
  `oidc-aud=${pick(oidc, 'aud')}`,
  `oidc-sub=${pick(oidc, 'sub')}`,
  `oidc-sig-verified=${pick(oidc, 'sig-verified')}`,
  `rollout-requests=${pick(rollout, 'requests')}`,
  `rollout-ok=${pick(rollout, 'ok')}`,
  `rollout-failed=${pick(rollout, 'failed')}`,
  `rollout-seconds=${pick(rollout, 'rollout-seconds')}`,
  `secret-in-manifest=${secretLine}`,
  `gate-scan-exit=${scanExit}`,
];
writeFileSync(out, `${lines.join('\n')}\n`);
