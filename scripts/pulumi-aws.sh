#!/usr/bin/env bash
# Run one Pulumi command against the hw31 base or demo stack.
# The fallback lane talks to LocalStack. HW31_AWS=real clears that endpoint.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="${1:?stack is base or demo}"
ACTION="${2:?action is up, destroy, or preview}"
shift 2

case "$STACK" in
  base) DIR="$ROOT/infra/base"; NAME=base ;;
  demo) DIR="$ROOT/infra/demo"; NAME=demo ;;
  *) echo "unknown stack: $STACK" >&2; exit 1 ;;
esac

if [ -z "${PULUMI_CONFIG_PASSPHRASE:-}" ]; then
  echo "Missing required secret: PULUMI_CONFIG_PASSPHRASE" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$ROOT/scripts/aws-env.sh"

cd "$DIR"
pulumi stack select "$NAME" --create --non-interactive >/dev/null
case "$ACTION" in
  up) pulumi up --yes --non-interactive "$@" ;;
  destroy) pulumi destroy --yes --non-interactive "$@" ;;
  preview) pulumi preview --non-interactive "$@" ;;
  *) echo "unknown action: $ACTION" >&2; exit 1 ;;
esac
