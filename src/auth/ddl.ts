export const AUTH_STATEMENTS = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text`,
  `
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      family_id uuid NOT NULL,
      token_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_hash
      ON refresh_tokens (token_hash)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family
      ON refresh_tokens (family_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS access_denylist (
      jti text PRIMARY KEY,
      expires_at timestamptz NOT NULL
    )
  `,
];
