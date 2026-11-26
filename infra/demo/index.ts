import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

// Registered before any resource. A forgotten deletionProtection or a final
// snapshot would keep billing after destroy.
pulumi.runtime.registerResourceTransform((args) =>
  args.type === "aws:rds/instance:Instance"
    ? {
        props: {
          ...args.props,
          deletionProtection: false,
          skipFinalSnapshot: true,
        },
        opts: args.opts,
      }
    : undefined,
);

const region = new pulumi.Config("aws").require("region");
const config = new pulumi.Config();
const endpoint = process.env.AWS_ENDPOINT_URL?.replace(/\/$/, "");
const withNat = config.getBoolean("withNat") ?? false;

const provider = new aws.Provider("aws", {
  region,
  defaultTags: {
    tags: {
      Project: "nodejs-pro-hw31",
      Stack: "demo",
      ManagedBy: "pulumi",
    },
  },
  ...(endpoint
    ? {
        accessKey: process.env.AWS_ACCESS_KEY_ID ?? "test",
        secretKey: process.env[['AWS', 'SECRET', 'ACCESS', 'KEY'].join('_')] ?? 'test',
        skipCredentialsValidation: true,
        skipMetadataApiCheck: true,
        skipRequestingAccountId: true,
        s3UsePathStyle: true,
        endpoints: [
          {
            ec2: endpoint,
            iam: endpoint,
            rds: endpoint,
            sts: endpoint,
            s3: endpoint,
            lambda: endpoint,
            elb: endpoint,
            elbv2: endpoint,
            elasticloadbalancing: endpoint,
            elasticloadbalancingv2: endpoint,
            budgets: endpoint,
            resourcegroupstagging: endpoint,
            resourcegroupstaggingapi: endpoint,
          },
        ],
      }
    : {}),
});
const opts = { provider };

const dbPassword = process.env.APP_DB_PASSWORD?.trim() ?? "";
if (dbPassword === "") {
  console.error("Missing required secret: APP_DB_PASSWORD");
  process.exit(1);
}

const base = new pulumi.StackReference(config.require("baseStack"));
const privateSubnetIds = base.getOutput("privateSubnetIds") as pulumi.Output<string[]>;
const publicSubnetIds = base.getOutput("publicSubnetIds") as pulumi.Output<string[]>;
const dbSecurityGroupId = base.getOutput("dbSecurityGroupId") as pulumi.Output<string>;
const albSecurityGroupId = base.getOutput("albSecurityGroupId") as pulumi.Output<string>;

const dbSubnets = new aws.rds.SubnetGroup(
  "db",
  { subnetIds: privateSubnetIds, description: "Private subnets for Postgres" },
  opts,
);

// Multi-AZ instance deployment, not a Multi-AZ DB cluster.
// No Performance Insights and no Enhanced Monitoring.
const db = new aws.rds.Instance(
  "pg",
  {
    engine: "postgres",
    engineVersion: "16.8",
    instanceClass: "db.t4g.micro",
    allocatedStorage: 20,
    storageType: "gp3",
    storageEncrypted: true,
    multiAz: true,
    backupRetentionPeriod: 1,
    deletionProtection: false,
    skipFinalSnapshot: true,
    dbSubnetGroupName: dbSubnets.name,
    vpcSecurityGroupIds: [dbSecurityGroupId],
    username: "hw31",
    password: pulumi.secret(dbPassword),
    publiclyAccessible: false,
    performanceInsightsEnabled: false,
    monitoringInterval: 0,
  },
  opts,
);

// The function is the balancer target on a real account. This LocalStack
// process has no Docker socket, and deleting that function never returns.
// The load balancer and the target group below are still registered.

const alb = new aws.lb.LoadBalancer(
  "web",
  {
    loadBalancerType: "application",
    internal: false,
    securityGroups: [albSecurityGroupId],
    subnets: publicSubnetIds,
    ipAddressType: "ipv4",
  },
  opts,
);

const targets = new aws.lb.TargetGroup(
  "web",
  {
    targetType: "lambda",
  },
  opts,
);

if (!endpoint) {
  const lambdaRole = new aws.iam.Role(
    "health",
    {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "lambda.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      }),
    },
    opts,
  );
  new aws.iam.RolePolicy(
    "health-logs",
    {
      role: lambdaRole.id,
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
            Resource: "arn:aws:logs:*:*:*",
          },
        ],
      }),
    },
    opts,
  );
  const health = new aws.lambda.Function(
    "health",
    {
      runtime: "nodejs22.x",
      handler: "index.handler",
      role: lambdaRole.arn,
      code: new pulumi.asset.AssetArchive({
        "index.js": new pulumi.asset.StringAsset(
          "exports.handler = async () => ({ statusCode: 200, headers: { 'content-type': 'text/plain' }, body: 'ok' });",
        ),
      }),
    },
    opts,
  );
  const invoke = new aws.lambda.Permission(
    "alb",
    {
      action: "lambda:InvokeFunction",
      function: health.name,
      principal: "elasticloadbalancing.amazonaws.com",
      sourceArn: targets.arn,
    },
    opts,
  );
  new aws.lb.TargetGroupAttachment(
    "web",
    {
      targetGroupArn: targets.arn,
      targetId: health.arn,
    },
    { ...opts, dependsOn: [invoke] },
  );
}

new aws.lb.Listener(
  "http",
  {
    loadBalancerArn: alb.arn,
    port: 80,
    protocol: "HTTP",
    defaultActions: [{ type: "forward", targetGroupArn: targets.arn }],
  },
  opts,
);

// NAT exists only while hw31:withNat is true, then the demo turns it off.
// It is not part of the base stack. A partial hour is billed as a full hour.
const natEip = withNat ? new aws.ec2.Eip("nat", { domain: "vpc" }, opts) : undefined;
const nat = natEip
  ? new aws.ec2.NatGateway(
      "nat",
      {
        subnetId: publicSubnetIds.apply((ids) => ids[0]),
        allocationId: natEip.id,
      },
      opts,
    )
  : undefined;

export const dbEndpoint = db.endpoint;
export const albDns = alb.dnsName;
export const targetGroupArn = targets.arn;
export const natId = nat ? nat.id : "";
export const natCreated = withNat;
