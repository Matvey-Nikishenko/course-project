export const FILE_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS files (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      owner_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      object_key text NOT NULL UNIQUE,
      status text NOT NULL CHECK (status IN ('pending', 'completed')),
      size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
      content_type text NOT NULL,
      upload_id text,
      idempotency_key text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_files_owner_idempotency
      ON files (owner_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL
  `,
];
