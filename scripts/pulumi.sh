#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://${ROOT}/.pulumi}"
mkdir -p "${PULUMI_BACKEND_URL#file://}"
cd "$ROOT/infra"
pulumi stack select dev --create --non-interactive
case "${1:-up}" in
  up) pulumi up --yes --non-interactive ;;
  destroy) pulumi destroy --yes --non-interactive ;;
  *) echo "unknown pulumi command: $1" >&2; exit 1 ;;
esac
