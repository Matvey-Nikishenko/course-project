#!/bin/sh
# Merge the committed userlist with app_user when secrets/db_password exists,
# so the Nest process can reach Postgres through PgBouncer after db:up / rotate.
set -eu
cp /etc/pgbouncer/userlist.txt /tmp/userlist.txt
if [ -s /run/secrets/db_password ]; then
  pw=$(tr -d '\n' < /run/secrets/db_password | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '"app_user" "%s"\n' "$pw" >> /tmp/userlist.txt
fi
exec /usr/bin/pgbouncer /etc/pgbouncer/pgbouncer.ini
