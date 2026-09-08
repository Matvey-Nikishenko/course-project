#!/usr/bin/env bash
# Rotates the database password without restarting the API.
#
# Order matters:
#   1. ALTER ROLE — the new value becomes the truth in Postgres;
#   2. write the secret file — every new pool connection picks it up;
#   3. terminate the role's existing backends — proves the next request
#      opens a fresh connection and authenticates with the new password.
#
# Between 1 and 2 there is a millisecond window in which a new connection
# using the old password fails. Production secret managers (AWS Secrets
# Manager rotation, Vault's database engine) close that window with two
# alternating users: while user_a serves traffic, user_b is rotated.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

SECRET_FILE="${DB_PASSWORD_FILE:-secrets/db_password}"
DB_ROLE="${DB_ROLE:-app_user}"
NEW_PASSWORD="app-$(openssl rand -hex 8)"

echo "1. ALTER ROLE ${DB_ROLE} in Postgres..."
docker compose exec -T db psql -U admin -d marketplace \
  -c "ALTER ROLE ${DB_ROLE} WITH PASSWORD '${NEW_PASSWORD}';" >/dev/null

echo "2. Writing ${SECRET_FILE}..."
printf '%s' "${NEW_PASSWORD}" > "${SECRET_FILE}"

echo "3. Closing existing ${DB_ROLE} connections..."
docker compose exec -T db psql -U admin -d marketplace -tA \
  -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename = '${DB_ROLE}';"

echo "Done: ${NEW_PASSWORD:0:6}... is now in both the database and the file."
echo "The API was not restarted — check: curl -s localhost:3000/health/db"
