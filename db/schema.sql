-- Marketplace data layer. Applies to an empty database in one run.

CREATE TABLE users (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text        NOT NULL UNIQUE,
  role       text        NOT NULL CHECK (role IN ('buyer', 'seller')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id   bigint      NOT NULL REFERENCES users (id),
  name        text        NOT NULL CHECK (length(name) > 0),
  description text        NOT NULL DEFAULT '',
  price       numeric(12, 2) NOT NULL CHECK (price >= 0),
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
  total      numeric(12, 2) NOT NULL CHECK (total >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id         bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id   bigint  NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id bigint  NOT NULL REFERENCES products (id),
  quantity   integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12, 2) NOT NULL CHECK (unit_price >= 0),

  -- The same product twice in one order is a duplicated line, not two lines.
  UNIQUE (order_id, product_id)
);

-- The application connects as app_user (created by db/init.sql when the
-- container initialises its volume). Guarded so the schema also applies to a
-- Postgres where that role was never created.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
  END IF;
END
$$;
