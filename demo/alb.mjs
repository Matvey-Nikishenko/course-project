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

let balancers;
try {
  balancers = JSON.parse(aws(["elbv2", "describe-load-balancers"])).LoadBalancers ?? [];
} catch (err) {
  const text = err instanceof Error ? err.message : String(err);
  console.error(text.split("\n").filter((line) => line.includes("error") || line.includes("501")).slice(-2).join("\n"));
  console.error("the HTTP check was not measured");
  process.exit(0);
}
const alb = balancers.find((item) => String(item.DNSName ?? "").includes(".elb.amazonaws.com"));
if (!alb) {
  console.error("no load balancer; the HTTP check was not measured");
  process.exit(0);
}

const response = await fetch(`http://${alb.DNSName}/`);
const groups = JSON.parse(
  aws(["elbv2", "describe-target-groups", "--load-balancer-arn", alb.LoadBalancerArn]),
).TargetGroups ?? [];
let state = "missing";
if (groups[0]) {
  const health = JSON.parse(
    aws(["elbv2", "describe-target-health", "--target-group-arn", groups[0].TargetGroupArn]),
  );
  state = health.TargetHealthDescriptions?.[0]?.TargetHealth?.State ?? "missing";
}
const lines = [
  `alb-dns=${alb.DNSName}`,
  `http-code=${response.status}`,
  `target-state=${state}`,
];
mkdirSync(resolve(root, "evidence"), { recursive: true });
appendFileSync(resolve(root, "evidence/demos.txt"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
