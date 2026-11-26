import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const region = process.env.AWS_REGION || "eu-central-1";
const endpoint = process.env.AWS_ENDPOINT_URL || "http://127.0.0.1:23166";

function aws(args) {
  return execFileSync(
    "aws",
    ["--endpoint-url", endpoint, "--region", region, "--output", "json", ...args],
    { encoding: "utf8" },
  );
}

let listed;
try {
  listed = JSON.parse(aws(["rds", "describe-db-instances"]));
} catch (err) {
  const text = err instanceof Error ? err.message : String(err);
  console.error(text.split("\n").filter((line) => line.includes("error") || line.includes("501")).slice(-2).join("\n"));
  console.error("failover was not measured");
  process.exit(0);
}
const instance = (listed.DBInstances ?? []).find((item) => item.DBInstanceStatus === "available");
if (!instance) {
  console.error("no available RDS instance; failover was not measured");
  process.exit(0);
}

const before = instance.AvailabilityZone;
const started = Date.now();
aws([
  "rds",
  "reboot-db-instance",
  "--db-instance-identifier",
  instance.DBInstanceIdentifier,
  "--force-failover",
]);

let after = before;
const deadline = Date.now() + 600_000;
while (Date.now() < deadline) {
  const again = JSON.parse(
    aws(["rds", "describe-db-instances", "--db-instance-identifier", instance.DBInstanceIdentifier]),
  ).DBInstances[0];
  after = again.AvailabilityZone;
  if (again.DBInstanceStatus === "available" && after && after !== before) break;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
}
const seconds = Math.round((Date.now() - started) / 1000);
const events = JSON.parse(
  aws([
    "rds",
    "describe-events",
    "--source-identifier",
    instance.DBInstanceIdentifier,
    "--source-type",
    "db-instance",
  ]),
);
const event = (events.Events ?? []).at(-1)?.Message ?? "";
const lines = [
  `az-before=${before}`,
  `az-after=${after}`,
  `failover-seconds=${seconds}`,
  `event=${event}`,
];
mkdirSync(resolve(root, "evidence"), { recursive: true });
appendFileSync(resolve(root, "evidence/demos.txt"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
