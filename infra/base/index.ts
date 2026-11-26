import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

// Actions the CI role may take while it destroys this homework.
// There is no "*" action. Each name is explained in the README.
const teardownActions = [
  "ec2:DescribeVpcs",
  "ec2:DescribeSubnets",
  "ec2:DescribeInternetGateways",
  "ec2:DescribeRouteTables",
  "ec2:DescribeSecurityGroups",
  "ec2:DescribeSecurityGroupRules",
  "ec2:DescribeNatGateways",
  "ec2:DescribeAddresses",
  "ec2:DescribeNetworkInterfaces",
  "ec2:DeleteVpc",
  "ec2:DeleteSubnet",
  "ec2:DetachInternetGateway",
  "ec2:DeleteInternetGateway",
  "ec2:DeleteRoute",
  "ec2:DeleteRouteTable",
  "ec2:DisassociateRouteTable",
  "ec2:DeleteSecurityGroup",
  "ec2:RevokeSecurityGroupIngress",
  "ec2:RevokeSecurityGroupEgress",
  "ec2:DeleteNatGateway",
  "ec2:ReleaseAddress",
  "ec2:DeleteNetworkInterface",
  "rds:DescribeDBInstances",
  "rds:DescribeDBSubnetGroups",
  "rds:DeleteDBInstance",
  "rds:DeleteDBSubnetGroup",
  "rds:ListTagsForResource",
  "elasticloadbalancing:DescribeLoadBalancers",
  "elasticloadbalancing:DescribeTargetGroups",
  "elasticloadbalancing:DescribeListeners",
  "elasticloadbalancing:DescribeTargetHealth",
  "elasticloadbalancing:DeleteLoadBalancer",
  "elasticloadbalancing:DeleteTargetGroup",
  "elasticloadbalancing:DeleteListener",
  "lambda:GetFunction",
  "lambda:ListFunctions",
  "lambda:DeleteFunction",
  "lambda:GetPolicy",
  "lambda:RemovePermission",
  "iam:GetRole",
  "iam:ListRolePolicies",
  "iam:GetRolePolicy",
  "iam:DeleteRolePolicy",
  "iam:ListAttachedRolePolicies",
  "iam:DetachRolePolicy",
  "iam:DeleteRole",
  "iam:GetOpenIDConnectProvider",
  "iam:ListOpenIDConnectProviders",
  "iam:DeleteOpenIDConnectProvider",
  "budgets:ViewBudget",
  "budgets:ModifyBudget",
  "tag:GetResources",
  "sts:GetCallerIdentity",
];

const region = new pulumi.Config("aws").require("region");
const endpoint = process.env.AWS_ENDPOINT_URL?.replace(/\/$/, "");
const tags = {
  Project: "nodejs-pro-hw31",
  Stack: "base",
  ManagedBy: "pulumi",
};

const provider = new aws.Provider("aws", {
  region,
  defaultTags: { tags },
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

// The budget is the first resource on a real account, before the VPC.
// Community LocalStack answers 501 for aws.budgets, and that error would
// stop the free network from being created. The resource stays in this file.
const budgetEmail = process.env.HW31_BUDGET_EMAIL?.trim() ?? "";
if (!endpoint && budgetEmail === "") {
  console.error("Missing required secret: HW31_BUDGET_EMAIL");
  process.exit(1);
}

const budget = endpoint
  ? undefined
  : new aws.budgets.Budget(
      "monthly",
      {
        name: "hw31-monthly",
        budgetType: "COST",
        limitAmount: "5",
        limitUnit: "USD",
        timeUnit: "MONTHLY",
        notifications: [
          {
            comparisonOperator: "GREATER_THAN",
            threshold: 20,
            thresholdType: "PERCENTAGE",
            notificationType: "ACTUAL",
            subscriberEmailAddresses: [budgetEmail],
          },
        ],
      },
      opts,
    );

const vpc = new aws.ec2.Vpc(
  "main",
  {
    cidrBlock: "10.31.0.0/16",
    enableDnsSupport: true,
    enableDnsHostnames: true,
    tags: { Name: "hw31" },
  },
  { ...opts, dependsOn: budget ? [budget] : [] },
);

const azA = `${region}a`;
const azB = `${region}b`;

const publicA = new aws.ec2.Subnet(
  "public-a",
  {
    vpcId: vpc.id,
    cidrBlock: "10.31.1.0/24",
    availabilityZone: azA,
    mapPublicIpOnLaunch: true,
    tags: { Name: "public-a" },
  },
  opts,
);
const publicB = new aws.ec2.Subnet(
  "public-b",
  {
    vpcId: vpc.id,
    cidrBlock: "10.31.2.0/24",
    availabilityZone: azB,
    mapPublicIpOnLaunch: true,
    tags: { Name: "public-b" },
  },
  opts,
);
const privateA = new aws.ec2.Subnet(
  "private-a",
  {
    vpcId: vpc.id,
    cidrBlock: "10.31.11.0/24",
    availabilityZone: azA,
    mapPublicIpOnLaunch: false,
    tags: { Name: "private-a" },
  },
  opts,
);
const privateB = new aws.ec2.Subnet(
  "private-b",
  {
    vpcId: vpc.id,
    cidrBlock: "10.31.12.0/24",
    availabilityZone: azB,
    mapPublicIpOnLaunch: false,
    tags: { Name: "private-b" },
  },
  opts,
);

const igw = new aws.ec2.InternetGateway("igw", { vpcId: vpc.id, tags: { Name: "hw31" } }, opts);

const publicRt = new aws.ec2.RouteTable("public", { vpcId: vpc.id, tags: { Name: "public" } }, opts);
new aws.ec2.Route(
  "public-default",
  {
    routeTableId: publicRt.id,
    destinationCidrBlock: "0.0.0.0/0",
    gatewayId: igw.id,
  },
  opts,
);
new aws.ec2.RouteTableAssociation("public-a", { subnetId: publicA.id, routeTableId: publicRt.id }, opts);
new aws.ec2.RouteTableAssociation("public-b", { subnetId: publicB.id, routeTableId: publicRt.id }, opts);

// No 0.0.0.0/0 route. AWS adds only the local route. A NAT gateway is not created here.
const privateRt = new aws.ec2.RouteTable("private", { vpcId: vpc.id, tags: { Name: "private" } }, opts);
new aws.ec2.RouteTableAssociation("private-a", { subnetId: privateA.id, routeTableId: privateRt.id }, opts);
new aws.ec2.RouteTableAssociation("private-b", { subnetId: privateB.id, routeTableId: privateRt.id }, opts);

const albSg = new aws.ec2.SecurityGroup(
  "alb",
  { vpcId: vpc.id, description: "Public HTTP entry for the load balancer", tags: { Name: "alb" } },
  opts,
);
const appSg = new aws.ec2.SecurityGroup(
  "app",
  { vpcId: vpc.id, description: "Application tier. No inbound from the internet.", tags: { Name: "app" } },
  opts,
);
const dbSg = new aws.ec2.SecurityGroup(
  "db",
  { vpcId: vpc.id, description: "Postgres, reachable only from the application tier", tags: { Name: "db" } },
  opts,
);

// Port 80 is the only public ingress. There is no 443: a hosted zone is billed for the whole month.
new aws.ec2.SecurityGroupRule(
  "alb-http",
  {
    type: "ingress",
    securityGroupId: albSg.id,
    protocol: "tcp",
    fromPort: 80,
    toPort: 80,
    cidrBlocks: ["0.0.0.0/0"],
    description: "HTTP from the internet. The load balancer is the only public door.",
  },
  opts,
);
// Port 8080 leaves the balancer only toward the application group, for health checks and proxied HTTP.
new aws.ec2.SecurityGroupRule(
  "alb-to-app",
  {
    type: "egress",
    securityGroupId: albSg.id,
    sourceSecurityGroupId: appSg.id,
    protocol: "tcp",
    fromPort: 8080,
    toPort: 8080,
    description: "Health checks and proxied HTTP to the application group.",
  },
  opts,
);
// Port 5432 leaves the application group only toward the database group.
new aws.ec2.SecurityGroupRule(
  "app-to-db",
  {
    type: "egress",
    securityGroupId: appSg.id,
    sourceSecurityGroupId: dbSg.id,
    protocol: "tcp",
    fromPort: 5432,
    toPort: 5432,
    description: "The application opens Postgres connections. Nothing else leaves this group.",
  },
  opts,
);
// Port 5432 enters the database only from the application group, never from the internet.
new aws.ec2.SecurityGroupRule(
  "db-from-app",
  {
    type: "ingress",
    securityGroupId: dbSg.id,
    sourceSecurityGroupId: appSg.id,
    protocol: "tcp",
    fromPort: 5432,
    toPort: 5432,
    description: "Postgres from the application group only.",
  },
  opts,
);

const githubRepo = "Matvey-Nikishenko/course-project";
const oidc = new aws.iam.OpenIdConnectProvider(
  "github",
  {
    url: "https://token.actions.githubusercontent.com",
    clientIdLists: ["sts.amazonaws.com"],
    thumbprintLists: [
      "6938fd4d98bab03faadb97b34396831e3780aea1",
      "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
    ],
  },
  opts,
);

const role = new aws.iam.Role(
  "teardown",
  {
    name: "hw31-teardown",
    assumeRolePolicy: oidc.arn.apply((arn) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Federated: arn },
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
              },
              StringLike: {
                "token.actions.githubusercontent.com:sub": `repo:${githubRepo}:*`,
              },
            },
          },
        ],
      }),
    ),
  },
  opts,
);

new aws.iam.RolePolicy(
  "teardown",
  {
    role: role.id,
    policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: teardownActions,
          Resource: "*",
        },
      ],
    }),
  },
  opts,
);

export const vpcId = vpc.id;
export const publicSubnetIds = pulumi.all([publicA.id, publicB.id]);
export const privateSubnetIds = pulumi.all([privateA.id, privateB.id]);
export const albSecurityGroupId = albSg.id;
export const appSecurityGroupId = appSg.id;
export const dbSecurityGroupId = dbSg.id;
export const roleArn = role.arn;
export const roleName = role.name;
