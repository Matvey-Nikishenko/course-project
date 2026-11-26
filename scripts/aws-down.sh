#!/usr/bin/env bash
# Destroy one stack. Destroying base also prints the emptiness contract.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="${1:?stack is base or demo}"
# shellcheck disable=SC1091
source "$ROOT/scripts/aws-env.sh"
bash "$ROOT/scripts/pulumi-aws.sh" "$STACK" destroy
if [ "$STACK" = "base" ]; then
  node "$ROOT/scripts/measure-empty.mjs"
fi
