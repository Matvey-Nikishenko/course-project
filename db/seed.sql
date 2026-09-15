-- Realistic volume, deliberately skewed. Run after db/schema.sql.
--
-- Volumes: 50 000 users, 120 000 products, 120 000 orders, 240 000 order items.
-- A thousand-row table teaches nothing about indexes: a sequential scan really
-- is cheaper there, so the planner picks it however many indexes exist.
--
-- Nothing here is uniform, because nothing in a marketplace is: a fifth of the
-- buyers place four fifths of the orders, 'paid' outnumbers 'new' thirty-five
-- to one, and the catalog is dominated by a handful of product families.

-- Sellers first (ids 1..5000), then buyers (ids 5001..50000), so the inserts
-- below can address either group by plain arithmetic.
INSERT INTO users (email, role, created_at)
SELECT
  'seller' || i || '@example.com',
  'seller',
  '2024-06-01'::timestamptz + ((i % 400) || ' days')::interval
FROM generate_series(1, 5000) AS i;

INSERT INTO users (email, role, created_at)
SELECT
  'buyer' || i || '@example.com',
  'buyer',
  '2024-09-01'::timestamptz + ((i % 600) || ' days')::interval
FROM generate_series(1, 45000) AS i;

-- Catalog. The weight column decides how much of the catalog each product
-- family takes, which is what makes q4 selective: 'шкіряні кросівки' is one
-- percent of the rows, while 'кросівки' alone is four.
INSERT INTO products (seller_id, name, description, price, stock, created_at)
SELECT
  (i % 5000) + 1,
  p.noun || ' ' || p.adj || ', модель ' || (1000 + (i % 9000)),
  'Якісні ' || p.noun || ' від перевіреного продавця в категорії ' || p.cat
    || '. Доставка по Україні, гарантія 12 місяців. Артикул ' || i || '.',
  round((199 + (i % 9000) / 3.0)::numeric, 2),
  i % 37,
  '2025-01-01'::timestamptz + ((i % 620) || ' days')::interval
                            + ((i % 86400) || ' seconds')::interval
FROM generate_series(1, 120000) AS i
JOIN (
  VALUES
    (  0, 199, 'Футболка',  'бавовняна',    'одяг'),
    (200, 349, 'Футболка',  'спортивна',    'одяг'),
    (350, 499, 'Сумка',     'текстильна',   'аксесуари'),
    (500, 599, 'Сумка',     'шкіряна',      'аксесуари'),
    (600, 699, 'Ноутбук',   'ігровий',      'електроніка'),
    (700, 779, 'Ноутбук',   'офісний',      'електроніка'),
    (780, 849, 'Куртка',    'зимова',       'одяг'),
    (850, 899, 'Куртка',    'демісезонна',  'одяг'),
    (900, 909, 'Кросівки',  'шкіряні',      'взуття'),
    (910, 939, 'Кросівки',  'текстильні',   'взуття'),
    (940, 969, 'Годинник',  'наручний',     'аксесуари'),
    (970, 999, 'Сумка',     'дорожня',      'аксесуари')
) AS p(lo, hi, noun, adj, cat)
  ON (i % 1000) BETWEEN p.lo AND p.hi;

-- Orders. Buyer ids 5001..14000 are the heavy fifth that carries 80% of the
-- traffic; 14001..50000 order rarely. Statuses are 70/20/8/2, so 'new' is the
-- narrow slice a partial index is built for.
INSERT INTO orders (buyer_id, status, total, created_at)
SELECT
  CASE
    WHEN i % 5 < 4 THEN 5001 + (i * 13) % 9000
    ELSE 14001 + (i * 7) % 36000
  END,
  CASE
    WHEN i % 100 < 70 THEN 'paid'
    WHEN i % 100 < 90 THEN 'shipped'
    WHEN i % 100 < 98 THEN 'cancelled'
    ELSE 'new'
  END,
  round((150 + (i % 12000) / 4.0)::numeric, 2),
  '2025-04-01'::timestamptz + ((i % 550) || ' days')::interval
                            + ((i % 86400) || ' seconds')::interval
FROM generate_series(1, 120000) AS i;

-- Two lines per order, always two different products.
INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT
  o,
  ((o * 7 + k * 54321) % 120000) + 1,
  1 + (o % 3),
  round((199 + ((o * 11) % 9000) / 3.0)::numeric, 2)
FROM generate_series(1, 120000) AS o
CROSS JOIN generate_series(0, 1) AS k;

-- Not plain ANALYZE. ANALYZE gives the planner its statistics, but only VACUUM
-- sets the visibility map, and without that map an Index Only Scan still has to
-- visit the heap (Heap Fetches in the plan) and reads hundreds of times more
-- buffers than it needs to.
VACUUM (ANALYZE);
