import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const region = process.env.AWS_REGION || "eu-central-1";
process.env.AWS_REGION = region;
process.env.AWS_DEFAULT_REGION = region;
process.env.PULUMI_BACKEND_URL ||= `file://${root}/.pulumi-aws`;
process.env.AWS_ENDPOINT_URL ||= "http://127.0.0.1:23166";
process.env.AWS_ACCESS_KEY_ID ||= "test";
process.env.AWS_SECRET_ACCESS_KEY ||= "test";
const endpoint = process.env.AWS_ENDPOINT_URL;

function aws(args) {
  const out = execFileSync(
    "aws",
    ["--endpoint-url", endpoint, "--region", region, "--output", "json", ...args],
    { encoding: "utf8" },
  );
  return JSON.parse(out);
}

const vpcs = aws([
  "ec2",
  "describe-vpcs",
  "--filters",
  "Name=tag:Project,Values=nodejs-pro-hw31",
]).Vpcs;
if (vpcs.length !== 1) {
  throw new Error(`expected one tagged VPC, found ${vpcs.length}`);
}
const vpcId = vpcs[0].VpcId;

const subnets = aws([
  "ec2",
  "describe-subnets",
  "--filters",
  `Name=vpc-id,Values=${vpcId}`,
]).Subnets;
const tables = aws([
  "ec2",
  "describe-route-tables",
  "--filters",
  `Name=vpc-id,Values=${vpcId}`,
]).RouteTables;

function routesOf(subnetId) {
  const table = tables.find((item) =>
    (item.Associations ?? []).some((assoc) => assoc.SubnetId === subnetId),
  );
  return table?.Routes ?? [];
}

function igwDefault(routes) {
  return routes.filter(
    (route) =>
      route.DestinationCidrBlock === "0.0.0.0/0" &&
      String(route.GatewayId ?? "").startsWith("igw-"),
  ).length;
}

const publicSubnets = subnets.filter((subnet) => igwDefault(routesOf(subnet.SubnetId)) > 0);
const privateSubnets = subnets.filter((subnet) => igwDefault(routesOf(subnet.SubnetId)) === 0);
const zones = new Set(subnets.map((subnet) => subnet.AvailabilityZone));
const privateDefault = privateSubnets.reduce(
  (sum, subnet) => sum + igwDefault(routesOf(subnet.SubnetId)),
  0,
);

const groups = aws([
  "ec2",
  "describe-security-groups",
  "--filters",
  `Name=vpc-id,Values=${vpcId}`,
  "Name=tag:Project,Values=nodejs-pro-hw31",
]).SecurityGroups;

let tagged = 0;
try {
  const page = aws([
    "resourcegroupstaggingapi",
    "get-resources",
    "--tag-filters",
    "Key=Project,Values=nodejs-pro-hw31",
  ]);
  tagged = (page.ResourceTagMappingList ?? []).length;
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  throw new Error(`resourcegroupstaggingapi failed: ${message}`);
}

const lines = [
  `vpc-id=${vpcId}`,
  `public-subnets=${publicSubnets.length}`,
  `private-subnets=${privateSubnets.length}`,
  `subnet-azs=${zones.size}`,
  `private-default-route=${privateDefault}`,
  `security-groups=${groups.length}`,
  `tagged-resources=${tagged}`,
];
mkdirSync(resolve(root, "evidence"), { recursive: true });
writeFileSync(resolve(root, "evidence/base.txt"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));

const state = execFileSync(
  "pulumi",
  ["stack", "export", "--stack", "base"],
  {
    cwd: resolve(root, "infra/base"),
    encoding: "utf8",
    env: process.env,
  },
);
writeFileSync(resolve(root, "evidence/base-state.json"), state);
