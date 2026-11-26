import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const PORT = process.env.DEMO_PORT || '22950';

export function compile() {
  const tsc = spawnSync('npx', ['tsc', '-p', 'tsconfig.json', '--pretty', 'false'], {
    stdio: 'inherit',
  });
  if (tsc.status !== 0) process.exit(tsc.status ?? 1);
}

export async function startApp() {
  compile();
  const lines = [];
  const nonJson = [];
  const child = spawn(process.execPath, ['dist/main.js'], {
    env: {
      ...process.env,
      PORT,
      WARMUP_MS: '0',
      DRAIN_MS: '0',
      OUTBOX_AUTOSTART: '0',
      RATE_LIMIT: '100000',
      OTEL_TRACES_SAMPLER: 'always_on',
      OTEL_LOG_LEVEL: 'none',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        lines.push(JSON.parse(line));
      } catch {
        nonJson.push(line);
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const url = `http://127.0.0.1:${PORT}`;
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`app exited ${child.exitCode}\n${stderr}`);
    }
    try {
      const res = await fetch(`${url}/readyz`);
      if (res.status === 200) return { child, lines, nonJson, url, stderr: () => stderr };
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill('SIGKILL');
  throw new Error(`app did not become ready\n${stderr}`);
}

export async function stopApp(app) {
  if (!app?.child || app.child.exitCode !== null) return;
  app.child.kill('SIGTERM');
  const deadline = Date.now() + 3000;
  while (app.child.exitCode === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (app.child.exitCode === null) app.child.kill('SIGKILL');
}

export function hex(bytes) {
  return randomBytes(bytes).toString('hex');
}

export function traceparent() {
  const traceId = hex(16);
  const spanId = hex(8);
  return { traceId, spanId, header: `00-${traceId}-${spanId}-01` };
}

export async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return predicate();
}

export function report(values, ok) {
  for (const [key, value] of Object.entries(values)) console.log(`${key}=${value}`);
  process.exit(ok ? 0 : 1);
}
