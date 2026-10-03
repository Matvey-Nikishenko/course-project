# Marketplace API

Marketplace for sellers who list stocked products and buyers who place orders.
The problem: contention for limited stock and an irreversible debit on checkout.

User stories:

1. As a buyer, I want a paginated product catalog so I do not pull the entire warehouse.
2. As a buyer, I want placing an order not to charge me twice if I retry the click.
3. As a seller, I want two buyers not to purchase the last unit at the same time.
4. As a buyer, I want to learn that an order is paid without refreshing the page.
5. As a seller, I want to attach a product photo so the catalog card is recognizable.

Entities: **User** (`buyer` / `seller`), **Product**, **Order**, **OrderItem**,
**Payment**, **Notification**. HW#9 resources: `/products` and `/orders`.

## Decision log

| Date | Decision | Why |
| --- | --- | --- |
| 2026-09-02 | Domain — Marketplace API | Course default; covers the homework checklist. |
| 2026-09-02 | HW#9 — variant B | Spec is a promise; `express-openapi-validator` checks it at runtime. |
| 2026-09-07 | Idempotency keys expire after 24h | An unbounded in-process map is a leak; an external store with native TTL comes with HW#14. |
| 2026-09-08 | Env validated by one zod schema at startup | A broken variable has to kill the process with a named cause, not surface on the first request in production. |
| 2026-09-08 | DB password in a file, not in `DB_URL` | The environment of a running process is a snapshot taken at exec, so an env variable cannot be rotated without a restart. |
| 2026-09-15 | Money is integer cents in the database | Float cannot hold `0.01`. The HTTP contract, TypeORM columns, `db/schema.sql`, and the migration all use `integer` cents — not `numeric(12,2)`. |
| 2026-09-15 | Keys are `GENERATED ALWAYS AS IDENTITY`, not `serial` | The sequence belongs to the column, an explicit INSERT cannot desynchronise it, and writing the id is not a privilege handed out with the table. |
| 2026-09-15 | Catalog search stays on `simple` FTS config | This Postgres ships 29 configurations and none is Ukrainian, so search matches exact word forms only. Named as a documented limitation in `db/OPTIMIZATIONS.md`; substituting `russian` would guess Ukrainian endings by foreign rules and hide the problem instead of fixing it. |
| 2026-09-28 | Migration grants `app_user`; `schema.sql` matches live types | `app_user` is how the HTTP process connects. GRANT lived only in `db/schema.sql`, so `migrate` left `SET ROLE app_user; SELECT …` denied. The same GRANT is now in `InitSchema`, and `schema.sql` uses integer cents so it is not a second, stale schema. |
| 2026-09-29 | Checkout uses atomic `UPDATE … RETURNING`, not JS read-modify-write | `WHERE stock >= $n` is the oversell check and the row lock. A second statement cannot steal units between read and write because there is no separate read. |
| 2026-10-03 | App reaches Postgres through PgBouncer in transaction mode | A small server pool (8) can cover many API clients (200). Session-scoped features do not survive; named prepares need `max_prepared_statements`. |

## Configuration

The HTTP process reads variables through `src/config/env.schema.ts` and
`ConfigService`. TypeORM CLI (`data-source.ts`) lives outside Nest, so it takes
`DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` from `process.env`.
Those values are not in a new env file — `scripts/with-secrets.sh` injects them
from the HW#11 store, and the grader uses `SKIP_VAULT=1` plus the `export` line
in ## Grading.

`.env.example` is the contract and lives in git. The real `.env` and the
`secrets/` directory do not — they are git-ignored and excluded from the Docker
build context.

### Variables

| Variable | Required | Default | Source | Meaning |
| --- | --- | --- | --- | --- |
| `PORT` | no | `3000` | `.env` | HTTP port of the API. |
| `LOG_LEVEL` | no | `info` | `.env` | `debug` \| `info` \| `warn` \| `error`. |
| `DB_URL` | **yes** | — | **secret storage from HW#11** — `.env` locally, mounted secret in prod; never a new env file | Descriptor of the HW#12 database **through PgBouncer**, e.g. `postgres://app_user@127.0.0.1:6432/marketplace`. Must not contain a password: the schema rejects one. |
| `DATABASE_URL` | **yes** (backup / restore-drill) | — | **HW#11 store** — not in `.env.example` (that file is the Nest contract) | Full URL with password for `scripts/backup.sh` and `scripts/restore-drill.sh`. Dev value is the compose admin user on **:6432**. |
| `DB_PASSWORD_FILE` | no | `secrets/db_password` | **secret storage from HW#11** — file path, the value itself is never in git | File holding the database password, read on every new pool connection. |
| `DB_POOL_MAX` | no | `5` | `.env` | Maximum connections in the pg pool. |
| `DB_HOST` | **yes** (TypeORM CLI) | — | **HW#11 store** | Postgres host for `data-source.ts`. |
| `DB_PORT` | no | `5432` | **HW#11 store** | Port. The app and scripts use **6432** (PgBouncer). Direct Postgres stays on **5433** for admin/rotate. |
| `DB_USER` | **yes** (TypeORM CLI) | — | **HW#11 store** | Role. The grader uses `admin` from compose. |
| `DB_PASSWORD` | no | empty string | **HW#11 store** | Password. No literal in `data-source.ts`. |
| `DB_NAME` | **yes** (TypeORM CLI) | — | **HW#11 store** | Database. Here: `marketplace`. |

`DB_URL`, `DB_PASSWORD_FILE`, and the TypeORM `DB_*` keys come from the HW#11
store; they are not in git. Container dev credentials stay in
`docker-compose.yml` on purpose: a grader on a fresh clone brings the stand up
without the store (`SKIP_VAULT=1` in ## Grading).


### Running it

```bash
npm install
cp .env.example .env      # then edit values if needed
npm run db:up             # Postgres on :5433, PgBouncer on :6432 + seed secrets/db_password
npm start                 # builds, then runs dist/main.js on :3000

curl -s localhost:3000/health          # {"status":"ok","uptime_sec":...}
curl -s localhost:3000/health/db       # runs a query through the pool
```

`npm run start:dev` is the watch mode. `npm run db:down` removes the database
container and its volume.

The container image never carries secrets:

```bash
docker build -t myapp .
docker run --rm -p 3000:3000 \
  -e DB_URL=postgres://app_user@host.docker.internal:6432/marketplace \
  -v "$PWD/secrets/db_password:/run/secrets/db_password:ro" \
  -e DB_PASSWORD_FILE=/run/secrets/db_password \
  myapp
```

### Rotating the database password without a restart

The pool's `password` is a function, so pg calls it on every new connection and
picks up the new value on its own. An idle connection killed by the rotation
makes the pool emit `error`; `DatabaseService` listens for that, which is why
the process survives instead of dying on `Unhandled 'error' event`.

```bash
curl -s "localhost:${PORT:-3000}/health"       # note uptime_sec
bash rotate.sh                                 # or: npm run rotate
curl -s "localhost:${PORT:-3000}/health/db"    # 200, and uptime_sec is larger
```

`rotate.sh` does three things in this order:

1. `ALTER ROLE app_user WITH PASSWORD ...` — the new value becomes the truth in
   Postgres.
2. Writes that value into `secrets/db_password` — new connections use it.
3. `pg_terminate_backend` on the role's existing backends — forces the pool to
   reconnect and prove the new password works.

Between steps 1 and 2 there is a millisecond window where a new connection with
the old password fails. Production secret managers close it with two
alternating users: while `user_a` serves traffic, `user_b` is rotated.

The password itself lives in one place only: `secrets/db_password`.
`db/init.sql` creates `app_user` without a password, and `npm run db:up` pushes
the file's value into the role — generating one on the first run. So after
`npm run db:down` the recreated role is passwordless until `db:up` realigns it
with the file, which is why you run that instead of starting compose by hand.

## HW#12 — data layer: schema, volume, indexes

The main table is **`orders`** (120 000 rows). The table q4 searches is
**`products`** (120 000 rows).

Bring the database up:

```bash
docker compose up -d --wait
```

Connect:

```bash
docker compose exec db psql -U admin -d marketplace
```

Both lines work on a fresh clone with no file edits: stand credentials live in
`docker-compose.yml`, and `db/` is mounted into the container as `/db:ro`, so
`psql -f /db/schema.sql` does not need a host-side psql client.

Full cycle — the same order used to capture numbers in `db/OPTIMIZATIONS.md`:

```bash
docker compose down -v && docker compose up -d --wait

docker compose exec -T db psql -U admin -d marketplace -f /db/schema.sql
docker compose exec -T db psql -U admin -d marketplace -f /db/seed.sql

# EXPLAIN before: every query is a Seq Scan
for q in 1 2 3 4 5 6; do
  docker compose exec -T db psql -U admin -d marketplace \
    -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q$q.sql)"
done

docker compose exec -T db psql -U admin -d marketplace -f /db/indexes.sql
docker compose exec -T db psql -U admin -d marketplace -c "ANALYZE;"

# EXPLAIN after: Seq Scan is gone; the node names an index from db/indexes.sql.
# Run q4 three times: the first pass still hits a cold GIN.
for q in 1 2 3 4 5 6; do
  docker compose exec -T db psql -U admin -d marketplace \
    -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q$q.sql)"
done
```

| File | Contents |
| --- | --- |
| `db/schema.sql` | 4 tables, 4 FOREIGN KEYs, integer cents/`timestamptz`, CHECK, generated `tsvector` column, GRANT `app_user` |
| `db/seed.sql` | 50 000 users, 120 000 products, 120 000 orders, 240 000 order_items + `VACUUM (ANALYZE)` |
| `db/queries/q1..q6.sql` | buyer orders in a period · unpaid queue · case-insensitive email login · catalog search · seller catalog · order lines by product |
| `db/indexes.sql` | 6 indexes: composite, partial, expression, GIN on tsvector, btree on `seller_id` and `product_id` |
| `db/OPTIMIZATIONS.md` | 6 before/after EXPLAIN pairs, plan walkthroughs, Morphology section |

Speedup ranges from ×12 to ×132; details and full plans are in the report.

## HW#13 — TypeORM: entities, migrations, N+1

The running app creates the schema with
`src/migrations/1790008327952-InitSchema.ts` (`synchronize: false`).
`db/schema.sql` is the SQL twin of that schema (integer cents, GRANT `app_user`).
Money in `price` / `total` / `unit_price` is **integer cents**.

### onDelete

| Relation | Strategy | Why |
| --- | --- | --- |
| `order_items.order_id → orders` | **CASCADE** | a cart line has no meaning without its order |
| `products.seller_id → users` | **RESTRICT** | a seller catalog is history; it does not vanish with the account |
| `orders.buyer_id → users` | **RESTRICT** | same for a buyer's orders |
| `order_items.product_id → products` | **RESTRICT** | a sold product cannot be deleted: `unit_price` is a snapshot, not a live pointer |

`Order ↔ Product` is M:N with data on the link (`quantity`, `unit_price`), so it
is an explicit join entity `OrderItem`, not `@ManyToMany`.

### Repository vs QueryBuilder

`find()` / `save()` — when the result is an entity graph: order CRUD with lines,
a seller catalog. QueryBuilder — when the result is **not** an entity: an
aggregate, `GROUP BY`, a report. `npm run report` totals revenue by product
(`SUM(quantity * unit_price)`); `find()` cannot express that.

### N+1 (graph `order → items → product`, 10 orders × 2 lines)

| Strategy | Queries |
| --- | --- |
| naive (query in a loop) | **31** = 1 list + 10 × items + 20 × product |
| `relations` / `leftJoinAndSelect` | **1** |
| `relationLoadStrategy: 'query'` | **5** = 1 + 2 × 2 levels |

31 grows with N; 1 and 5 are constants. Full SQL log: `npm run demo:nplus1`.

### Seed

Idempotent by **natural key**, not a row-count threshold: users by `email`,
products by `(seller, name)`, orders by `(buyer email, created_at)` with frozen
timestamps. Deleting one order and running seed again inserts only that order.
A second run on an intact DB stays at 5 users / 6 products / 10 orders /
20 order_items. Check:

```bash
docker compose exec -T db psql -U admin -d marketplace -c \
  "SELECT 'users' t, count(*) FROM users UNION ALL SELECT 'products', count(*) FROM products UNION ALL SELECT 'orders', count(*) FROM orders UNION ALL SELECT 'order_items', count(*) FROM order_items;"
```

### Commands

```bash
docker compose up -d --wait
npm ci
npx tsc --noEmit
npm run build
npm run migrate
npm run migrate:show
npm run seed
npm run demo:nplus1
npm run report
```

`migrate`, `seed`, `demo:nplus1`, `report`, `demo:race`, `demo:workers`, and
`demo:retry` are wrapped in `scripts/with-secrets.sh`. Locally, from the HW#11
store — no `SKIP_VAULT`. The grader uses the section below.

## HW#14 — concurrency: checkout, SKIP LOCKED, retry

Checkout runs in **one transaction** on one pool client: decrement stock, debit
the buyer, insert the order, enqueue a `receipt` job. Stock is an atomic
`UPDATE … SET stock = stock - $n WHERE stock >= $n RETURNING`. Zero rows means
oversell is refused and the whole transaction rolls back — no orphan orders.
That UPDATE is both the check and the lock, so there is no read-modify-write
window in JS. `SELECT … FOR UPDATE` would also serialize, but it is an extra
round-trip; the assignment's race is decided by stock, and RETURNING answers it
in one statement.

Retry wraps only PostgreSQL `40001` (serialization_failure) and `40P01`
(deadlock_detected). Unique violations, check failures, and `CheckoutRejected`
are not transient — repeating them would duplicate a successful debit or hide a
real bug. The retry replays the **whole** transaction, including the SELECT.
`withSerializationRetry` returns `{ result, retries }` — the demo does not parse
logs to count repeats.

`POST /orders` calls the same `checkout()`. Catalog and order GET/list read
TypeORM so `product_id` in the body is a live row. The HTTP buyer is the seed
account `buyer-kateryna@example.com` until auth lands.

A job that throws during processing increments `jobs.attempts` in a follow-up
statement (the failed tx already rolled back). Workers claim
`processed = 0 AND attempts < 5`, so a poison message is not retried forever.

### Measured runs

| Demo | Result |
| --- | --- |
| `demo:race` | 50 attempts, **10** succeeded, stock **0**, negative rows **0** |
| `demo:workers` | 3 workers, **w1=8 w2=8 w3=8**, processed twice **0**, **424 ms** vs sequential 24 × 40 = **960 ms** |
| `demo:retry` | at least one `40001`, final `balance_cents = start + 2` |

Re-run the three scripts after migrate+seed to refresh the numbers if they drift.

## Data layer ops

The HTTP process and every script that needs a SQL session go through
**PgBouncer** on host port **6432**, not the raw Postgres **5433**. Compose
publishes both: 5433 is left for `rotate.sh` and `psql` when you need a
session that transaction pooling would strip.

`pool_mode = transaction` is the default for a stateless API. A client is
bound to a server connection only for the duration of one transaction, so
`default_pool_size = 8` can serve `max_client_conn = 200` HTTP workers. Session
mode would pin a backend for the whole client lifetime and waste the pool the
moment you scale replicas (HW#28).

Transaction mode drops session state between transactions. Three things it
breaks, all from the lecture:

1. **Named prepared statements** — Postgres stores them on the session; the
   next transaction may land on a different backend. Mitigated here with
   `max_prepared_statements = 200` (PgBouncer ≥ 1.21).
2. **`LISTEN` / `NOTIFY`** — the listener is session-scoped; a pooled
   connection forgets subscriptions when it is returned.
3. **Temporary tables and session `SET`** — `CREATE TEMP TABLE`,
   `SET search_path`, advisory session locks: gone at `COMMIT`/`ROLLBACK`.

Backup and restore stay on the same `DATABASE_URL` the HW#11 wrapper injects
(no new env file). Local destination is `./backups/` (git-ignored), one
custom-format (`pg_dump -Fc`) file per night, name stamped with the date.

```bash
# after compose is up, with DATABASE_URL in the environment
bash scripts/with-secrets.sh dev bash scripts/backup.sh
# → prints backups/marketplace-YYYY-MM-DD.dump

bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
# → restores into a throwaway container, prints MATCH or exits 1
```

`backup.cron` is the nightly line (`0 3 * * *` … `backup.sh`). The restore
drill creates and removes its own empty volume; a second run must also print
`MATCH`. Measured RTO/RPO live in `RESTORE-DRILL.md`.

## Grading

```bash
docker compose up -d --wait
export DB_HOST=127.0.0.1 DB_PORT=6432 DB_USER=admin DB_PASSWORD=admin-bootstrap-only DB_NAME=marketplace
export SKIP_VAULT=1    # grader has no access to the store

npm ci
npx tsc --noEmit
npm run build
npm run migrate
npm run migrate:show
npm run migrate:revert
npm run migrate
npm run seed && npm run seed
npm run demo:nplus1
npm run report
npm run demo:race
npm run demo:workers
npm run demo:retry

export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/marketplace
export SKIP_VAULT=1    # у грейдера немає доступу до сховища
bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

`scripts/backup.sh` and `scripts/restore-drill.sh` read `DATABASE_URL` from
the process environment. Under `SKIP_VAULT=1` the wrapper is a no-op `exec`,
so a bare `bash scripts/backup.sh` after the same `export` is equivalent.

Stand credentials are `admin` / `admin-bootstrap-only` / `marketplace`. The
app and scripts use host port **6432** (PgBouncer). Direct Postgres stays on
**5433** for rotate/admin. Those values are not store secrets: the container
is thrown away with `down -v`.

## HW#9

Variant B.

```bash
npm install
npm start

npx @redocly/cli lint openapi/openapi.yaml

npx @redocly/cli bundle openapi/openapi.yaml -o spec.json
node -e "const s=require('./spec.json'),M=['get','post','put','patch','delete'];\
const ops=Object.entries(s.paths).flatMap(([p,v])=>Object.keys(v).filter(m=>M.includes(m)).map(m=>[p,m]));\
const idem=ops.flatMap(([p,m])=>s.paths[p][m].parameters??[]).find(x=>x.in==='header'&&/idempotency-key/i.test(x.name));\
console.log('operations:',ops.length,'· resources:',new Set(Object.keys(s.paths).map(p=>p.split('/')[1])).size);\
console.log('Idempotency-Key: required =',idem?.required,'· description chars =',(idem?.description??'').trim().length)"
# expected: operations ≥ 5 · resources ≥ 2 · required = true · description ≥ 40 chars

grep -c 'Idempotency-Key' openapi/openapi.yaml
grep -c 'next_cursor' openapi/openapi.yaml
grep -c 'application/problem+json' openapi/openapi.yaml
```
