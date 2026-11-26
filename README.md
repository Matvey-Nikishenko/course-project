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
| 2026-10-07 | Integration isolation is TRUNCATE, not ROLLBACK | Nest/TypeORM use a connection pool; a ROLLBACK on one Client would not undo checkout writes. |
| 2026-10-17 | Order-status notifications go out on one in-process bus | WebSocket rooms and SSE both subscribe to `OrderEventsService`. A second API instance cannot see those rooms. |
| 2026-10-22 | `order.placed` is at-least-once plus an idempotent insert | RabbitMQ does not offer exactly-once delivery. The effect is `INSERT … ON CONFLICT (event_id) DO NOTHING`, so a redelivery applies once. |
| 2026-10-27 | Checkout and `order.placed` share one database COMMIT | The broker cannot join that transaction. A relay publishes only after commit, and the consumer dedupes the extra delivery. |
| 2026-11-05 | Two Redis processes: cache is `allkeys-lru`, queue is `noeviction` | `maxmemory-policy` is one setting for the whole process. Sessions and the BullMQ queue sit on the noeviction instance so a cache eviction cannot drop them. |
| 2026-11-09 | Access tokens are ES256 JWTs; refresh tokens are opaque and hashed | OWASP marks RS256 “Not recommended”. Verification passes `algorithms: ['ES256']`. Logout revokes the refresh family and the access `jti` in one Postgres commit. |
| 2026-11-11 | Files go to object storage through a presigned URL | The API decides the key and checks the object with HeadObject. Bytes are uploaded past the API. A new public asset is a new hashed name, so the cache is never invalidated. |

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
| `BROKER_URL` | no | absent, checkout does not publish | **HW#11 store** | AMQP URL, `amqp://user:pass@host:5672`. Port **5672** is AMQP. **15672** is the management UI and does not speak AMQP. |
| `REDIS_URL` | no | absent, product reads skip the cache | **HW#11 store** | Cache Redis. Compose publishes **6379**, `maxmemory` 32mb, `maxmemory-policy allkeys-lru`. |
| `REDIS_QUEUE_URL` | no | absent, no sessions, shared limit, or BullMQ | **HW#11 store** | Queue Redis. Compose publishes **6380**, `maxmemory-policy noeviction`, AOF `everysec`. Sessions and the rate-limit counter live here too. |

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
TypeORM so `product_id` in the body is a live row. The buyer is `buyer_id` in
the request body until auth lands.

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
custom-format (`pg_dump -Fc`) file per run, name stamped with date and time.
The destination keeps the last 7 dumps; a second run the same day does not
overwrite the previous artifact. A `.checksum` sidecar stores
`count(*)|sum(total)` taken at dump time so restore-drill does not compare
against a live database that may have moved on.

```bash
# after compose is up, with DATABASE_URL in the environment
bash scripts/with-secrets.sh dev bash scripts/backup.sh
# → prints backups/marketplace-YYYY-MM-DDTHHMMSS.dump

bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
# → restores into a throwaway container, prints MATCH or exits 1
```

`backup.cron` is the nightly line (`0 3 * * *` … `backup.sh`). The restore
drill creates and removes its own empty volume; a second run must also print
`MATCH`. Measured RTO/RPO live in `RESTORE-DRILL.md`.

## Testing

The ladder from lecture 16, applied to Marketplace: repositories against real
Postgres in testcontainers, then the full Nest app through supertest, then a
Pact contract the OpenAPI spec must satisfy.

Isolation is **TRUNCATE … RESTART IDENTITY CASCADE** between tests, one
container per file. Nest and TypeORM talk through a **pool**, so a
transaction-ROLLBACK on a single `Client` would not undo HTTP/checkout writes
on other connections. A container per test is clean and slow (~1 s each);
TRUNCATE is milliseconds and still leaves a second `npm run test:integration`
green with no manual cleanup. Repositories take a `Queryable` (`Pool` or
`Client`) so ROLLBACK remains an option for a SQL-only suite.

`DATABASE_URL` in tests comes from `container.getConnectionUri()` at runtime —
not from the HW#11 store. The store still feeds a normal `npm start`. Broker
credentials (`PACT_BROKER_URL`, `PACT_BROKER_TOKEN`) **do** come from that
store via `scripts/with-secrets.sh`.

```bash
npm run test:integration    # UsersRepo + ProductsRepo, testcontainers
npm run test:integration && npm run test:integration   # isolation: both green
npm run test:e2e            # POST /orders → GET /orders/:id, plus 404 and 400
npm run test:contract       # consumer → pacts/web-app-marketplace-api.json
```

`pacts/` is git-ignored; `test:contract` recreates the file. Compiled tests
live in `dist-test/` (`tsc -p tsconfig.spec.json`); Jest is `reporters: ['default']`,
`maxWorkers: 1`.

### Pact broker locally

Compose publishes the broker on **21620**. The URL `http://127.0.0.1:21620` is
the compose address, not a secret. The token is never in the repo.

Two ways to verify the provider:

- **Primary (store):** `bash scripts/with-secrets.sh dev npm run verify:provider`
  injects `PACT_BROKER_URL` / `PACT_BROKER_TOKEN` from HW#11. Under
  `SKIP_VAULT=1` the wrapper is `exec`, so this is the same as the next line.
- **Grader / no store:** `PACT_BROKER_URL=http://127.0.0.1:21620 npm run verify:provider`
  — when the variable is set, verification publishes `publishVerificationResult: true`
  to the broker. When it is unset, `verify:provider` uses the local `pacts/*.json`.

CI (`.github/workflows/contract.yml`) publishes the consumer contract as
`github.sha` and runs `can-i-deploy` as a matrix of that consumer SHA against
the provider SHA just verified. It does **not** stamp `prod` first: tagging
the version you then ask about would make `deployable` always true. `to=prod`
is the promotion question — the local drill below, not the pipeline. The job
still fails if verification was not published (`deployable` is not true).

Local gate (both answers: unknown, then true). Do not skip the `prod` tag.
Live `summary` objects from a run on 2026-10-07:

```bash
docker compose up -d --wait
npm run test:contract
curl -s -o /dev/null -w '%{http_code}\n' -X PUT \
  'http://127.0.0.1:21620/pacts/provider/marketplace-api/consumer/web-app/version/1.0.0' \
  -H 'Content-Type: application/json' \
  -d @pacts/web-app-marketplace-api.json
# → 201

# before verify+tag:
curl -s 'http://127.0.0.1:21620/can-i-deploy?pacticipant=web-app&version=1.0.0&to=prod'
# {"deployable":null,"reason":"There is no verified pact between version 1.0.0 of web-app and the latest version of marketplace-api with tag prod (no such version exists)","success":0,"failed":0,"unknown":1}

PACT_BROKER_URL=http://127.0.0.1:21620 npm run verify:provider   # exit 0

curl -s -o /dev/null -w '%{http_code}\n' -X PUT \
  'http://127.0.0.1:21620/pacticipants/marketplace-api/versions/1.0.0/tags/prod' \
  -H 'Content-Type: application/json'
# → 201

curl -s 'http://127.0.0.1:21620/can-i-deploy?pacticipant=web-app&version=1.0.0&to=prod'
# {"deployable":true,"reason":"All required verification results are published and successful","success":1,"failed":0,"unknown":0}
```

## Realtime

A status change is `PATCH /orders/:id` with `{ "status": "new" | "paid" | "shipped" | "cancelled" }`.
The caller is the access token. A missing order is 404, another buyer's order is 403,
and the row is saved only after that check. `OrdersService.updateStatus` then
publishes on `OrderEventsService`.
The gateway and `GET /orders/:id/events` only listen — they do not emit.

WebSocket: the socket identifies itself in `handshake.auth` (`{ userId }`) at
connect time. `join` carries only `{ orderId }`. A `userId` in the join body is
ignored, so a socket opened as one buyer cannot enter another buyer's room by
naming their id. A missing auth, or an order that is not theirs, returns
`{ ok: false }` and does not join. The event name is `order.status`, sent with
`server.to(room)`.

SSE: `GET /orders/:id/events` requires the same owner in the `x-user-id` header.
Without it the response is 401, not a stream. Each event has `id:`,
`event: order.status` and `data:` JSON. `Last-Event-ID: N` is replayed from
`order_status_events` (`event_id > N`), so a process restart does not reset the
numbers. The first bytes of a successful stream are `retry: 1000`.

Socket rooms still live in the process that accepted the connection: a status
change handled by another instance is not delivered to sockets joined elsewhere.
The Redis adapter from lecture 18 step 7 publishes those room emits across the
cluster. The numbered log itself is already in Postgres, so replay does not
depend on which instance the client reconnects to.

```bash
npm run db:up          # Postgres + PgBouncer, password file aligned
npm run migrate && npm run seed
npm start              # HTTP :3000 and the socket.io gateway on the same port

# other terminal — clients in different rooms, then both in order A's room
node scripts/realtime-demo.mjs; echo "exit=$?"
node scripts/realtime-demo.mjs --same-room; echo "exit=$?"

# SSE: owner header is the buyer_id of that order. No header → 401.
BUYER=$(curl -s http://localhost:3000/orders/1 | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(String(JSON.parse(d).buyer_id)))")
curl -sN --max-time 2 -D - -o /dev/null -H "x-user-id: $BUYER" http://localhost:3000/orders/1/events
for s in shipped cancelled paid new; do
  curl -s -X PATCH http://localhost:3000/orders/1 \
    -H 'content-type: application/json' -d "{\"status\":\"$s\"}"
done
curl -sN --max-time 2 -H "x-user-id: $BUYER" -H 'Last-Event-ID: 3' http://localhost:3000/orders/1/events
```

## Trade-offs: WebSocket vs SSE

For order-status notifications I would keep SSE in production. The buyer only
needs a server-to-client stream, `Last-Event-ID` is part of the protocol rather
than something the app invents, and the connection is ordinary HTTP that
proxies already allow. WebSocket earns its place when the client also sends a
continuous stream (chat, a cursor); a join-and-listen notification does not
need a second protocol.

| Criterion | WebSocket | SSE |
| --- | --- | --- |
| Direction | both ways after the upgrade | server to client only |
| Reconnect | socket.io retries on the manager (`reconnect_attempt`) | browser sends `Last-Event-ID`; server replays `id > N` |
| Infrastructure | Upgrade, idle timeouts, often a sticky session | plain HTTP; no upgrade |
| Cost per event | a frame on a dedicated socket | a few bytes on the stream already open |

## Async-події через RabbitMQ

Checkout writes the order, then `OrderPlacedPublisherService` publishes `order.placed`. The body is a contract — `eventId`, `type`, `occurredAt`, `data` — and not an ORM row. `eventId` is `order.placed:<order id>`, so the same placement is the same key on a repeat. The API keeps one confirm channel for the life of the process and waits for `waitForConfirms` on it. A broker error after the order row is committed is logged and does not turn that order into HTTP 500. The publisher does not declare queues or bindings. The consumer, and each demo before it publishes, declares `shop.events`, the quorum queue `orders.placed`, the binding, and the dead-letter exchange.

A confirm means the broker accepted the publish. A routing key with no binding is still confirmed, and the message is dropped. `shop.events` has an alternate exchange, `shop.unroutable`, so that case is kept instead of discarded. The publisher still does not know who is bound.

The consumer calls `channel.prefetch(50)` and consumes with `noAck: false`. Ack runs only after the insert. A database error nacks the message and the API consumer opens the queue again; it does not swallow the failure and leave the queue without a reader. One effect is a single insert, a few milliseconds, so 50 in flight stays well under RabbitMQ's 30-minute `consumer_timeout`. `prefetch=1` would fit a heavy task and would only add a round trip here.

The effect is `INSERT INTO order_placed_effects (event_id, order_id) … ON CONFLICT (event_id) DO NOTHING`. That statement is idempotent. `eventId` is the idempotency key that makes the repeat safe. `qty = qty - 1` would not be. The row is in Postgres, so it survives a consumer restart and is visible to a second process. A `Set` in memory would not.

This is at-least-once delivery, not exactly-once delivery. RabbitMQ redelivers when the ack does not arrive. Exactly-once delivery is not something the broker provides. The second delivery runs the same insert, conflicts, and does not apply the effect again. At-least-once delivery plus that idempotent effect is an exactly-once result.

`demo:duplicate` shows the redelivery with `kill -9` on a child consumer after the insert has committed and before ack. The broker sees the socket drop and returns the message. `channel.close()` is a clean shutdown, so the demo does not use it.

A crash between a separate "already processed" mark and a later business write is still open. Closing it is one database COMMIT, which is HW#22, together with the outbox. Here the effect is the insert itself, so the key and the effect commit together. The order row and the broker publish are still two steps: publish runs after checkout returns, so a crash in between keeps the order and loses the event. That gap is the outbox.

Dead-lettering stays on the broker default. `dead-letter-strategy: at-least-once` without `overflow: reject-publish` is stored and then ignored; the broker falls back to at-most-once and mentions it only in the log.

The image is RabbitMQ 4.2 (LTS, commercial support through 30 June 2030). Queues are quorum. Classic mirroring is not used; it was removed in 4.0.

The three runs below are from this stand. Stop `npm start` first, or the API consumer takes messages out of the same queue and the counts move.

```
published=5
delivered=5
effect=5
acked=5
dlq=0
prefetch=50

rejected=1
work=0
dlq=1
dlq-reason=rejected
effect=0

deliveries=2
effect=1
skipped=1
```

## Outbox та ідемпотентність

Checkout no longer publishes to RabbitMQ. Inside the same database transaction it writes the order and one `outbox` row. The payload is the `order.placed` contract (`eventId`, `type`, `occurredAt`, `data`), built by `orderPlacedEvent`, not a spread of the ORM entity. `published_at` stays NULL until a relay has handed the event to the broker. There is no `publish` call inside the transaction: the broker cannot roll back.

The relay is polling. It takes unpublished rows with `SELECT … WHERE published_at IS NULL ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 10`, publishes, then sets `published_at`. `SKIP LOCKED` lets a second worker take other rows. A bare `FOR UPDATE` would serialize them and deliver nothing in parallel. `SKIP LOCKED` also does not promise a global delivery order. One order emits one event, so this stream does not need one.

The API edge still reads the `Idempotency-Key` header. The key is stored in `idempotency_keys` and identifies the attempt, not a hash of the body. Two requests with the same key insert one order and one outbox row. A body hash used as the key would collapse two legitimate identical orders into one. A different body under the same key is still rejected. `demo:outbox` sends both requests as `POST /orders` with that header.

The consumer keeps two layers in one transaction. The effect is `INSERT` into `order_placed_effects` with `ON CONFLICT (event_id) DO NOTHING`. The inbox mark is `INSERT` into `processed_messages (message_id, consumer)` with `ON CONFLICT DO NOTHING`. A repeat sees the mark and does not apply the effect again.

`demo:crash-write` throws inside the checkout transaction after the outbox insert. Both the order and the outbox row roll back, so nothing is published.

`demo:crash-relay` throws after `publish` and before `UPDATE published_at`. `attempts` is committed in the claim transaction, before publish, so the interrupted handoff still counts. `published_at` stays NULL, the broker message stays, and the next relay publishes that same row again. That is the simulated crash from lecture step 8, not `kill -9`.

Swapping those two steps loses events. If the relay sets `published_at` and then publishes, a failed publish leaves the row marked and the event never goes out. A crash between publish and the mark delivers twice. A duplicate is repaired by the idempotent consumer. A lost event is not.

Rows with `published_at` older than 7 days are deleted once an hour, not on the 2-second relay tick. That delete uses `idx_outbox_published` (`published_at` WHERE `published_at IS NOT NULL`). The poll keeps `idx_outbox_unpublished` (`WHERE published_at IS NULL`). Column names are snake_case. A later Debezium Outbox Event Router would set `route.by.field` to `aggregate_type` (its default looks for `aggregatetype`).

The three runs below are from this stand. Stop `npm start` first: its relay and consumer share this outbox and this queue.

```
requests=2
orders=1
outbox=1
published=1
deliveries=1
effect=1
processed=1

write-failed=1
orders=0
outbox=0
published=0
deliveries=0
effect=0

published=2
deliveries=2
applied=1
effect=1
processed=1
```

## Redis: кеш, сесії, ліміти, черга

The cached read is the product card: the listing, the seller, the stock, units sold, and a rating derived from those sales. A miss loads that row from Postgres and stores it. A hit reads Redis only. The TTL is `300 + random(0..60)` seconds, so a batch of keys warmed together does not expire on the same second. Checkout deletes the card before the order transaction and again after the commit. A reader that loaded the old row can SET it after the first delete; the second delete drops that fill instead of leaving it for the whole TTL.

A cold key takes a single-flight lock: `SET lock:… <token> NX PX`. The winner loads the card. Everyone else waits and reads the cache. The lock is removed with a Lua compare-and-delete of that token. A plain `DEL` would remove a lock that already belongs to the next waiter.

Sessions are on the queue Redis, read with `GETEX`, which moves the TTL forward on each request (`x-session-id`). The cache instance is `allkeys-lru` and will eventually evict a session while the user is still active. The queue instance is `noeviction`, so a session stays until its own TTL. A third Redis would also do that. The queue box already has the policy a session needs.

The limit is a sliding window in one Lua script (`ZREMRANGEBYSCORE`, `ZCARD`, `ZADD`). A fixed window lets a client spend the whole limit at the end of a minute and again at the start of the next. This limit is there to refuse that burst. The bucket is the first address in `X-Forwarded-For`. `req.ip` without trust proxy is the load balancer, so every client would share one bucket. The default is 120 requests per minute. Over the limit the guard answers 429 with `Retry-After`. `demo:ratelimit` boots the API with a window of 5 and sends seven `GET /health` calls from two processes that share one forwarded address.

BullMQ runs on the queue Redis. A rating recalculation is `attempts: 5` with exponential backoff and jitter, and a `jobId` so a second `add` of the same order is the same job. Completed jobs are kept for an hour (`removeOnComplete: { age }`). Removing them immediately would forget the `jobId` and the dedup would stop. The hourly sweep is `upsertJobScheduler`, so a restart updates that scheduler instead of adding another one. The worker uses `maxRetriesPerRequest: null` so a dropped Redis connection waits instead of killing the process.

The cache and the queue are two containers. `maxmemory-policy` is one value for the whole Redis process, and `SELECT` does not split it. The cache needs `allkeys-lru` and a memory cap, or it grows until writes throw. BullMQ needs `noeviction`, or Redis can delete a job key out from under the queue. The queue box also turns on AOF `everysec`.

If the stampede lock fails, two requests both read the product card from Postgres and both write the cache. The card is a pure read, so the extra query is the cost and the stock figure is still the one the database committed. Checkout does not use this lock. The stock debit is one `UPDATE` in the order transaction, and that still holds when Redis is empty.

```
cache-lru=1
cache-maxmemory=1
warmed=60
ttl-distinct=36
concurrent=20
db-calls=1
db-calls-warm=0

requests=3
sessions=1
in-redis=1
ttl-renewed=1

instances=2
limit=5
requests=7
allowed=5
blocked=2
status=429
retry-after=1

queue-noeviction=1
attempts=3
completed=1
added=2
queued=1
schedulers=1
scheduled-runs=2
```

`ttl-distinct` moves from run to run. On this stand it was 36. The floor is 5.

## Auth

Login returns a pair. The access token is an ES256 JWT that lives 10 minutes.
The refresh token is a random string, not a JWT. The database stores
`HMAC-SHA256(pepper, token)`, so a dump of `refresh_tokens` is not a dump of
live sessions. ES256 is the signature algorithm because OWASP marks RS256 as
“Not recommended” and prefers ES256, PS256, or EdDSA. Verification always
passes `algorithms: ['ES256']` (RFC 8725 §3.1). A token whose payload was
rewritten and whose old signature was left in place is rejected.

Every refresh token from one login shares a `family_id`. A successful refresh
marks the presented token `used_at` and inserts the successor in the same
transaction. Presenting a token that already has `used_at` is reuse: the
transaction revokes every row in that family, commits, and then the request
returns 401. There is no grace window. Two parallel refreshes of the same
token look like theft, and the client has to serialize refresh onto one
promise. The role on the access token is a cache. A demoted admin stays an
admin until that access token's `exp`. The next refresh reads `users.role`
again and the new access token carries the new role.

Logout is two actions because the two tokens are not the same kind of secret.
The refresh token is a row, so `revoked_at` on the family is enough. The
access token is self-contained and stays valid until `exp`, so its `jti` goes
onto `access_denylist` with `expires_at` equal to that `exp`. Both writes are
one Postgres commit. Putting the denylist in Redis and the family revoke in
Postgres would be a dual write: one of the two can succeed and the other can
fail, and the session would look dead in one store and alive in the other.
Rows past `expires_at` are deleted by an hourly sweep, not by the logout
request. `idx_access_denylist_expires` is the index that sweep uses.

`JWT_KID`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, and `REFRESH_TOKEN_PEPPER` are
read from the validated config. The signing keys are not a second copy taken
from `process.env` beside the pepper.

`kid` is how a signing key rotates without a gap. The verifier accepts the
current `JWT_KID`. During an overlap the previous public key would be accepted
for the access tokens still inside their 10 minute TTL, and new tokens would
be signed by the new key. Refresh tokens are not signed by this key, so they
do not care which `kid` is current. This build keeps one current key. A header
`kid` that is not `JWT_KID` is 401.

`GET /orders`, `GET /orders/:id`, `PATCH /orders/:id`, and `POST /orders` all
require an access token. Ownership is not a guard. The guard runs before the
order row exists in the handler, and it does not know `buyer_id`.
`OrdersService.findOne` and `updateStatus` load the row, return 404 when it is
missing, and return 403 when the token's subject is a different buyer. The
list is the same rule as a filter: only rows whose `buyer_id` is the token
subject. Role checks are the other way around: `RolesGuard` only needs the
role cached on the token, so `POST /products` is seller or admin, and a buyer
gets 403. A missing or broken token is 401.

Public-key fingerprints (SHA-256 of the SPKI PEM). Dev and prod are different
keys. These are not the private keys, and the grader generates its own pair.

```text
dev  2283d49b714df0209d3bae33616ebd50cd9f8dffd7d0f4706192cb894673e9a3
prod a427556623568d453ae04546261bc462b7bebf77c346f44d2d1fb0f56b2b510f
```

| Змінна | Джерело | Навіщо |
| --- | --- | --- |
| `JWT_KID` | сховище (#11) | which signing key verified this access token |
| `JWT_PRIVATE_KEY` | сховище (#11) | base64 of the PKCS#8 PEM; signs access tokens |
| `JWT_PUBLIC_KEY` | сховище (#11) | base64 of the SPKI PEM; verifies access tokens |
| `REFRESH_TOKEN_PEPPER` | сховище (#11) | HMAC pepper for refresh-token hashes |

`npm run start` does not open the store. Without those four variables it
exits non-zero and names the one that is missing. `npm run start:vault`,
`demo:auth`, `demo:reuse`, and `demo:rbac` go through
`scripts/with-secrets.sh`.

## Files

Uploads are two steps. `POST /uploads/intent` checks the access token, allows
only `image/jpeg`, `image/png`, `image/webp`, and `application/octet-stream`,
and builds the object key itself: `uploads/{userId}/{uuid}.{ext}`. The
extension comes from the content type. The filename the client sends, including
`../../etc/passwd`, is not copied into the key. `POST /uploads/commit` calls
HeadObject and accepts the row only when the object exists and its size matches
the intent. A commit with no bytes is 409.

The presigned URL lives **300 seconds**. An avatar is chosen in a form and
uploaded immediately, and a presigned URL cannot be revoked: there is no `jti`
and no denylist for it. Seven days would also be a lie under short-lived role
credentials. The upload demo sets `PRESIGN_EXPIRES_SECONDS=12` so it can show
`expired=400` without waiting five minutes. The production value stays 300.
Garage answers an expired presigned PUT with 400 InvalidRequest (`Date is too
old`). A tampered path and an anonymous read stay 403.

A file larger than one minimum part (5 MiB) uses multipart. S3 allows at most
10 000 parts, and every part except the last must be at least 5 MiB, so the
part size is `max(5 MiB, ceil(file / 10 000))`. The demo file is `2 * 5 MiB + 1`
byte, which is three parts. The first process uploads two and stops. A second
process calls `POST /uploads/resume`, which ListParts and signs only the
missing part, so `resumed-parts=1`. Until CompleteMultipartUpload, HeadObject
is 404. The multipart ETag ends in `-N` and is not the MD5 of the file.

The bucket is private. Public assets are read through a small edge in
`src/storage/edge.ts`: it fetches the object with the storage credentials,
caches it in memory, and answers with `X-Cache: HIT` or `MISS`. That is the
local form of CloudFront with Origin Access Control: the browser talks to the
cache, and only the cache talks to the bucket. The edge stores a response only
when the object itself was uploaded with
`Cache-Control: public, max-age=31536000, immutable`. A public name is
`assets/app.{sha256}.css`. A new deploy is a new name, so nothing is
invalidated. The stand is Garage (`dxflrs/garage:v2.5.0`, S3 on port 3900):
one node, `replication_factor = 1`, a private bucket, path-style requests.
`s3_region` is `us-east-1` so the AWS SDK credential scope matches
`STORAGE_REGION`. The same client code talks to AWS S3 when `STORAGE_ENDPOINT`
is empty.

On AWS the bucket policy that lets one distribution read, and no other
distribution in the world, is:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontRead",
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::BUCKET_NAME/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::ACCOUNT_ID:distribution/DISTRIBUTION_ID"
        }
      }
    }
  ]
}
```

Block Public Access stays on. Without the `AWS:SourceArn` condition the
statement would trust every CloudFront distribution.

Pending rows older than a day are aborted and deleted by a sweep in the API
process: AbortMultipartUpload, DeleteObject, then the row. Incomplete multipart
uploads are also covered by a lifecycle rule,
`AbortIncompleteMultipartUpload` after 7 days. A rule that expires objects
after 30 days does not abort those uploads; they are different actions.
Double-clicking upload sends one `Idempotency-Key` and keeps a single pending
row. Private downloads would be `GET /uploads/:id` → 302 onto a fresh
one-minute presigned URL, so the guard stays on the authorization path and the
bytes still skip the API. Presigned URLs are not written to logs. The log line
is the file id and the object key.

A repeated run of each demo deletes its own prefix and aborts leftover
multipart uploads before it starts.

```text
intent=200
key-from-server=1
api-alive=0
put-offline=200
commit=200
commit-without-bytes=409
tampered=403
expired=400

head-before-complete=404
resumed-parts=1
complete=200
size-match=1
etag-multipart=1

direct=403
edge-miss=200
edge-hit=200
cache-hit=1
new-name=1
new-url=200
content-changed=1
```

| Змінна | Джерело | Навіщо |
| --- | --- | --- |
| `STORAGE_ACCESS_KEY` | сховище (#11) | access key of the object store |
| `STORAGE_SECRET_KEY` | сховище (#11) | secret key used to sign presigned URLs |
| `STORAGE_ENDPOINT` | compose / оточення | empty on AWS; `http://127.0.0.1:3900` on the stand |
| `STORAGE_BUCKET` | compose / оточення | bucket name, `hw26-files` on the stand |
| `STORAGE_REGION` | compose / оточення | signing region, `us-east-1` |
| `PRESIGN_EXPIRES_SECONDS` | default in code | presigned lifetime, 300 seconds |

`demo:upload`, `demo:multipart`, and `demo:cdn` go through
`scripts/with-secrets.sh`.

## Kubernetes

The production image is `docker/Dockerfile`: a build stage on `node:22-slim`, then `gcr.io/distroless/nodejs22-debian12:nonroot` as uid `65532`. There is no shell in the runtime stage. The npm token is a BuildKit secret (`RUN --mount=type=secret`), read from `.npm_token`, which is not committed. The cluster is kind (`k8s/kind-config.yaml`), one control-plane node, no extra memory cap. Docker Desktop on this machine reports 7.75 GiB. With the API and Postgres running, `docker stats` showed the kind node at about 1.1 GiB. kind is used because minikube refuses `--memory` below 1800 MiB.

`/healthz` answers while the process is alive, including the drain. `/readyz` answers only after `listen` and goes false on SIGTERM, before the socket closes. The deployment waits 4 seconds (`WARMUP_MS`) before `listen`, then drains for 5 seconds (`DRAIN_MS`). `terminationGracePeriodSeconds` is 20, so the grace window outlasts the drain. `maxUnavailable` is 0 and `maxSurge` is 1. A `startupProbe` on `/healthz` allows 30 failures at 2 seconds (60 seconds) before the first restart. Liveness alone, at a 10 second period and 3 failures, would kill the process after 30 seconds.

`spec.replicas` stays 2 because this kind cluster has no metrics-server. The HPA is `autoscaling/v2` with min 2, max 4, and a CPU target, and it reports `cpu: <unknown>`. In a cluster that does run metrics-server, that same `replicas` field is written by both the Pulumi program and the HPA. The next `pulumi up` sets the count back, and the HPA sets it again. One of them has to stop writing the field.

The runtime password arrives from the HW#11 store through `scripts/with-secrets.sh` into a Kubernetes Secret (`data`, base64, not `stringData`). The Deployment only has `secretKeyRef` and a file mount of that Secret. External Secrets Operator or the Secrets Store CSI driver would sync the same value without a Pulumi program holding it; neither is installed here. base64 is not encryption: kind's etcd stores the Secret in clear text.

| Змінна | Джерело | Навіщо |
| --- | --- | --- |
| `APP_DB_PASSWORD` | сховище (#11) | password of the database, delivered in a Kubernetes Secret |
| `PULUMI_CONFIG_PASSPHRASE` | сховище (#11) | passphrase that encrypts the local Pulumi state |

Measured on this machine: `demo:image` printed `stages=2`, `shell-inside=0`, `runtime-uid=65532`, and `token-in-history=0`, `token-in-config=0`, `token-in-layers=0`. `demo:rollout` printed `requests=5694`, `ok=5694`, `failed=0`, `rollout-seconds=13`. `demo:pdb` printed `healthy=2`, `minAvailable=1`, `evict-1=201`, `evict-2=429`. `npm run scan` counted `found=13` CRITICAL+HIGH; `SCAN_MAX=-1` exits non-zero with `gate=fail`, and `SCAN_MAX=99999` exits 0 with `gate=pass`. The CI workflow calls the same script with `SCAN_MAX=200`.

## Observability

Logs are pino JSON on stdout. `trace_id` is the active OpenTelemetry span, read in the logger mixin, not a uuid and not a function argument. `userId`, `tenant` and `idempotencyKey` sit in `AsyncLocalStorage`, filled from `x-user-id`, `x-tenant` and `Idempotency-Key` before the handler runs. A catalog read logs three layers with the same id: `catalog.controller`, `catalog.service`, `catalog.repo`. The repository opens a child span, `catalog.repo.load`. Authorization and the password on `POST /auth/login` are listed in pino `redact` (`req.headers.authorization`, `req.body.password`); a nested field with no path is not hidden.

RED metrics are `http_requests_total` and `http_request_duration_seconds`, labelled `method`, `route`, `status`. `route` is the template (`/catalog/:id`). Finite histogram buckets are `0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60` seconds. The catalog read returns in well under a second; the top finite bucket is 60s so `histogram_quantile` does not clamp when a request is merely slow. A 5xx response sets the server span status to ERROR. 4xx stays unset.

The stand is one container, `grafana/otel-lgtm:0.29.0` (`observability/` holds the dashboard and the Prometheus scrape). Grafana is on `22900`, Prometheus on `22901`, Tempo on `22904`, OTLP HTTP on `22918`. Docker Desktop here has 7.75 GiB. Before the stand, `docker stats` showed the kind node at about 1.17 GiB. After `docker compose up`, the LGTM container was 327 MiB and the image reported a 4 second startup. After the trace demos it was 422 MiB. Both fit together.

The dashboard file is `observability/grafana/dashboards/red.json`. Datasource uid `prometheus` is provisioned by the image.

| Panel | RED question | PromQL |
| --- | --- | --- |
| Rate | How many requests per second? | `sum by (route) (rate(http_requests_total[1m]))` |
| Errors | How many of those are 5xx? | `sum by (route) (rate(http_requests_total{status=~"5.."}[1m]))` |
| Duration | How slow is the 99th percentile? | `histogram_quantile(0.99, sum by (le, route) (rate(http_request_duration_seconds_bucket[1m])))` |

Three runs of each demo printed the same lines. `demo:logs`: `non-json-lines=0`, `layers=3`, `distinct-trace-ids=1`, `trace-id-matches-header=1`, `burst=8`, `burst-trace-ids=8`, `burst-uneven=0`, `secret-req-logged=1`, `secret-in-logs=0`. `demo:metrics`: `sent-ok=40`, `sent-fail=10`, `counter-delta=50`, `errors-delta=10`, `above-top-bucket=0`, `series-before=2`, `series-after=2`. `demo:trace`: `spans=16`, `orphan-spans=0`, `trace-matches-header=1`, `trace-matches-log=1`, `span-status-error=1`.

An SLI for this service is the share of catalog reads that are not 5xx. An SLO of 99.5% over 30 days leaves an error budget of `0.005 × 30 × 24 × 60 = 216` minutes in the month.

| Змінна | Джерело | Навіщо |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | сховище (#11) | OTLP HTTP endpoint of the collector |
| `PROMETHEUS_URL` | сховище (#11) | Prometheus base URL |
| `TRACE_API_URL` | сховище (#11) | Tempo query API |
| `GRAFANA_URL` | сховище (#11) | Grafana base URL |
| `GRAFANA_ADMIN_USER` | сховище (#11) | Grafana user |
| `GRAFANA_ADMIN_PASSWORD` | сховище (#11) | Grafana password |

## AWS

смуга: запасна (LocalStack)

Region: `eu-central-1`. The programs are `infra/base` and `infra/demo`. The npm scripts are in `infra/base/package.json` (that path sorts first) and again at the repository root. Every one of them goes through `scripts/with-secrets.sh`.

teardown-run: local. The fallback lane has no GitHub Actions run. After `pulumi destroy`, `evidence/demos.txt` contains `state-resources-left=0`. The same file records `tagged-resources-left=0`, `nat-left=0` and `eip-left=0` in `eu-central-1` and in `us-east-1`. `describe-db-instances` and `describe-load-balancers` answer HTTP 501 on this image, so those two counts are not printed as a zero the API did not return.

`localstack/localstack:4.14.0` is pinned on host port `23166`. Pinning to a prior version will opt you out of any future updates or security patches. No `LOCALSTACK_AUTH_TOKEN` is used.

If this AWS account ever existed before, the Free plan is not available: "You would be ineligible for free plan or Free Tier credits if you have an existing AWS account or have had one in the past." The budget and `pulumi destroy` are then the only protection. AWS Organizations and Control Tower were not created. A customer-managed KMS key was not created. No hosted zone was created.

A month in the table below is 730 hours. The course snapshot of 24.08.2026, at the NBU rate of 25.08.2026, sums to $59.79 a month, which is $0.08191 an hour, $0.33 for four hours, and $1.97 a day. Lines I opened myself:

| Line | Rate | Where I saw it | 730 hours |
| --- | --- | --- | --- |
| RDS PostgreSQL `db.t4g.micro`, Multi-AZ instance | $0.037/hour | AWS price list dated 24.11.2026, retrieved 25.11.2026 via Costfluent. Single-AZ on the same list is $0.019/hour. | $27.01 |
| NAT Gateway, eu-central-1 | $0.052/hour, plus $0.052/GB processed | A price-list mirror updated 19.10.2026. The same page lists us-east-1 at $0.045/hour. | not in the $59.79 sum |
| ALB | $0.027/hour in the 24.08.2026 snapshot | On 26.11.2026 the public ELB page's worked example uses $0.0225/hour and says a partial hour is billed as a full hour. That page did not print a Frankfurt dollar row, so the snapshot figure stays. | $19.71 |
| gp3 20 GiB, Multi-AZ | $0.274/GiB-month in the snapshot | I did not open a newer Frankfurt gp3 page. | $5.48 |
| Public IPv4 × 2 | $0.005/hour × 2 in the snapshot | I did not open a newer public-IPv4 page. | $7.30 |
| LCU | $0.29 for the month | An assumption about a classroom load, not a price-list row. | $0.29 |

RDS and NAT still match the snapshot, so the derivatives above stay. A partial NAT hour is billed as a full hour: $0.052 plus its public IPv4 $0.005 is $0.057. This run did not create a NAT gateway, so that $0.057 was not measured as an invoice. The failed update did allocate the gateway's address; `pulumi destroy` released it, and `eip-left=0`. RDS bills per second with a 10 minute minimum. Twelve hours of budget lag at the snapshot rate is about $0.98. The budget is a letter, not a brake.

The budget resource is `aws.budgets.Budget`: COST, MONTHLY, `limitAmount: "5"`, notification type ACTUAL, GREATER_THAN, 20 percent. FORECASTED is not used. On a real account it is created before the VPC, and the address comes from `HW31_BUDGET_EMAIL`. Community LocalStack answers 501 for budgets, which would stop the free network from being created, so the call is skipped only when `AWS_ENDPOINT_URL` is set. The resource stays in `infra/base/index.ts`.

LocalStack does not apply this IAM policy. I did not verify the policy locally, because it cannot be verified locally. A user with no policies, a user whose policy is Deny on every action, and the key `TOTALLY_FAKE_KEY_12345` all received HTTP 200, with `ENFORCE_IAM=1`. `evidence/localstack-iam.txt` records `deny-all=200`, `fake-key=200`, `enforce-iam-log-lines=0`. `simulate-principal-policy` did return `sim-allowed=allowed` for `rds:DeleteDBInstance` and `sim-denied=explicitDeny` for `rds:RebootDBInstance` (the command needs `--resource-arns '*'` here, or LocalStack raises InternalError). The allow had an empty `MatchedStatements` list, and an action the policy merely does not grant came back `explicitDeny` rather than `implicitDeny`. That is not the AWS decision engine. The same class of lie showed up in HW#26 step 7.4: LocalStack, used there as an S3 stand, accepted requests whose signatures it did not check and did not refuse an anonymous read. Garage does. An anonymous GET is 403, and an expired presign is HTTP 400.

The CI role trusts `token.actions.githubusercontent.com`, requires `aud` `sts.amazonaws.com`, and limits `sub` to `repo:Matvey-Nikishenko/course-project:*`. No action is `*`. What each action is for:

- `ec2:DescribeVpcs`, `ec2:DeleteVpc` — read and delete the VPC.
- `ec2:DescribeSubnets`, `ec2:DeleteSubnet` — read and delete the four subnets.
- `ec2:DescribeInternetGateways`, `ec2:DetachInternetGateway`, `ec2:DeleteInternetGateway` — detach and delete the internet gateway.
- `ec2:DescribeRouteTables`, `ec2:DeleteRoute`, `ec2:DisassociateRouteTable`, `ec2:DeleteRouteTable` — remove routes, associations, and the tables.
- `ec2:DescribeSecurityGroups`, `ec2:DescribeSecurityGroupRules`, `ec2:RevokeSecurityGroupIngress`, `ec2:RevokeSecurityGroupEgress`, `ec2:DeleteSecurityGroup` — remove the group rules, then the groups.
- `ec2:DescribeNatGateways`, `ec2:DeleteNatGateway` — delete the NAT gateway when the demo flag created one.
- `ec2:DescribeAddresses`, `ec2:ReleaseAddress` — release the NAT address. An address left behind is the `eip-left` line.
- `ec2:DescribeNetworkInterfaces`, `ec2:DeleteNetworkInterface` — delete an interface that still holds a subnet or a security group.
- `rds:DescribeDBInstances`, `rds:DeleteDBInstance` — find the instance and delete it. `rds:RebootDBInstance` is not granted. That is the negative simulation.
- `rds:DescribeDBSubnetGroups`, `rds:DeleteDBSubnetGroup` — delete the subnet group after the instance.
- `rds:ListTagsForResource` — read tags while deleting.
- `elasticloadbalancing:DescribeLoadBalancers`, `elasticloadbalancing:DescribeListeners`, `elasticloadbalancing:DescribeTargetGroups`, `elasticloadbalancing:DescribeTargetHealth` — read the balancer before deleting it.
- `elasticloadbalancing:DeleteListener`, `elasticloadbalancing:DeleteTargetGroup`, `elasticloadbalancing:DeleteLoadBalancer` — delete the listener, the target group, then the balancer.
- `lambda:GetFunction`, `lambda:ListFunctions`, `lambda:GetPolicy`, `lambda:RemovePermission`, `lambda:DeleteFunction` — detach the balancer permission and delete the function.
- `iam:GetRole`, `iam:ListRolePolicies`, `iam:GetRolePolicy`, `iam:DeleteRolePolicy`, `iam:ListAttachedRolePolicies`, `iam:DetachRolePolicy`, `iam:DeleteRole` — delete the inline policy and then the role.
- `iam:GetOpenIDConnectProvider`, `iam:ListOpenIDConnectProviders`, `iam:DeleteOpenIDConnectProvider` — delete the GitHub OIDC provider after the role that trusts it.
- `budgets:ViewBudget`, `budgets:ModifyBudget` — read the budget and delete it. Budgets has no separate delete action.
- `tag:GetResources` — the per-region tag query in the emptiness check.
- `sts:GetCallerIdentity` — confirm which account the role entered.

Both simulation outputs are in `evidence/iam.txt`: `sim-allowed=allowed` and `sim-denied=explicitDeny`.

RDS Multi-AZ against the HW#15 stack: the instance takes the primary, the standby failover, encryption of the volume, and one day of automated storage snapshots. It does not take PgBouncer. Pooling stays in the application, on port 6432. The standby is not a read replica, so reads do not move onto it. It does not take `scripts/backup.sh` or the restore drill. Those are a logical dump and a rehearsal of restoring it. A storage snapshot is not that rehearsal.

KMS is the layer under the HW#11 store, the key that would wrap `ENCRYPTION_KEY`. `storageEncrypted: true` uses the AWS-managed `aws/rds` key. A customer-managed key was not created. That key would keep a line on the bill after the same day's destroy.

The HW#28 state backend is `file://` on this laptop (`.pulumi`). A GitHub-hosted worker cannot see that directory, so a real account needs Pulumi Cloud or an S3 backend. This lane also uses a file backend, `.pulumi-aws`, because nothing is billed and the destroy runs here. `PULUMI_CONFIG_PASSPHRASE` stays in the process environment. `pulumi login` was not run.

The base network, measured before it was destroyed: VPC `10.31.0.0/16`, two public subnets (`10.31.1.0/24`, `10.31.2.0/24`) and two private subnets (`10.31.11.0/24`, `10.31.12.0/24`) in `eu-central-1a` and `eu-central-1b`. The private route tables have no `0.0.0.0/0` route to the internet gateway. Port 80 is the only public ingress, on the balancer group. Port 8080 leaves that group only toward the application group. Port 5432 leaves the application group only toward the database group, and enters the database only from that group. There is no NAT in the base stack.

The demo program declares a Multi-AZ PostgreSQL instance (`db.t4g.micro`, gp3 20 GiB, encrypted, one day of backups, not a Multi-AZ cluster), an internet-facing ALB, and a lambda target group. A transform registered before any resource sets `deletionProtection: false` and `skipFinalSnapshot: true`. `pulumi preview` of that program is `evidence/preview-demo.txt` and names `aws:rds/instance:Instance`. `pulumi up` is `evidence/501.txt`. This image's catalog call returns HTTP 404 `licensing.latest_version_not_found`, so the 501 text is "not included in your current license plan or has not yet been emulated by LocalStack", not the older sentence "not included within your LocalStack license". Both sentences are in the 4.14.0 sources. The catalog 404 selects the generic one. Failover, the HTTP check, and the NAT hour were not measured, because those APIs did not stand up. No AZ change, HTTP status, or billed hour was invented. The lambda target is created only when `AWS_ENDPOINT_URL` is unset: without the Docker socket, LocalStack accepts the function and then never finishes deleting it.

## CI/CD

Merging a pull request is the deploy. The pull request workflow (`.github/workflows/pr.yml`) is the graded run. The deploy workflow (`.github/workflows/deploy.yml`) runs on a push to `main` and on `workflow_dispatch`, and it does not build an image.

```
quality ─────────────┐
build → scan ────────┼→ deploy → evidence
oidc ────────────────┘
```

`quality` runs `tsc --noEmit`, dependency-cruiser, and oasdiff against `openapi/openapi.yaml` on `main`. `build` is the only image build in the workflows. It pushes one tag, `ghcr.io/matvey-nikishenko/course-project:${{ github.sha }}`, and passes the registry digest to `deploy`. `scan` runs `npm run scan` with `SCAN_MAX=200`. `oidc` asks GitHub for an ID token and runs `scripts/oidc-gate.mjs` against `oidc/policy.json`. `deploy` starts kind, runs `pulumi preview`, the cost gate, then `pulumi up`, then `demo:rollout` with `ROLL_MIN=2000`. `evidence` uploads the `pipeline-evidence` artifact with `if: always()`.

The pull request run deploys into a kind cluster named `marketplace` that exists only on that runner. Namespace `marketplace`, NodePort 30080. That is the preview environment. The `main` workflow pulls the same digest and applies it with the same Pulumi program. That is the promotion environment. The image package is public for the duration of grading, so a digest check can read GHCR without credentials. Registry writes use `GITHUB_TOKEN` (`packages: write`). No long-lived cloud key is stored.

`head-sha` in the artifact is `github.event.pull_request.head.sha`. On a pull request, `github.sha` is the merge commit, and that is the human tag on the image. The cluster receives the digest, not the tag.

| Secret | Why |
| --- | --- |
| `PACT_BROKER_URL` | Address of the Pact broker for the manual contract workflow. Empty means the compose broker on port 21620. |
| `PACT_BROKER_TOKEN` | Token for that broker. It does not open a cloud account or the registry. |

| Змінна | Джерело | Навіщо |
| --- | --- | --- |
| `JWT_KID` | сховище (#11) | signing key id, same variable as the auth section |
| `JWT_PRIVATE_KEY` | сховище (#11) | ES256 private key, same variable as the auth section |
| `JWT_PUBLIC_KEY` | сховище (#11) | ES256 public key, same variable as the auth section |
| `REFRESH_TOKEN_PEPPER` | сховище (#11) | refresh-token pepper, same variable as the auth section |
| `STORAGE_ACCESS_KEY` | сховище (#11) | object-store access key, same variable as the files section |
| `STORAGE_SECRET_KEY` | сховище (#11) | object-store secret key, same variable as the files section |
| `APP_DB_PASSWORD` | сховище (#11) | database password, same variable as the Kubernetes section |
| `PULUMI_CONFIG_PASSPHRASE` | сховище (#11) | passphrase of the local Pulumi state |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | сховище (#11) | OTLP endpoint, same variable as the observability section |
| `PROMETHEUS_URL` | сховище (#11) | Prometheus URL, same variable as the observability section |
| `TRACE_API_URL` | сховище (#11) | Tempo URL, same variable as the observability section |
| `GRAFANA_URL` | сховище (#11) | Grafana URL, same variable as the observability section |
| `GRAFANA_ADMIN_USER` | сховище (#11) | Grafana user, same variable as the observability section |
| `GRAFANA_ADMIN_PASSWORD` | сховище (#11) | Grafana password, same variable as the observability section |

The pipeline's own credentials are not in this table. GitHub issues them for one job: `GITHUB_TOKEN` for GHCR, and an OIDC token for the gate in `scripts/oidc-gate.mjs`. The trust file is `oidc/policy.json`. It allows `sub` for this repository only, both the numeric form (`repo:Matvey-Nikishenko@54702689/course-project@1354860164:*`, this repository was created on 2026-09-02) and the classic `repo:Matvey-Nikishenko/course-project:*`. A token whose `sub` names another repository is refused even when the signature and `aud` are valid.

GitHub masks a secret in a log only when the exact string appears. It does not mask a base64 rendering of that string, a value split across lines, or a tool that prints the same bytes in another shape. Masking is not a control. Five leak paths were closed with the store: git history, the application log, an image layer, `docker inspect`, and `docker history`. The job log is the sixth. No step that can see a secret runs `echo` of that secret, a bare `env`, `printenv`, or `set -x`.

`src/mapping.ts` prices `resources.requests` on each container in the Pulumi plan. The rates are the Linux/X86 figures from the worked examples on the AWS Fargate pricing page, https://aws.amazon.com/fargate/pricing/, retrieved 2026-11-26: $0.000011244 per vCPU-second and $0.000001235 per GB-second, US East (N. Virginia). A month is 730 hours, the same convention as the AWS section. The kind cluster is not billed. The gate compares that monthly sum with `COST_BUDGET_USD`. The lecture's rule of thumb is a change above $10 a month or above 20 percent. The script enforces the absolute budget the grader sets, so the same plan can fail a budget of 0 and pass a budget of 999999. A pull request that carries the bypass label still prints `gate=fail` or `gate=pass` and then exits 0.

cost-gate-bypass-label: cost-approved

## Grading

```bash
docker compose up -d --wait
export DB_HOST=127.0.0.1 DB_PORT=6432 DB_USER=admin DB_PASSWORD=admin-bootstrap-only DB_NAME=marketplace
export SKIP_VAULT=1    # grader has no access to the store

# One-off ES256 pair. The real signing key stays in the store.
# PEM is base64 so a multiline export does not break the decoder.
node -e 'const {generateKeyPairSync}=require("node:crypto");
const k=generateKeyPairSync("ec",{namedCurve:"P-256",
  privateKeyEncoding:{type:"pkcs8",format:"pem"},
  publicKeyEncoding:{type:"spki",format:"pem"}});
const fs=require("node:fs");
fs.writeFileSync("/tmp/priv.b64",Buffer.from(k.privateKey).toString("base64"));
fs.writeFileSync("/tmp/pub.b64",Buffer.from(k.publicKey).toString("base64"));'
export JWT_KID=grader
export JWT_PRIVATE_KEY="$(cat /tmp/priv.b64)"
export JWT_PUBLIC_KEY="$(cat /tmp/pub.b64)"
export REFRESH_TOKEN_PEPPER=grader-pepper

export STORAGE_ENDPOINT=http://127.0.0.1:3900
export STORAGE_ACCESS_KEY=hw26user
export STORAGE_SECRET_KEY=hw26secretpass01
export STORAGE_BUCKET=hw26-files
export STORAGE_REGION=us-east-1

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

export BROKER_URL=amqp://app:app@127.0.0.1:5672
npm run demo:publish
npm run demo:dlq
npm run demo:duplicate

npm run demo:outbox
npm run demo:crash-write
npm run demo:crash-relay

export REDIS_URL=redis://127.0.0.1:6379
export REDIS_QUEUE_URL=redis://127.0.0.1:6380
npm run demo:cache
npm run demo:session
npm run demo:ratelimit
npm run demo:queue

npm run demo:auth
npm run demo:reuse
npm run demo:rbac

npm run demo:upload
npm run demo:multipart
npm run demo:cdn

export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/marketplace
export SKIP_VAULT=1
bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh

export SKIP_VAULT=1
export PULUMI_BACKEND_URL="file://$PWD/.pulumi"
export PULUMI_CONFIG_PASSPHRASE=hw28-grading
export APP_DB_PASSWORD=grader-secret
export JWT_KID=grader
export JWT_PRIVATE_KEY="$(cat /tmp/priv.b64)"
export JWT_PUBLIC_KEY="$(cat /tmp/pub.b64)"
export REFRESH_TOKEN_PEPPER=grader-pepper
export STORAGE_ACCESS_KEY=hw26user
export STORAGE_SECRET_KEY=hw26secretpass01
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:22918
export PROMETHEUS_URL=http://127.0.0.1:22901
export TRACE_API_URL=http://127.0.0.1:22904
export GRAFANA_URL=http://127.0.0.1:22900
export GRAFANA_ADMIN_USER=admin
export GRAFANA_ADMIN_PASSWORD=admin
printf 'dummy-npm-token' > .npm_token
npm --prefix infra ci
npm run image:build
npm run cluster:up
npm run up
npm run demo:image
npm run demo:rollout
npm run demo:pdb
SCAN_MAX=-1 npm run scan || true
SCAN_MAX=99999 npm run scan
npm run destroy && npm run cluster:down

export SKIP_VAULT=1
export DB_URL=postgres://admin@127.0.0.1:6432/marketplace
export DB_PASSWORD=admin-bootstrap-only
node -e 'const {generateKeyPairSync}=require("node:crypto");
const k=generateKeyPairSync("ec",{namedCurve:"P-256",
  privateKeyEncoding:{type:"pkcs8",format:"pem"},
  publicKeyEncoding:{type:"spki",format:"pem"}});
const fs=require("node:fs");
fs.writeFileSync("/tmp/priv.b64",Buffer.from(k.privateKey).toString("base64"));
fs.writeFileSync("/tmp/pub.b64",Buffer.from(k.publicKey).toString("base64"));'
export JWT_KID=grader
export JWT_PRIVATE_KEY="$(cat /tmp/priv.b64)"
export JWT_PUBLIC_KEY="$(cat /tmp/pub.b64)"
export REFRESH_TOKEN_PEPPER=grader-pepper
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:22918
export PROMETHEUS_URL=http://127.0.0.1:22901
export TRACE_API_URL=http://127.0.0.1:22904
export GRAFANA_URL=http://127.0.0.1:22900
export GRAFANA_ADMIN_USER=admin
export GRAFANA_ADMIN_PASSWORD=admin
docker compose up -d --wait
npm run demo:logs
npm run demo:metrics
npm run demo:trace
```

`scripts/backup.sh` and `scripts/restore-drill.sh` read `DATABASE_URL` from
the process environment. Under `SKIP_VAULT=1` the wrapper is a no-op `exec`,
so a bare `bash scripts/backup.sh` after the same `export` is equivalent.

Stand credentials are `admin` / `admin-bootstrap-only` / `marketplace`. The
app and scripts use host port **6432** (PgBouncer). Direct Postgres stays on
**5433** for rotate/admin. The cache Redis is **6379** (`allkeys-lru`). The
queue Redis is **6380** (`noeviction`). Those values are not store secrets:
the containers are thrown away with `down -v`.

```bash
git clone https://github.com/Matvey-Nikishenko/course-project.git && cd course-project && git checkout hw-32

npm ci

export SKIP_VAULT=1
export APP_DB_PASSWORD=grader-secret

npm run demo:gates
npm run demo:oidc
PLAN_JSON=/tmp/hw32/plan.json COST_BUDGET_USD=0 npm run gate:cost
```

`demo:gates` and `demo:oidc` do not call GitHub and do not need a cluster. `gate:cost` reads `plan.json` from the `pipeline-evidence` artifact of a successful run. That file is not committed.

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
