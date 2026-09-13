-- Application role, created without a password on purpose.
--
-- The only source of truth for that password is the secret file: npm run db:up
-- pushes the file's value into the role right after the container is ready.
-- A starting password written here as well would be a second source, and the
-- two would drift apart the moment either side changed.
--
-- rotate.sh generates a fresh password each run and overwrites both the role
-- and the file. After `docker compose down -v` this file recreates the role
-- without a password, and db:up restores it from the secret file.
CREATE ROLE app_user LOGIN;
GRANT CONNECT ON DATABASE marketplace TO app_user;
