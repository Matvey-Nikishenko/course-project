#!/usr/bin/env bash
# Restore the latest -Fc dump into a throwaway Postgres and compare
# count(*)|sum(orders.total) against the live DATABASE_URL. Prints MATCH or exits 1.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
. "$ROOT/scripts/pg-url.sh"

DUMP="$(ls -1t "$ROOT/backups"/marketplace-*.dump 2>/dev/null | head -n 1 || true)"
if [ -z "$DUMP" ]; then
  echo "no dump in $ROOT/backups — run scripts/backup.sh first" >&2
  exit 1
fi

CHECKSUM_SQL="SELECT CASE WHEN to_regclass('public.orders') IS NULL THEN '0|0' ELSE (SELECT count(*)::text || '|' || coalesce(sum(total), 0)::text FROM orders) END;"

checksum_live() {
  docker run --rm \
    --add-host=host.docker.internal:host-gateway \
    -e PGPASSWORD="$PGPASSWORD" \
    postgres:16-alpine \
    psql -h host.docker.internal -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -At -c "$CHECKSUM_SQL"
}

NAME="marketplace-restore-drill-$$"
cleanup() {
  docker rm -f -v "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

BEFORE="$(checksum_live)"

docker run -d --name "$NAME" \
  -e POSTGRES_USER=admin \
  -e POSTGRES_PASSWORD=admin-bootstrap-only \
  -e POSTGRES_DB=marketplace \
  postgres:16-alpine >/dev/null

ready=0
for _ in $(seq 1 80); do
  if docker exec "$NAME" pg_isready -U admin -d marketplace >/dev/null 2>&1; then
    sleep 0.5
    if docker exec "$NAME" pg_isready -U admin -d marketplace >/dev/null 2>&1; then
      ready=1
      break
    fi
  fi
  sleep 0.25
done
if [ "$ready" != 1 ]; then
  echo "restore target never became ready" >&2
  exit 1
fi

docker cp "$DUMP" "$NAME:/tmp/restore.dump"
docker exec -e PGPASSWORD=admin-bootstrap-only "$NAME" \
  pg_restore --no-owner --no-acl -U admin --dbname=marketplace /tmp/restore.dump

AFTER="$(docker exec -e PGPASSWORD=admin-bootstrap-only "$NAME" \
  psql -U admin -d marketplace -At -c "$CHECKSUM_SQL")"

echo "dump: $DUMP"
echo "before: $BEFORE"
echo "after:  $AFTER"

if [ "$BEFORE" = "$AFTER" ]; then
  echo MATCH
else
  echo "MISMATCH: live $BEFORE vs restored $AFTER" >&2
  exit 1
fi
