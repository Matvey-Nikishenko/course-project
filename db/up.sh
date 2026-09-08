#!/usr/bin/env bash
# Starts Postgres and makes sure the secret file and the role password agree.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

SECRET_FILE="${DB_PASSWORD_FILE:-secrets/db_password}"
DB_ROLE="${DB_ROLE:-app_user}"

mkdir -p "$(dirname "${SECRET_FILE}")"
[ -f "${SECRET_FILE}" ] || printf 'app-v1-password' > "${SECRET_FILE}"

docker compose up -d --wait

# The role keeps whatever password it had (rotations survive a plain restart),
# while a fresh volume resets it to the one in db/init.sql. Pushing the file's
# value into the role makes startup idempotent either way.
docker compose exec -T db psql -U admin -d marketplace \
  -c "ALTER ROLE ${DB_ROLE} WITH PASSWORD '$(cat "${SECRET_FILE}")';" >/dev/null

echo "Postgres is up on :5433, role ${DB_ROLE} matches ${SECRET_FILE}"
