#!/usr/bin/env bash
# Custom-format dump of the course database. Connection comes from DATABASE_URL
# (Infisical via with-secrets.sh, or SKIP_VAULT=1 + compose credentials).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
. "$ROOT/scripts/pg-url.sh"

STAMP="$(date +%Y-%m-%d)"
DEST="$ROOT/backups"
mkdir -p "$DEST"
OUT="$DEST/marketplace-${STAMP}.dump"

docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -e PGPASSWORD="$PGPASSWORD" \
  -v "$DEST:/backups" \
  postgres:16-alpine \
  pg_dump -Fc --no-owner \
    -h host.docker.internal -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    -f "/backups/$(basename "$OUT")"

echo "$OUT"
