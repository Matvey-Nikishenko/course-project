# Restore drill — 2026-10-03

Protocol of one successful restore of the course database from the nightly
custom-format dump. The drill script creates a throwaway Postgres container
(empty volume), restores into it, compares `count(*)|sum(total)` on `orders`
against the live database through PgBouncer, prints `MATCH`, and removes the
container. A second run on the same dump also printed `MATCH`.

| Item | Value |
| --- | --- |
| Date | 2026-10-03 |
| Dump | `backups/marketplace-2026-10-03.dump` |
| Dump size | 23 KiB (`pg_dump -Fc`) |
| Control (live = restored) | `90\|23628000` (orders count \| sum of `total` in cents) |
| Restore wall time | 2.7 s (first run), 2.2 s (repeat) |
| **RTO** | **3 seconds** — measured wall-clock of the drill: empty container + `pg_restore --no-owner` + checksum. This dump is the migrated+seeded course DB (90 orders), not the 120 000-row HW#12 load. |
| **RPO** | **24 hours** — `backup.cron` runs `scripts/backup.sh` once a night (`0 3 * * *`). A crash just before 03:00 can lose up to a full day of writes. |

Commands used:

```bash
docker compose up -d --wait
export DATABASE_URL=postgres://admin:admin-bootstrap-only@127.0.0.1:6432/marketplace
export SKIP_VAULT=1
bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```
