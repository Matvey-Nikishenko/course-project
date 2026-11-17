# syntax=docker/dockerfile:1
# Two stages. The build stage has a shell and the npm token only as a
# BuildKit secret mount. The runtime stage is distroless, uid 65532, no shell.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN --mount=type=secret,id=npm_token \
    test -s /run/secrets/npm_token \
    && npm ci \
    && npm run build \
    && npm prune --omit=dev

FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
COPY --from=build --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=build --chown=65532:65532 /app/dist ./dist
COPY --from=build --chown=65532:65532 /app/package.json ./package.json
COPY --chown=65532:65532 openapi ./openapi
USER 65532
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["dist/main.js"]
