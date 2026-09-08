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
