import { execSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLoad } from '../scripts/loadgen.mjs';

const file = join(tmpdir(), `hw28-rollout-${process.pid}.txt`);
const url = process.env.ROLL_URL || 'http://127.0.0.1:30080/healthz';
const minRequests = Number(process.env.ROLL_MIN ?? '5000');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function linesOf(path) {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean);
}

async function main() {
  writeFileSync(file, '');
  const load = startLoad(url, file);
  const started = Date.now();
  try {
    const rev = String(Date.now());
    execSync(
      `kubectl -n marketplace patch deployment marketplace-api --type merge -p '${JSON.stringify({
        spec: { template: { metadata: { annotations: { rev } } } },
      })}'`,
      { stdio: 'inherit' },
    );
    execSync('kubectl -n marketplace rollout status deployment/marketplace-api --timeout=180s', {
      stdio: 'inherit',
    });
    const rolloutSeconds = Math.max(1, Math.round((Date.now() - started) / 1000));
    while (linesOf(file).length < minRequests) await sleep(200);
    await load.stop();
    const lines = linesOf(file);
    const requests = lines.length;
    const ok = lines.filter((line) => line === '200').length;
    const failed = requests - ok;
    console.log('profile=1');
    console.log(`requests=${requests}`);
    console.log(`ok=${ok}`);
    console.log(`failed=${failed}`);
    console.log(`rollout-seconds=${rolloutSeconds}`);
    if (failed !== 0 || requests < minRequests) process.exitCode = 1;
  } finally {
    await load.stop().catch(() => undefined);
    rmSync(file, { force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
