# Restore drill — 2026-10-05

Protocol of one successful restore from the nightly custom-format dump of the
**committed seed** (5 users / 6 products / **10 orders** / 20 order_items).
`scripts/backup.sh` writes `count(*)|sum(orders.total)` next to the dump; the
drill restores into a throwaway Postgres (empty volume), compares that sidecar
to the restored database, prints `MATCH`, and removes the container. A write
on the live database after the dump does not change the result: after
`UPDATE orders SET total = total + 1` the live sum was `10|23620001`, the
sidecar stayed `10|23620000`, and both drill runs still printed `MATCH`.

A dump taken before migrations (no `orders` table) restores as `0|0` / `MATCH`
as well — the checksum uses `to_regclass` in a **separate** statement, so
Postgres never parses `FROM orders` on an empty cluster.

| Item | Value |
| --- | --- |
| Date | 2026-10-05 |
| Dump | `backups/marketplace-2026-10-05T150156.dump` |
| Dump size | 20540 B (`pg_dump -Fc`) |
| Control (dump sidecar = restored) | `10\|23620000` (orders count \| sum of `total` in cents) |
| Restore wall time | 2.4 s (first run), 2.3 s (repeat) |
| **RTO** | **3 seconds** — measured wall-clock of the drill: empty container + `pg_restore --no-owner` + checksum. |
| **RPO** | **24 hours** — `backup.cron` runs `scripts/backup.sh` once a night (`0 3 * * *`). A crash just before 03:00 can lose up to a full day of writes. Filenames include time (`YYYY-MM-DDTHHMMSS`); the destination keeps the last 7 dumps. |

Commands used:

```bash
docker compose up -d --wait
export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/marketplace
export SKIP_VAULT=1
bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```
