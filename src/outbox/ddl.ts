export const OUTBOX_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS outbox (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      aggregate_type text NOT NULL,
      aggregate_id text NOT NULL,
      type text NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      published_at timestamptz,
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
      ON outbox (created_at, id)
      WHERE published_at IS NULL
  `,
  `
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key text PRIMARY KEY,
      fingerprint text NOT NULL,
      order_id bigint,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS processed_messages (
      message_id text NOT NULL,
      consumer text NOT NULL,
      processed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id, consumer)
    )
  `,
];
