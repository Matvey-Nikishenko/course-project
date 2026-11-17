import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';

function kubectl(args) {
  return execSync(`kubectl -n marketplace ${args}`, { encoding: 'utf8' });
}

function readyPods() {
  const raw = JSON.parse(kubectl('get pods -l app=marketplace-api -o json'));
  return raw.items.filter((pod) =>
    (pod.status?.conditions ?? []).some((item) => item.type === 'Ready' && item.status === 'True'),
  );
}

async function proxyPort() {
  const child = spawn('kubectl', ['proxy', '--port=0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += String(chunk);
      const match = buf.match(/127\.0\.0\.1:(\d+)/);
      if (match) resolve(match[1]);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => reject(new Error(`kubectl proxy exited ${code}: ${buf}`)));
    setTimeout(() => reject(new Error(`kubectl proxy did not listen: ${buf}`)), 8000);
  });
  return { port, child };
}

async function evict(port, name) {
  const res = await fetch(
    `http://127.0.0.1:${port}/api/v1/namespaces/marketplace/pods/${name}/eviction`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apiVersion: 'policy/v1',
        kind: 'Eviction',
        metadata: { name, namespace: 'marketplace' },
      }),
    },
  );
  return res.status;
}

async function main() {
  const healthy = readyPods().length;
  const minAvailable = Number(kubectl('get pdb marketplace-api -o jsonpath={.spec.minAvailable}').trim());
  const names = readyPods().map((pod) => pod.metadata.name);
  if (names.length < 2) throw new Error(`need two ready pods, have ${names.length}`);
  const { port, child } = await proxyPort();
  try {
    const first = await evict(port, names[0]);
    const second = await evict(port, names[1]);
    console.log(`healthy=${healthy}`);
    console.log(`minAvailable=${minAvailable}`);
    console.log(`evict-1=${first}`);
    console.log(`evict-2=${second}`);
    if (first !== 201 || second !== 429) process.exitCode = 1;
  } finally {
    child.kill();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
