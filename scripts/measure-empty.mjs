import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const primary = process.env.AWS_REGION || "eu-central-1";
process.env.AWS_REGION = primary;
process.env.AWS_DEFAULT_REGION = primary;
process.env.PULUMI_BACKEND_URL ||= `file://${root}/.pulumi-aws`;
process.env.AWS_ENDPOINT_URL ||= "http://127.0.0.1:23166";
process.env.AWS_ACCESS_KEY_ID ||= "test";
process.env.AWS_SECRET_ACCESS_KEY ||= "test";
const endpoint = process.env.AWS_ENDPOINT_URL;
const regions = [primary, "us-east-1"];

function awsQuery(region, args) {
  try {
    const out = execFileSync(
      "aws",
      ["--endpoint-url", endpoint, "--region", region, "--output", "json", ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return JSON.parse(out);
  } catch (err) {
    const text = `${err?.stderr ?? ""}\n${err?.message ?? err}`;
    if (text.includes("not included")) return { unsupported: true };
    throw err;
  }
}

function asCount(body, listKey) {
  if (body?.unsupported) return null;
  if (typeof body === "number") return body;
  const list = body?.[listKey];
  if (Array.isArray(list)) return list.length;
  throw new Error(`no ${listKey} in ${JSON.stringify(body).slice(0, 180)}`);
}

function stateCount(stackDir, stack) {
  const raw = execFileSync("pulumi", ["stack", "export", "--stack", stack], {
    cwd: stackDir,
    encoding: "utf8",
    env: process.env,
  });
  const body = JSON.parse(raw);
  return (body.deployment?.resources ?? []).filter((item) =>
    String(item.type ?? "").startsWith("aws:"),
  ).length;
}

const stateLeft =
  stateCount(resolve(root, "infra/base"), "base") +
  stateCount(resolve(root, "infra/demo"), "demo");

function count(region, key) {
  if (key === "tagged") {
    return asCount(
      awsQuery(region, [
        "resourcegroupstaggingapi",
        "get-resources",
        "--tag-filters",
        "Key=Project,Values=nodejs-pro-hw31",
      ]),
      "ResourceTagMappingList",
    );
  }
  if (key === "rds") {
    return asCount(awsQuery(region, ["rds", "describe-db-instances"]), "DBInstances");
  }
  if (key === "alb") {
    return asCount(awsQuery(region, ["elbv2", "describe-load-balancers"]), "LoadBalancers");
  }
  if (key === "nat") {
    return asCount(
      awsQuery(region, [
        "ec2",
        "describe-nat-gateways",
        "--filter",
        "Name=state,Values=available",
      ]),
      "NatGateways",
    );
  }
  return asCount(awsQuery(region, ["ec2", "describe-addresses"]), "Addresses");
}

const totals = { tagged: 0, rds: 0, alb: 0, nat: 0, eip: 0 };
const seen = { tagged: false, rds: false, alb: false, nat: false, eip: false };
const lines = [];
for (const region of regions) {
  for (const key of Object.keys(totals)) {
    const value = count(region, key);
    if (value === null) {
      lines.push(`${region} ${key}-api=501`);
      continue;
    }
    totals[key] += value;
    seen[key] = true;
    lines.push(`${region} ${key}=${value}`);
  }
}

lines.push(`state-resources-left=${stateLeft}`);
if (seen.tagged) lines.push(`tagged-resources-left=${totals.tagged}`);
if (seen.rds) lines.push(`rds-left=${totals.rds}`);
if (seen.alb) lines.push(`alb-left=${totals.alb}`);
if (seen.nat) lines.push(`nat-left=${totals.nat}`);
if (seen.eip) lines.push(`eip-left=${totals.eip}`);

mkdirSync(resolve(root, "evidence"), { recursive: true });
appendFileSync(resolve(root, "evidence/demos.txt"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
