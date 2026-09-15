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
| 2026-09-15 | Money is `numeric(12,2)` in the database | Float cannot hold `0.01`, and a debit that drifts is a lost invoice. The HW#9 HTTP contract keeps integer cents, so the two representations do not match yet — reconciling them belongs to the mapping layer of HW#13, not here. |
| 2026-09-15 | Keys are `GENERATED ALWAYS AS IDENTITY`, not `serial` | The sequence belongs to the column, an explicit INSERT cannot desynchronise it, and writing the id is not a privilege handed out with the table. |
| 2026-09-15 | Catalog search stays on `simple` FTS config | This Postgres ships 29 configurations and none is Ukrainian, so search matches exact word forms only. Named as a documented limitation in `db/OPTIMIZATIONS.md`; substituting `russian` would guess Ukrainian endings by foreign rules and hide the problem instead of fixing it. |

## Configuration

Every variable the app reads is declared in `src/config/env.schema.ts`. The
schema runs through `validate` in `ConfigModule.forRoot`, which happens before
Nest builds the DI graph: a broken variable stops the process with a non-zero
exit code and names every problem at once. Nothing reads `process.env`
directly; the code takes values from `ConfigService<Env, true>`.

`.env.example` is the contract and lives in git. The real `.env` and the
`secrets/` directory do not — they are git-ignored and excluded from the Docker
build context.

### Variables

| Variable | Required | Default | Source | Meaning |
| --- | --- | --- | --- | --- |
| `PORT` | no | `3000` | `.env` | HTTP port of the API. |
| `LOG_LEVEL` | no | `info` | `.env` | `debug` \| `info` \| `warn` \| `error`. |
| `DB_URL` | **yes** | — | **secret storage from HW#11** — `.env` locally, mounted secret in prod; never a new env file | Postgres descriptor of the HW#12 database, e.g. `postgres://app_user@127.0.0.1:5433/marketplace`. Must not contain a password: the schema rejects one. |
| `DB_PASSWORD_FILE` | no | `secrets/db_password` | **secret storage from HW#11** — file path, the value itself is never in git | File holding the database password, read on every new pool connection. |
| `DB_POOL_MAX` | no | `5` | `.env` | Maximum connections in the pg pool. |

The two rows marked as storage are the only ones carrying a credential. They are
declared in `.env.example` with a fake value and resolved at runtime from the
storage set up in HW#11 — that is why no tracked env file besides
`.env.example` mentions a connection string. The Postgres container's own dev
credentials are a different path: they stay in `docker-compose.yml` in plain
sight, because a grader cloning this repo needs the local stand to come up
without any secret at all.


### Running it

```bash
npm install
cp .env.example .env      # then edit values if needed
npm run db:up             # Postgres on :5433 + seed secrets/db_password
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
  -e DB_URL=postgres://app_user@host.docker.internal:5433/marketplace \
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

## HW#12 — дата-шар: схема, обсяг, індекси

Головна таблиця — **`orders`** (120 000 рядків). Таблиця, по якій шукає q4, —
**`products`** (120 000 рядків).

Підняти базу:

```bash
docker compose up -d --wait
```

Підключитись:

```bash
docker compose exec db psql -U admin -d marketplace
```

Обидва рядки працюють на свіжому клоні без правок файлів: дев-креденшели стенда
лежать у `docker-compose.yml`, а тека `db/` змонтована в контейнер як `/db:ro`,
тому `psql -f /db/schema.sql` не потребує клієнта psql на хості.

Повний цикл — той самий порядок, у якому знято числа в `db/OPTIMIZATIONS.md`:

```bash
docker compose down -v && docker compose up -d --wait

docker compose exec -T db psql -U admin -d marketplace -f /db/schema.sql
docker compose exec -T db psql -U admin -d marketplace -f /db/seed.sql

# EXPLAIN «до»: кожен запит дає Seq Scan
for q in 1 2 3 4; do
  docker compose exec -T db psql -U admin -d marketplace \
    -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q$q.sql)"
done

docker compose exec -T db psql -U admin -d marketplace -f /db/indexes.sql
docker compose exec -T db psql -U admin -d marketplace -c "ANALYZE;"

# EXPLAIN «після»: Seq Scan зник, у вузлі — ім'я індексу з db/indexes.sql.
# q4 проганяємо тричі: перший раз GIN ще холодний.
for q in 1 2 3 4; do
  docker compose exec -T db psql -U admin -d marketplace \
    -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q$q.sql)"
done
```

| Файл | Що всередині |
| --- | --- |
| `db/schema.sql` | 4 таблиці, 4 FOREIGN KEY, `numeric`/`timestamptz`, CHECK, генерована `tsvector`-колонка |
| `db/seed.sql` | 50 000 users, 120 000 products, 120 000 orders, 240 000 order_items + `VACUUM (ANALYZE)` |
| `db/queries/q1..q4.sql` | замовлення покупця за період · черга необроблених · вхід за email без регістру · пошук по каталогу |
| `db/indexes.sql` | 4 індекси: composite, partial, expression, GIN по tsvector |
| `db/OPTIMIZATIONS.md` | 4 пари EXPLAIN до/після, розбір планів, секція «Морфологія» |

Прискорення — від ×12 до ×132; деталі й повні плани у звіті.

## HW#9

Варіант Б.

```bash
npm install
npm start

npx @redocly/cli lint openapi/openapi.yaml

npx @redocly/cli bundle openapi/openapi.yaml -o spec.json
node -e "const s=require('./spec.json'),M=['get','post','put','patch','delete'];\
const ops=Object.entries(s.paths).flatMap(([p,v])=>Object.keys(v).filter(m=>M.includes(m)).map(m=>[p,m]));\
const idem=ops.flatMap(([p,m])=>s.paths[p][m].parameters??[]).find(x=>x.in==='header'&&/idempotency-key/i.test(x.name));\
console.log('операцій:',ops.length,'· ресурсів:',new Set(Object.keys(s.paths).map(p=>p.split('/')[1])).size);\
console.log('Idempotency-Key: required =',idem?.required,'· опис, символів =',(idem?.description??'').trim().length)"
# очікуємо: операцій ≥ 5 · ресурсів ≥ 2 · required = true · опис ≥ 40 символів

grep -c 'Idempotency-Key' openapi/openapi.yaml
grep -c 'next_cursor' openapi/openapi.yaml
grep -c 'application/problem+json' openapi/openapi.yaml
```
