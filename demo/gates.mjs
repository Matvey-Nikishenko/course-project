import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...opts });
  return result.status === null ? 1 : result.status;
}

function dropFirstPath(yaml) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((line) => /^  \//.test(line));
  if (start < 0) throw new Error('openapi spec has no path');
  let end = start + 1;
  while (end < lines.length && !/^  \//.test(lines[end]) && !/^[^ \t]/.test(lines[end])) end += 1;
  lines.splice(start, end - start);
  return lines.join('\n');
}

const results = {};

const tsc = join(process.cwd(), 'node_modules', '.bin', 'tsc');
results['types-ok'] = run(tsc, ['--noEmit']);
const typeDir = mkdtempSync(join(tmpdir(), 'hw32-types-'));
writeFileSync(join(typeDir, 'broken.ts'), 'export const broken: number = "not-a-number";\n');
results['types-broken'] = run(
  tsc,
  ['--strict', '--noEmit', '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node', 'broken.ts'],
  { cwd: typeDir },
);
rmSync(typeDir, { recursive: true, force: true });

const oasdiff = spawnSync('bash', ['scripts/ensure-oasdiff.sh'], { encoding: 'utf8' });
if (oasdiff.status !== 0) {
  console.error(oasdiff.stderr);
  process.exit(oasdiff.status ?? 1);
}
const oasdiffBin = oasdiff.stdout.trim();
const spec = 'openapi/openapi.yaml';
results['contract-ok'] = run(oasdiffBin, ['breaking', '--fail-on', 'ERR', spec, spec]);
const contractDir = mkdtempSync(join(tmpdir(), 'hw32-contract-'));
const brokenSpec = join(contractDir, 'broken.yaml');
writeFileSync(brokenSpec, dropFirstPath(readFileSync(spec, 'utf8')));
results['contract-broken'] = run(oasdiffBin, ['breaking', '--fail-on', 'ERR', spec, brokenSpec]);
rmSync(contractDir, { recursive: true, force: true });

results['architecture-ok'] = run('npx', ['depcruise', '--config', '.dependency-cruiser.cjs', 'src']);
results['architecture-broken'] = run('npx', ['depcruise', '--config', '.dependency-cruiser.cjs', 'fixtures/gates']);

let image = 'marketplace-api:hw28';
if (spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status !== 0) {
  image = 'gcr.io/distroless/nodejs22-debian12:nonroot';
}
const scan = (max) =>
  run('node', ['scripts/scan.mjs'], { env: { ...process.env, IMAGE: image, SCAN_MAX: max } });
results['scan-ok'] = scan('99999');
results['scan-broken'] = scan('-1');

let bad = 0;
for (const [key, code] of Object.entries(results)) {
  console.log(`${key}=${code}`);
  if (key.endsWith('-ok') && code !== 0) bad += 1;
  if (key.endsWith('-broken') && code === 0) bad += 1;
}
if (bad > 0) process.exit(1);
