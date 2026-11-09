const REQUIRED = ['JWT_KID', 'JWT_PRIVATE_KEY', 'JWT_PUBLIC_KEY', 'REFRESH_TOKEN_PEPPER'] as const;

/**
 * Runs before the Nest graph is imported. A missing signing key has to name
 * itself here. Reaching the database first would hide that name behind a
 * connection error.
 */
export function assertAuthSecrets(env: NodeJS.ProcessEnv): void {
  const missing = REQUIRED.filter((key) => !env[key] || env[key]!.trim() === '');
  if (missing.length === 0) return;
  console.error(`Missing required secret: ${missing.join(', ')}`);
  process.exit(1);
}
