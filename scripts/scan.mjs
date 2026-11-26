import { execSync } from 'node:child_process';

const image = process.env.IMAGE || 'marketplace-api:hw28';
const max = Number(process.env.SCAN_MAX ?? '200');
if (!Number.isFinite(max)) {
  console.error('SCAN_MAX is not an integer');
  process.exit(1);
}

const raw = execSync(
  `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:0.58.1 image --format json --severity CRITICAL,HIGH ${image}`,
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
);
const report = JSON.parse(raw);
const results = Array.isArray(report.Results) ? report.Results : [];
let found = 0;
for (const result of results) {
  if (Array.isArray(result.Vulnerabilities)) found += result.Vulnerabilities.length;
}
const gate = found <= max ? 'pass' : 'fail';
console.log(`image=${image}`);
console.log('severity=CRITICAL+HIGH');
console.log(`found=${found}`);
console.log(`max-allowed=${max}`);
console.log(`gate=${gate}`);
process.exit(gate === 'pass' ? 0 : 1);
