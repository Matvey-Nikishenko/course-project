#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
test -s .npm_token
DOCKER_BUILDKIT=1 docker build \
  --secret id=npm_token,src=.npm_token \
  -f docker/Dockerfile \
  -t marketplace-api:hw28 \
  .
