-- Marketplace data layer. Applies to an empty database in one run.
-- Money is integer cents — same unit as TypeORM entities and the HTTP contract.
-- Live schema in the running app is created by the TypeORM migration; this file
-- is the SQL twin of that schema (including GRANTs for app_user).

CREATE TABLE users (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text        NOT NULL UNIQUE,
  role       text        NOT NULL CHECK (role IN ('buyer', 'seller')),
  balance_cents integer  NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Postgres does not create an index for a FOREIGN KEY. A seller's catalog
  -- listing filters on this column alone, so idx_products_seller_id lives in
  -- db/indexes.sql — without it the planner Seq-scans all 120 000 products.
  seller_id   bigint      NOT NULL REFERENCES users (id),
  name        text        NOT NULL CHECK (length(name) > 0),
  description text        NOT NULL DEFAULT '',
  price       integer     NOT NULL CHECK (price >= 0),
  stock       integer     NOT NULL CHECK (stock >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- Search document, maintained by the database itself. A generated column
  -- cannot drift from name/description the way a trigger-filled column can,
  -- and no INSERT or UPDATE in the API has to remember it exists.
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', name || ' ' || description)
  ) STORED
);

CREATE TABLE orders (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  buyer_id   bigint      NOT NULL REFERENCES users (id),
  status     text        NOT NULL CHECK (status IN ('new', 'paid', 'shipped', 'cancelled')),
  total      integer     NOT NULL CHECK (total >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id         bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id   bigint  NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  -- UNIQUE (order_id, product_id) below leads with order_id, so a lookup by
  -- product_id cannot use it (the right-hand column of a btree is not a start
  -- key). idx_order_items_product_id in db/indexes.sql covers "who bought this".
  product_id bigint  NOT NULL REFERENCES products (id),
  quantity   integer NOT NULL CHECK (quantity > 0),
  unit_price integer NOT NULL CHECK (unit_price >= 0),

  -- The same product twice in one order is a duplicated line, not two lines.
  -- Left-leading on order_id, so "lines of this order" uses this unique index.
  UNIQUE (order_id, product_id)
);

CREATE TABLE jobs (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind       text        NOT NULL,
  payload    jsonb       NOT NULL DEFAULT '{}',
  processed  integer     NOT NULL DEFAULT 0 CHECK (processed >= 0),
  attempts   integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  worker_id  text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_jobs_pending ON jobs (id) WHERE processed = 0 AND attempts < 5;

-- The application connects as app_user (created by db/init.sql when the
-- container initialises its volume). Guarded so the schema also applies to a
-- Postgres where that role was never created. The TypeORM migration carries
-- the same GRANT so migrate (not only psql -f schema.sql) leaves app_user able
-- to SELECT/INSERT.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
  END IF;
END
$$;
