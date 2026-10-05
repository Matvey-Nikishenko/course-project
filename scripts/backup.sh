#!/usr/bin/env bash
# Custom-format dump of the course database. Connection comes from DATABASE_URL
# (Infisical via with-secrets.sh, or SKIP_VAULT=1 + compose credentials).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
. "$ROOT/scripts/pg-url.sh"

KEEP="${BACKUP_KEEP:-7}"
STAMP="$(date +%Y-%m-%dT%H%M%S)"
DEST="$ROOT/backups"
mkdir -p "$DEST"
OUT="$DEST/marketplace-${STAMP}.dump"

psql_live() {
  docker run --rm \
    --add-host=host.docker.internal:host-gateway \
    -e PGPASSWORD="$PGPASSWORD" \
    postgres:16-alpine \
    psql -h host.docker.internal -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
}

# Snapshot the control sum *before* pg_dump so restore-drill compares against
# the dump, not whatever the live database looks like hours later.
CONTROL="$(orders_checksum psql_live)"

docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -e PGPASSWORD="$PGPASSWORD" \
  -v "$DEST:/backups" \
  postgres:16-alpine \
  pg_dump -Fc --no-owner \
    -h host.docker.internal -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    -f "/backups/$(basename "$OUT")"

printf '%s\n' "$CONTROL" > "$OUT.checksum"

# Time in the filename already avoids same-day overwrite; drop older files
# so the destination does not grow without bound.
n=0
ls -1t "$DEST"/marketplace-*.dump 2>/dev/null | while IFS= read -r f; do
  n=$((n + 1))
  if [ "$n" -gt "$KEEP" ]; then
    rm -f "$f" "$f.checksum"
  fi
done

echo "$OUT"
