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
