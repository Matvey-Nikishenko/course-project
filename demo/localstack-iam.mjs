import { execFileSync } from "node:child_process";
import { CreateBucketCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const endpoint = process.env.AWS_ENDPOINT_URL || "http://127.0.0.1:23166";
const region = process.env.AWS_REGION || "eu-central-1";
const bucket = "hw31-iam-lie";

function aws(args, env = process.env) {
  return execFileSync("aws", ["--endpoint-url", endpoint, "--region", region, "--output", "json", ...args], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function statusOf(err, ok) {
  if (ok) return ok.$metadata?.httpStatusCode ?? 0;
  return err?.$metadata?.httpStatusCode ?? 0;
}

async function call(client, command) {
  try {
    const ok = await client.send(command);
    return statusOf(null, ok);
  } catch (err) {
    return statusOf(err, null);
  }
}

function resetUser(name) {
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: "test",
    AWS_SECRET_ACCESS_KEY: "test",
  };
  try {
    const listed = JSON.parse(aws(["iam", "list-access-keys", "--user-name", name], env));
    for (const key of listed.AccessKeyMetadata ?? []) {
      aws(["iam", "delete-access-key", "--user-name", name, "--access-key-id", key.AccessKeyId], env);
    }
  } catch {
    // The user is created below.
  }
  try {
    const policies = JSON.parse(aws(["iam", "list-user-policies", "--user-name", name], env));
    for (const policy of policies.PolicyNames ?? []) {
      aws(["iam", "delete-user-policy", "--user-name", name, "--policy-name", policy], env);
    }
  } catch {
    // No policies yet.
  }
  try {
    aws(["iam", "delete-user", "--user-name", name], env);
  } catch {
    // Already gone.
  }
  aws(["iam", "create-user", "--user-name", name], env);
  const created = JSON.parse(aws(["iam", "create-access-key", "--user-name", name], env));
  return created.AccessKey;
}

const rootEnv = {
  ...process.env,
  AWS_ACCESS_KEY_ID: "test",
  AWS_SECRET_ACCESS_KEY: "test",
  AWS_EC2_METADATA_DISABLED: "true",
};
const noperm = resetUser("hw31-noperm");
const deny = resetUser("hw31-deny");
aws(
  [
    "iam",
    "put-user-policy",
    "--user-name",
    "hw31-deny",
    "--policy-name",
    "deny-all",
    "--policy-document",
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [{ Effect: "Deny", Action: "*", Resource: "*" }],
    }),
  ],
  rootEnv,
);

function client(key, secret) {
  return new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: key, secretAccessKey: secret },
  });
}

const since = new Date(Date.now() - 1000).toISOString();
const plain = client(noperm.AccessKeyId, noperm.SecretAccessKey);
const nopermCreate = await call(
  plain,
  new CreateBucketCommand({
    Bucket: bucket,
    CreateBucketConfiguration: { LocationConstraint: region },
  }),
);
const nopermPut = await call(
  plain,
  new PutObjectCommand({ Bucket: bucket, Key: "note.txt", Body: "hello" }),
);
const denied = client(deny.AccessKeyId, deny.SecretAccessKey);
const denyCreate = await call(
  denied,
  new CreateBucketCommand({
    Bucket: `${bucket}-denied`,
    CreateBucketConfiguration: { LocationConstraint: region },
  }),
);
const denyPut = await call(
  denied,
  new PutObjectCommand({ Bucket: bucket, Key: "denied.txt", Body: "nope" }),
);
const fake = client("TOTALLY_FAKE_KEY_12345", "not-a-real-secret");
const fakeGet = await call(fake, new GetObjectCommand({ Bucket: bucket, Key: "note.txt" }));
plain.destroy();
denied.destroy();
fake.destroy();

let logs = "";
try {
  logs = execFileSync("docker", ["logs", "--since", since, "hw31-localstack"], {
    encoding: "utf8",
  });
} catch (err) {
  logs = `${err?.stdout ?? ""}${err?.stderr ?? ""}`;
}
const denialLines = logs.split("\n").filter((line) =>
  /accessdenied|unauthorizedoperation|not authorized|explicit deny|implicit deny|iam enforcement/i.test(
    line,
  ),
);

const denyAll = denyPut || denyCreate;
const lines = [
  `noperm-create=${nopermCreate}`,
  `noperm-put=${nopermPut}`,
  `deny-all=${denyAll}`,
  `fake-key=${fakeGet}`,
  `enforce-iam-log-lines=${denialLines.length}`,
];
mkdirSync(resolve(root, "evidence"), { recursive: true });
writeFileSync(resolve(root, "evidence/localstack-iam.txt"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
if (denialLines.length > 0) {
  console.log(denialLines.join("\n"));
}
