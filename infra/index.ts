import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';

const IMAGE = process.env.APP_IMAGE?.trim() || 'marketplace-api:hw28';
const NAMESPACE = 'marketplace';
const APP = 'marketplace-api';

function storeVariables(readme: string): string[] {
  const names: string[] = [];
  for (const line of readme.split('\n')) {
    if (!/^\s*\|/.test(line) || !line.includes('сховищ')) continue;
    const cells = line.split('|').slice(1, -1);
    const hit = cells.findIndex((cell) => cell.includes('сховищ'));
    for (let i = 0; i < cells.length; i += 1) {
      if (i === hit) continue;
      const quoted = cells[i].match(/`([A-Za-z_][A-Za-z0-9_]*)`/);
      if (quoted) {
        names.push(quoted[1]);
        break;
      }
      const bare = cells[i].replace(/[ \t*`]/g, '');
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(bare)) {
        names.push(bare);
        break;
      }
    }
  }
  return [...new Set(names)];
}

const readme = readFileSync(join(__dirname, '..', 'README.md'), 'utf8');
const missing = storeVariables(readme).filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  console.error(`Missing required secret: ${missing.join(', ')}`);
  process.exit(1);
}

const provider = new k8s.Provider('kind', {});

const namespace = new k8s.core.v1.Namespace(
  'marketplace',
  { metadata: { name: NAMESPACE } },
  { provider },
);

function b64(name: string): pulumi.Output<string> {
  return pulumi.secret(Buffer.from(process.env[name] ?? '', 'utf8').toString('base64'));
}

const secret = new k8s.core.v1.Secret(
  'api-secret',
  {
    metadata: { name: APP, namespace: namespace.metadata.name },
    data: {
      APP_DB_PASSWORD: b64('APP_DB_PASSWORD'),
      JWT_KID: b64('JWT_KID'),
      JWT_PRIVATE_KEY: b64('JWT_PRIVATE_KEY'),
      JWT_PUBLIC_KEY: b64('JWT_PUBLIC_KEY'),
      REFRESH_TOKEN_PEPPER: b64('REFRESH_TOKEN_PEPPER'),
    },
  },
  { provider },
);

const secretRef = (key: string): k8s.types.input.core.v1.EnvVar => ({
  name: key,
  valueFrom: { secretKeyRef: { name: secret.metadata.name, key } },
});

const postgresFixed = new k8s.apps.v1.Deployment(
  'postgres-db',
  {
    metadata: { name: 'postgres', namespace: namespace.metadata.name },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: 'postgres' } },
      template: {
        metadata: { labels: { app: 'postgres' } },
        spec: {
          containers: [
            {
              name: 'postgres',
              image: 'postgres:16-alpine',
              ports: [{ containerPort: 5432 }],
              env: [
                { name: 'POSTGRES_USER', value: 'app_user' },
                { name: 'POSTGRES_DB', value: 'marketplace' },
                {
                  name: 'POSTGRES_PASSWORD',
                  valueFrom: { secretKeyRef: { name: secret.metadata.name, key: 'APP_DB_PASSWORD' } },
                },
              ],
              readinessProbe: {
                exec: { command: ['pg_isready', '-U', 'app_user'] },
                periodSeconds: 2,
                timeoutSeconds: 1,
                failureThreshold: 10,
              },
            },
          ],
        },
      },
    },
  },
  { provider, dependsOn: [secret] },
);

const postgresService = new k8s.core.v1.Service(
  'postgres',
  {
    metadata: { name: 'postgres', namespace: namespace.metadata.name },
    spec: {
      selector: { app: 'postgres' },
      ports: [{ port: 5432, targetPort: 5432 }],
    },
  },
  { provider, dependsOn: [postgresFixed] },
);

const httpGet = (path: string): k8s.types.input.core.v1.HTTPGetAction => ({
  path,
  port: 3000,
});

const deployment = new k8s.apps.v1.Deployment(
  'api',
  {
    metadata: { name: APP, namespace: namespace.metadata.name },
    spec: {
      replicas: 2,
      selector: { matchLabels: { app: APP } },
      strategy: {
        type: 'RollingUpdate',
        rollingUpdate: { maxUnavailable: 0, maxSurge: 1 },
      },
      template: {
        metadata: {
          labels: { app: APP },
          annotations: { rev: process.env.APP_REV ?? '1' },
        },
        spec: {
          terminationGracePeriodSeconds: 20,
          securityContext: { runAsNonRoot: true, runAsUser: 65532 },
          containers: [
            {
              name: 'api',
              image: IMAGE,
              imagePullPolicy: 'IfNotPresent',
              ports: [{ containerPort: 3000 }],
              env: [
                { name: 'PORT', value: '3000' },
                { name: 'NODE_ENV', value: 'production' },
                { name: 'WARMUP_MS', value: '4000' },
                { name: 'DRAIN_MS', value: '5000' },
                { name: 'OUTBOX_AUTOSTART', value: '0' },
                { name: 'DB_URL', value: 'postgres://app_user@postgres:5432/marketplace' },
                { name: 'DB_PASSWORD_FILE', value: '/var/run/secrets/db/password' },
                secretRef('APP_DB_PASSWORD'),
                secretRef('JWT_KID'),
                secretRef('JWT_PRIVATE_KEY'),
                secretRef('JWT_PUBLIC_KEY'),
                secretRef('REFRESH_TOKEN_PEPPER'),
              ],
              volumeMounts: [{ name: 'db-password', mountPath: '/var/run/secrets/db', readOnly: true }],
              startupProbe: {
                httpGet: httpGet('/healthz'),
                periodSeconds: 2,
                timeoutSeconds: 1,
                failureThreshold: 30,
              },
              readinessProbe: {
                httpGet: httpGet('/readyz'),
                periodSeconds: 1,
                timeoutSeconds: 1,
                failureThreshold: 2,
              },
              livenessProbe: {
                httpGet: httpGet('/healthz'),
                periodSeconds: 10,
                timeoutSeconds: 1,
                failureThreshold: 3,
              },
              resources: {
                requests: { cpu: '50m', memory: '128Mi' },
                limits: { memory: '384Mi' },
              },
            },
          ],
          volumes: [
            {
              name: 'db-password',
              secret: {
                secretName: secret.metadata.name,
                items: [{ key: 'APP_DB_PASSWORD', path: 'password' }],
              },
            },
          ],
        },
      },
    },
  },
  { provider, dependsOn: [postgresService] },
);

new k8s.core.v1.Service(
  'api',
  {
    metadata: { name: APP, namespace: namespace.metadata.name },
    spec: {
      type: 'NodePort',
      selector: { app: APP },
      ports: [{ port: 3000, targetPort: 3000, nodePort: 30080 }],
    },
  },
  { provider, dependsOn: [deployment] },
);

new k8s.policy.v1.PodDisruptionBudget(
  'api',
  {
    metadata: { name: APP, namespace: namespace.metadata.name },
    spec: {
      minAvailable: 1,
      selector: { matchLabels: { app: APP } },
    },
  },
  { provider, dependsOn: [deployment] },
);

new k8s.autoscaling.v2.HorizontalPodAutoscaler(
  'api',
  {
    metadata: { name: APP, namespace: namespace.metadata.name },
    spec: {
      scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: APP },
      minReplicas: 2,
      maxReplicas: 4,
      metrics: [
        {
          type: 'Resource',
          resource: {
            name: 'cpu',
            target: { type: 'Utilization', averageUtilization: 70 },
          },
        },
      ],
    },
  },
  { provider, dependsOn: [deployment] },
);
