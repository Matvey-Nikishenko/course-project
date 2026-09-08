-- Application role. This starting password must match the one npm run db:up
-- writes into secrets/db_password, otherwise the first connection fails with
-- "password authentication failed".
--
-- rotate.sh never writes this value: it generates a fresh password each run
-- and overwrites both the role and the file. After `docker compose down -v`
-- the database is recreated from this file, so the secret file has to be
-- reset to the starting password as well — npm run db:up does that.
CREATE ROLE app_user LOGIN PASSWORD 'app-v1-password';
GRANT CONNECT ON DATABASE marketplace TO app_user;
