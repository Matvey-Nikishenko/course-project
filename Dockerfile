# Single-stage image, built on the HW#5 "good" Dockerfile: slim base,
# npm ci instead of npm install, a non-root user, a healthcheck and an
# exec-form CMD.
FROM node:22-slim

WORKDIR /app

# COPY . . is safe only because .dockerignore drops .env and secrets/.
# Layers are append-only, so anything copied in stays in the image forever —
# a later RUN rm would not undo it.
COPY . .

# One layer on purpose. TypeScript has to be built before the image can run,
# so dev dependencies must be present at build time; installing them in their
# own layer would leave them in the image (measured: 631 MB vs 487 MB) even
# after pruning. npm ci, not npm install: it obeys the lock file exactly.
RUN npm ci && npm run build && npm prune --omit=dev

# node:22-slim already ships a "node" user (uid 1000). Without this line the
# process would run as root.
USER node

EXPOSE 3000

# The probe hits the liveness endpoint, which does not touch the database:
# a container is unhealthy when the process is broken, not when Postgres is.
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Exec form: node becomes PID 1 and receives SIGTERM itself. In shell form
# /bin/sh would take PID 1, swallow the signal, and docker stop would wait
# 10 seconds before SIGKILL.
CMD ["node", "dist/main.js"]

# No ENV DB_PASSWORD here on purpose: that channel lives in the image config,
# is readable with `docker inspect` without ever running the container, and
# .dockerignore does not cover it. Secrets arrive at runtime — a mounted file
# for the database password, environment for the rest.
