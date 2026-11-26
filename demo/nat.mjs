import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const demoDir = resolve(root, "infra/demo");
const region = process.env.AWS_REGION || "eu-central-1";
process.env.AWS_REGION = region;
process.env.AWS_DEFAULT_REGION = region;
process.env.PULUMI_BACKEND_URL ||= `file://${root}/.pulumi-aws`;
process.env.AWS_ENDPOINT_URL ||= "http://127.0.0.1:23166";
process.env.AWS_ACCESS_KEY_ID ||= "test";
process.env.AWS_SECRET_ACCESS_KEY ||= "test";
process.env.AWS_EC2_METADATA_DISABLED = "true";
const endpoint = process.env.AWS_ENDPOINT_URL;
if (!process.env.PULUMI_CONFIG_PASSPHRASE) {
  console.error("Missing required secret: PULUMI_CONFIG_PASSPHRASE");
  process.exit(1);
}

function pulumi(args) {
  return execFileSync("pulumi", args, {
    cwd: demoDir,
    encoding: "utf8",
    env: process.env,
  });
}

function gateways() {
  const raw = execFileSync(
    "aws",
    [
      "--endpoint-url",
      endpoint,
      "--region",
      region,
      "--output",
      "json",
      "ec2",
      "describe-nat-gateways",
      "--filter",
      "Name=state,Values=available,pending",
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(raw).NatGateways ?? [];
}

const started = Date.now();
pulumi(["config", "set", "hw31:withNat", "true", "--stack", "demo"]);
let created = false;
try {
  pulumi(["up", "--yes", "--non-interactive", "--stack", "demo"]);
  created = gateways().length > 0;
} catch (err) {
  const text = err instanceof Error ? err.message : String(err);
  console.error(text.split("\n").slice(-5).join("\n"));
} finally {
  pulumi(["config", "set", "hw31:withNat", "false", "--stack", "demo"]);
  try {
    pulumi(["up", "--yes", "--non-interactive", "--stack", "demo"]);
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    console.error(text.split("\n").slice(-3).join("\n"));
  }
}

if (!created) {
  console.error("NAT gateway was not created; billed hours were not measured");
  process.exit(0);
}

const minutes = Math.max(1, Math.round((Date.now() - started) / 60000));
// AWS bills a partial NAT hour as a full hour. LocalStack does not invoice this.
const lines = [`nat-minutes=${minutes}`, `nat-billed-hours=${minutes < 60 ? 1 : minutes}`];
mkdirSync(resolve(root, "evidence"), { recursive: true });
appendFileSync(resolve(root, "evidence/demos.txt"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
