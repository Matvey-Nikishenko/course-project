import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const region = process.env.AWS_REGION || "eu-central-1";
process.env.AWS_REGION = region;
process.env.AWS_DEFAULT_REGION = region;
process.env.AWS_ENDPOINT_URL ||= "http://127.0.0.1:23166";
process.env.AWS_ACCESS_KEY_ID ||= "test";
process.env.AWS_SECRET_ACCESS_KEY ||= "test";
const endpoint = process.env.AWS_ENDPOINT_URL;

function aws(args) {
  return execFileSync(
    "aws",
    ["--endpoint-url", endpoint, "--region", region, "--output", "json", ...args],
    { encoding: "utf8" },
  );
}

function decodePolicy(value) {
  if (typeof value !== "string") return value;
  const text = value.includes("%") ? decodeURIComponent(value) : value;
  return JSON.parse(text);
}

const role = JSON.parse(aws(["iam", "get-role", "--role-name", "hw31-teardown"])).Role;
role.AssumeRolePolicyDocument = decodePolicy(role.AssumeRolePolicyDocument);
const names = JSON.parse(
  aws(["iam", "list-role-policies", "--role-name", "hw31-teardown"]),
).PolicyNames;
if (!Array.isArray(names) || names.length === 0) {
  throw new Error("the teardown role has no inline policy");
}
const attached = names.map((name) => {
  const doc = JSON.parse(
    aws([
      "iam",
      "get-role-policy",
      "--role-name",
      "hw31-teardown",
      "--policy-name",
      name,
    ]),
  );
  doc.PolicyDocument = decodePolicy(doc.PolicyDocument);
  return doc;
});

mkdirSync(resolve(root, "evidence"), { recursive: true });
writeFileSync(
  resolve(root, "evidence/iam.json"),
  `${JSON.stringify({ Role: role, Policies: attached }, null, 2)}\n`,
);

function decision(action) {
  // Without a resource ARN, LocalStack 4.14 raises InternalError and evaluates nothing.
  const body = JSON.parse(
    aws([
      "iam",
      "simulate-principal-policy",
      "--policy-source-arn",
      role.Arn,
      "--action-names",
      action,
      "--resource-arns",
      "*",
    ]),
  );
  const row = body.EvaluationResults?.[0];
  return row?.EvalDecision ?? "missing";
}

const allowed = decision("rds:DeleteDBInstance");
const denied = decision("rds:RebootDBInstance");
const text = `sim-allowed=${allowed}\nsim-denied=${denied}\n`;
writeFileSync(resolve(root, "evidence/iam.txt"), text);
console.log(text.trim());
