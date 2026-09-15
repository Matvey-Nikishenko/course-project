# Оптимізація запитів дата-шару

Стенд: PostgreSQL 16.14 (`postgres:16-alpine`), aarch64, контейнер із
`docker-compose.yml`. Обсяг після `db/seed.sql`: `users` 50 000,
`products` 120 000, `orders` 120 000, `order_items` 240 000.

Порядок зняття чисел — той самий, що в README: чистий volume → `schema.sql` →
`seed.sql` → EXPLAIN «до» → `indexes.sql` → `ANALYZE` → EXPLAIN «після».
`random()` у seed немає, розподіли детерміновані, тому числа відтворюються.

Зведення:

| Запит | Було | Стало | Приріст | Buffers |
| --- | --- | --- | --- | --- |
| q1 — замовлення покупця за період | 13.699 ms | 0.916 ms | ×15 | 1013 → 19 |
| q2 — черга необроблених | 7.654 ms | 0.314 ms | ×24 | 1013 → 52 |
| q3 — вхід за email без регістру | 18.116 ms | 0.137 ms | ×132 | 468 → 4 |
| q4 — пошук по каталогу | 24.093 ms | 2.013 ms | ×12 | 10916 → 232 |

---

## q1 — замовлення покупця за період

```sql
SELECT id, status, total, created_at
FROM orders
WHERE buyer_id = 5500
  AND created_at >= '2025-06-01'::timestamptz
  AND created_at < '2026-06-01'::timestamptz
ORDER BY created_at DESC
LIMIT 20
```

### До

```
 Limit  (cost=3110.08..3110.09 rows=6 width=27) (actual time=13.647..13.649 rows=10 loops=1)
   Buffers: shared hit=1013
   ->  Sort  (cost=3110.08..3110.09 rows=6 width=27) (actual time=13.645..13.647 rows=10 loops=1)
         Sort Key: created_at DESC
         Sort Method: quicksort  Memory: 25kB
         Buffers: shared hit=1013
         ->  Seq Scan on orders  (cost=0.00..3110.00 rows=6 width=27) (actual time=0.153..13.613 rows=10 loops=1)
               Filter: ((created_at >= '2025-06-01 00:00:00+00'::timestamp with time zone) AND (created_at < '2026-06-01 00:00:00+00'::timestamp with time zone) AND (buyer_id = 5500))
               Rows Removed by Filter: 119990
               Buffers: shared hit=1010
 Planning:
   Buffers: shared hit=97
 Planning Time: 0.493 ms
 Execution Time: 13.699 ms
```

### Після

```
 Limit  (cost=27.29..27.30 rows=6 width=27) (actual time=0.596..0.601 rows=10 loops=1)
   Buffers: shared hit=16 read=3
   ->  Sort  (cost=27.29..27.30 rows=6 width=27) (actual time=0.593..0.595 rows=10 loops=1)
         Sort Key: created_at DESC
         Sort Method: quicksort  Memory: 25kB
         Buffers: shared hit=16 read=3
         ->  Bitmap Heap Scan on orders  (cost=4.49..27.21 rows=6 width=27) (actual time=0.186..0.518 rows=10 loops=1)
               Recheck Cond: ((buyer_id = 5500) AND (created_at >= '2025-06-01 00:00:00+00'::timestamp with time zone) AND (created_at < '2026-06-01 00:00:00+00'::timestamp with time zone))
               Heap Blocks: exact=10
               Buffers: shared hit=13 read=3
               ->  Bitmap Index Scan on idx_orders_buyer_created  (cost=0.00..4.49 rows=6 width=0) (actual time=0.131..0.132 rows=10 loops=1)
                     Index Cond: ((buyer_id = 5500) AND (created_at >= '2025-06-01 00:00:00+00'::timestamp with time zone) AND (created_at < '2026-06-01 00:00:00+00'::timestamp with time zone))
                     Buffers: shared hit=3 read=3
 Planning:
   Buffers: shared hit=133 read=2
 Planning Time: 4.217 ms
 Execution Time: 0.916 ms
```

У план став `Bitmap Index Scan on idx_orders_buyer_created`: замість `Seq Scan`,
який читав усі 1010 сторінок таблиці й викидав фільтром 119 990 рядків із
120 000, індекс віддає одразу 10 потрібних `ctid`, і `Bitmap Heap Scan` торкається
лише 10 сторінок купи — тому 1013 буферів перетворились на 19.

---

## q2 — черга необроблених замовлень

```sql
SELECT id, buyer_id, total, created_at
FROM orders
WHERE status = 'new'
ORDER BY created_at
LIMIT 50
```

### До

```
 Limit  (cost=2591.32..2591.45 rows=50 width=30) (actual time=7.613..7.621 rows=50 loops=1)
   Buffers: shared hit=1013
   ->  Sort  (cost=2591.32..2597.44 rows=2448 width=30) (actual time=7.612..7.615 rows=50 loops=1)
         Sort Key: created_at
         Sort Method: top-N heapsort  Memory: 30kB
         Buffers: shared hit=1013
         ->  Seq Scan on orders  (cost=0.00..2510.00 rows=2448 width=30) (actual time=0.015..7.254 rows=2400 loops=1)
               Filter: (status = 'new'::text)
               Rows Removed by Filter: 117600
               Buffers: shared hit=1010
 Planning:
   Buffers: shared hit=92
 Planning Time: 0.331 ms
 Execution Time: 7.654 ms
```

### Після

```
 Limit  (cost=0.28..89.33 rows=50 width=30) (actual time=0.074..0.283 rows=50 loops=1)
   Buffers: shared hit=50 read=2
   ->  Index Scan using idx_orders_pending_created on orders  (cost=0.28..4110.76 rows=2308 width=30) (actual time=0.073..0.276 rows=50 loops=1)
         Buffers: shared hit=50 read=2
 Planning:
   Buffers: shared hit=124
 Planning Time: 0.652 ms
 Execution Time: 0.314 ms
```

У план став `Index Scan using idx_orders_pending_created` — частковий індекс,
який містить лише 2% рядків зі `status = 'new'` і зберігає їх уже впорядкованими
за `created_at`. Зникли одразу два вузли: `Seq Scan` і `Sort` над ним, бо читання
індексу дає потрібний порядок, і `LIMIT 50` обриває його після 50 рядків замість
сортування всіх 2 400. Індекс займає 72 kB проти 3 720 kB у повного за той самий
запит.

---

## q3 — вхід за email без урахування регістру

```sql
SELECT id, email, role, created_at
FROM users
WHERE lower(email) = lower('Buyer41999@Example.com')
```

### До

```
 Seq Scan on users  (cost=0.00..1218.00 rows=250 width=44) (actual time=17.017..18.081 rows=1 loops=1)
   Filter: (lower(email) = 'buyer41999@example.com'::text)
   Rows Removed by Filter: 49999
   Buffers: shared hit=175 read=293
 Planning:
   Buffers: shared hit=85 read=2
 Planning Time: 0.428 ms
 Execution Time: 18.116 ms
```

### Після

```
 Index Scan using idx_users_email_lower on users  (cost=0.41..8.43 rows=1 width=44) (actual time=0.098..0.098 rows=1 loops=1)
   Index Cond: (lower(email) = 'buyer41999@example.com'::text)
   Buffers: shared hit=1 read=3
 Planning:
   Buffers: shared hit=106 read=1
 Planning Time: 0.620 ms
 Execution Time: 0.137 ms
```

У план став `Index Scan using idx_users_email_lower`. Тут показова деталь: на
таблиці вже був `UNIQUE`-індекс по `email`, і він не допомагав — планер не знає,
що `lower()` робить із порядком, тому не може шукати по ньому. Індекс мусить
зберігати рівно той вираз, який стоїть у `WHERE`. Після цього `Seq Scan`, який
прочитав 468 сторінок і відкинув 49 999 рядків, замінився на 4 буфери: три
сторінки індексу і одна сторінка купи.

---

## q4 — пошук по каталогу (повнотекстовий)

```sql
SELECT id, name, ts_rank(search_vector, plainto_tsquery('simple', 'шкіряні кросівки')) AS rank
FROM products
WHERE search_vector @@ plainto_tsquery('simple', 'шкіряні кросівки')
ORDER BY rank DESC, id
LIMIT 20
```

Запит знаходить 1 200 товарів — рівно 1.00% каталогу, тобто селективність у
«одиницях відсотків», за якої планеру вигідно йти в індекс. Числа «після» зняті
з третього прогону: перший після `CREATE INDEX` іде по холодному GIN
(2.528 ms → 2.596 ms → 2.013 ms).

### До

```
 Limit  (cost=12411.46..12411.51 rows=20 width=63) (actual time=24.060..24.063 rows=20 loops=1)
   Buffers: shared hit=9964 read=952
   ->  Sort  (cost=12411.46..12411.58 rows=50 width=63) (actual time=24.058..24.060 rows=20 loops=1)
         Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
         Sort Method: top-N heapsort  Memory: 27kB
         Buffers: shared hit=9964 read=952
         ->  Seq Scan on products  (cost=0.00..12410.12 rows=50 width=63) (actual time=0.379..23.811 rows=1200 loops=1)
               Filter: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
               Rows Removed by Filter: 118800
               Buffers: shared hit=9958 read=952
 Planning:
   Buffers: shared hit=96
 Planning Time: 0.484 ms
 Execution Time: 24.093 ms
```

### Після

```
 Limit  (cost=229.72..229.77 rows=20 width=63) (actual time=1.948..1.953 rows=20 loops=1)
   Buffers: shared hit=232
   ->  Sort  (cost=229.72..229.85 rows=52 width=63) (actual time=1.947..1.949 rows=20 loops=1)
         Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
         Sort Method: top-N heapsort  Memory: 27kB
         Buffers: shared hit=232
         ->  Bitmap Heap Scan on products  (cost=30.32..228.33 rows=52 width=63) (actual time=0.271..1.661 rows=1200 loops=1)
               Recheck Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
               Heap Blocks: exact=218
               Buffers: shared hit=226
               ->  Bitmap Index Scan on idx_products_search_vector  (cost=0.00..30.31 rows=52 width=0) (actual time=0.218..0.219 rows=1200 loops=1)
                     Index Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
                     Buffers: shared hit=8
 Planning:
   Buffers: shared hit=121
 Planning Time: 0.652 ms
 Execution Time: 2.013 ms
```

У план став `Bitmap Index Scan on idx_products_search_vector` — GIN, тобто
інвертований список «лексема → рядки». `Seq Scan` тут був особливо дорогий: він
читав усі 10 910 сторінок роздутої tsvector-колонкою таблиці й перевіряв `@@` для
кожного з 120 000 документів. GIN натомість читає 8 сторінок індексу, віддає
1 200 `ctid`, і купа торкається 218 сторінок — 232 буфери проти 10 916. `Sort`
лишився: `ts_rank` не зберігається в індексі, тому ранжувати 1 200 знайдених
рядків усе одно доводиться в пам'яті, але це вже сортування 1 200 рядків, а не
фільтрація 120 000.

B-tree цей запит не закрив би взагалі: не існує порядку документів, за якого всі,
що містять задане слово, лежали б поруч.

---

## Морфологія

`simple` не має словника — він лише розбиває текст на слова й опускає регістр.
Тому пошук працює по точній словоформі, і два відмінки того самого слова — це для
Postgres два різних токени:

```sql
SELECT count(*) FROM products WHERE search_vector @@ plainto_tsquery('simple', 'кросівки');
-- 4800

SELECT count(*) FROM products WHERE search_vector @@ plainto_tsquery('simple', 'кросівок');
-- 0
```

**4800** проти **0** на тій самій базі: у каталозі 4 800 товарів із назвою
«Кросівки …», але покупець, який ввів «кросівок», не знайде жодного.

Причина — не в конфігурації, а в тому, що української серед них немає:
`SELECT count(*) FROM pg_ts_config` дає **29** конфігурацій, і в списку
(`\dF`) є `english`, `german`, `russian`, `simple` — української немає взагалі.
Тобто вибрати «правильну» конфігурацію в цій інсталяції неможливо.

Заміна `simple` на `russian` не є виправленням, а самообманом: російський
Snowball-стемер відріже українські закінчення за чужими правилами й дасть
випадкові збіги на кшталт «сумок» ↔ «сумка» разом із випадковими промахами, а
перевірити, де він угадав, а де ні, буде нічим. Справжні варіанти — окремий
український словник (`ispell`/`hunspell` як `CREATE TEXT SEARCH DICTIONARY`),
`unaccent` + власні синоніми, або зовнішній пошуковий рушій. Тут це свідомо
залишено як задокументоване обмеження: постановка вимагає побачити й назвати
проблему, а не полагодити її.

Це і є відповідь на питання, чому в маркетплейсі не можна «просто додати пошук».

---

## Ціна збереженої tsvector-колонки

Заміряно на тому самому наборі: копія `products` без `search_vector` проти
`products` із нею.

| | `pg_total_relation_size('products')` |
| --- | --- |
| без `search_vector` | 39 MB |
| із `search_vector` | 88 MB |

Тобто генерована колонка роздуває таблицю приблизно у 2.3 раза й додає роботу на
кожному `INSERT`/`UPDATE` назви або опису. Це усвідомлена ціна: без неї немає ні
GIN-індексу, ні того прискорення з q4. Альтернатива — expression-індекс без
збереженої колонки: таблиця не росте, але вираз доводиться повторювати в кожному
запиті слово в слово, інакше індекс не застосується.

Разом індекси займають 15.7 MB:

| Індекс | Розмір | Запит |
| --- | --- | --- |
| `idx_products_search_vector` | 9960 kB | q4 |
| `idx_orders_buyer_created` | 3720 kB | q1 |
| `idx_users_email_lower` | 2008 kB | q3 |
| `idx_orders_pending_created` | 72 kB | q2 |

Мертвих індексів немає — після чотирьох `EXPLAIN (ANALYZE)` у кожного
`idx_scan > 0`.
