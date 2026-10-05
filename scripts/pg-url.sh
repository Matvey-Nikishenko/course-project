# Shared URL parser for backup.sh / restore-drill.sh.
# Requires DATABASE_URL. Exports PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE.
# shellcheck shell=bash

: "${DATABASE_URL:?DATABASE_URL: unbound variable}"

_raw="${DATABASE_URL}"
_raw="${_raw#postgres://}"
_raw="${_raw#postgresql://}"
_userpass="${_raw%%@*}"
_hostportdb="${_raw#*@}"
if [ "${_userpass}" != "${_userpass#*:}" ]; then
  PGUSER="${_userpass%%:*}"
  PGPASSWORD="${_userpass#*:}"
else
  PGUSER="${_userpass}"
  PGPASSWORD=""
fi
_hostport="${_hostportdb%%/*}"
PGDATABASE="${_hostportdb#*/}"
PGDATABASE="${PGDATABASE%%\?*}"
PGHOST="${_hostport%%:*}"
PGPORT="${_hostport#*:}"
if [ "$PGHOST" = "$PGPORT" ]; then
  PGPORT=5432
fi
export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE

# Control sum for restore-drill. Two statements on purpose: a single CASE
# that mentions `orders` in ELSE is still parsed, so a fresh cluster without
# migrations dies with `relation "orders" does not exist` before to_regclass
# can return NULL. Remaining args are a psql prefix (docker run … psql, or
# docker exec … psql).
orders_checksum() {
  local exists
  exists="$("$@" -At -c "SELECT to_regclass('public.orders') IS NOT NULL;")"
  exists="$(printf '%s' "$exists" | tr -d '[:space:]')"
  if [ "$exists" = "t" ]; then
    "$@" -At -c "SELECT count(*)::text || '|' || coalesce(sum(total), 0)::text FROM orders;"
  else
    printf '%s\n' '0|0'
  fi
}
