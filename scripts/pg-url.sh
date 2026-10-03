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
