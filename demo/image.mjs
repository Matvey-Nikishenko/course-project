import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const image = process.env.IMAGE || 'marketplace-api:hw28';
const token = readFileSync('.npm_token', 'utf8').trim();

function run(command) {
  return execSync(command, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function occurrences(haystack) {
  if (!token) return 0;
  let count = 0;
  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(token, from);
    if (at === -1) break;
    count += 1;
    from = at + token.length;
  }
  return count;
}

const dockerfile = readFileSync('docker/Dockerfile', 'utf8');
const stages = dockerfile.split('\n').filter((line) => /^FROM\s+/i.test(line.trim())).length;

let shellInside = 1;
try {
  execSync(`docker run --rm --entrypoint sh ${image} -c true`, { stdio: 'ignore' });
} catch {
  shellInside = 0;
}

const user = run(`docker image inspect --format '{{.Config.User}}' ${image}`).trim();
const runtimeUid = /^\d+$/.test(user) ? Number(user) : 0;

const history = run(`docker history --no-trunc ${image}`);
const config = run(`docker image inspect ${image}`);

const dir = mkdtempSync(join(tmpdir(), 'hw28-image-'));
let layerHits = 0;
try {
  execSync(`docker save ${image} -o ${join(dir, 'image.tar')}`, { stdio: 'ignore' });
  execSync(`tar -xf ${join(dir, 'image.tar')} -C ${dir}`);
  const needle = join(dir, 'needle.txt');
  writeFileSync(needle, token);
  const unpacked = join(dir, 'unpacked');
  execSync(`mkdir -p ${unpacked}`);
  const layers = run(`find ${dir} -name layer.tar -o -name '*.tar'`).split('\n').filter((line) => line && !line.endsWith('/image.tar'));
  for (const layer of layers) {
    const dest = join(unpacked, String(layerHits));
    execSync(`mkdir -p ${dest} && tar -xf ${layer} -C ${dest}`, { stdio: 'ignore' });
  }
  const grep = execSync(`grep -a -R -F -o -f ${needle} ${unpacked} || true`, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  layerHits = grep.split('\n').filter(Boolean).length;
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`stages=${stages}`);
console.log(`shell-inside=${shellInside}`);
console.log(`runtime-uid=${runtimeUid}`);
console.log(`token-in-history=${occurrences(history)}`);
console.log(`token-in-config=${occurrences(config)}`);
console.log(`token-in-layers=${layerHits}`);
