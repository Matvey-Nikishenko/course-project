#!/usr/bin/env bash
# Run a command with secrets injected into the child process.
#
#   bash scripts/with-secrets.sh dev  npm run migrate
#   SKIP_VAULT=1 bash scripts/with-secrets.sh dev npm run migrate
#
# The application never talks to the store — it only reads process.env.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_SLUG="${1:-dev}"; shift || true
[ "$#" -gt 0 ] || set -- npm run start

# грейдер не має доступу до сховища: значення вже в оточенні
if [ "${SKIP_VAULT:-0}" = "1" ]; then exec "$@"; fi

CREDS="$ROOT/.secrets/infisical.env"
if [ -f "$CREDS" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$CREDS"
  set +a
fi

exec infisical run --env="$ENV_SLUG" --silent -- "$@"
