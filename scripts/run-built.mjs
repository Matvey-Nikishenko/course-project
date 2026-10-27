import { spawnSync } from 'node:child_process';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/run-built.mjs <dist-file.js>');
  process.exit(1);
}

const tsc = spawnSync('npx', ['tsc', '-p', 'tsconfig.json', '--pretty', 'false'], {
  stdio: 'inherit',
});
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

const run = spawnSync(process.execPath, [`dist/${file}`, ...process.argv.slice(3)], {
  stdio: 'inherit',
});
process.exit(run.status ?? 1);
