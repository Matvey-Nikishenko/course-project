-- The minimum set that cures q1..q6. Nothing here is speculative: every index
-- below is the one node that replaced a Seq Scan in db/OPTIMIZATIONS.md, and an
-- index no query reaches for is pure cost — disk plus a slower INSERT.

-- q1: "my orders for a period". Composite, buyer first because it is the
-- equality; created_at second and descending so the ORDER BY ... DESC LIMIT
-- reads the index in its stored order and stops after 20 rows.
CREATE INDEX idx_orders_buyer_created
  ON orders (buyer_id, created_at DESC);

-- q2: the processing queue. Partial, because 'new' is 2% of the table — the
-- index holds those 2% only, so it stays small enough to keep in cache, and a
-- full index on status would spend 98% of its pages on rows this query never
-- wants.
CREATE INDEX idx_orders_pending_created
  ON orders (created_at)
  WHERE status = 'new';

-- q3: login by email, case-insensitive. Expression index: the UNIQUE index on
-- email cannot serve lower(email), because the planner has no way to know what
-- lower() does to the ordering. The index has to store the same expression the
-- WHERE clause computes.
CREATE INDEX idx_users_email_lower
  ON users (lower(email));

-- q4: catalog search. GIN over the generated tsvector column — an inverted
-- index from lexeme to rows, which is what @@ needs. A B-tree cannot answer it
-- at all: there is no ordering of documents that puts everything containing a
-- given word next to each other.
CREATE INDEX idx_products_search_vector
  ON products USING GIN (search_vector);

-- q5: one seller's catalog. The FOREIGN KEY on products.seller_id has no
-- index of its own — Postgres never creates one — so without this the listing
-- is Seq Scan on 120 000 rows.
CREATE INDEX idx_products_seller_id
  ON products (seller_id);

-- q6: "who bought this product". UNIQUE (order_id, product_id) cannot serve
-- a lookup that starts at product_id; btree matching is left-prefix.
CREATE INDEX idx_order_items_product_id
  ON order_items (product_id);
