import { z } from 'zod';

// Single source of truth for configuration: both the runtime check and the
// Env type come from this schema. Everything that arrives from the
// environment is a string, hence z.coerce for numbers.
export const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DB_URL: z
    .url({ protocol: /^postgres$/ })
    .refine((raw) => !new URL(raw).password, {
      message: 'must not carry a password — the password comes from DB_PASSWORD_FILE',
    }),

  DB_PASSWORD_FILE: z.string().min(1).default('secrets/db_password'),

  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(5),

  // Optional. Absent, the API does not publish. The value comes from the HW#11
  // store (or the grading export). AMQP has no separate password file here.
  BROKER_URL: z.url({ protocol: /^amqp$/ }).optional(),

  // Optional. Absent, product reads skip the cache. Cache instance only:
  // allkeys-lru. The live value comes from the HW#11 store.
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).optional(),

  // Optional. Absent, there is no session store, shared limit, or BullMQ worker.
  // Queue instance: maxmemory-policy noeviction. Same HW#11 store.
  REDIS_QUEUE_URL: z.url({ protocol: /^rediss?$/ }).optional(),

  // Required. No default: a default would be a signing key baked into the code.
  // PEM bytes, base64-encoded, from the HW#11 store. ES256 PKCS#8.
  JWT_KID: z.string().min(1),
  JWT_PRIVATE_KEY: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().min(1),

  // Required. HMAC pepper for refresh-token hashes. Not a default.
  REFRESH_TOKEN_PEPPER: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function validate(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const lines = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(
    `Invalid configuration:\n${lines}\nCompare your .env with .env.example.`,
  );
}
