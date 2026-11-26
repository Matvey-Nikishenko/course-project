#!/usr/bin/env bash
# Bring a stack up, then write the evidence that stack can produce.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="${1:?stack is base or demo}"
# shellcheck disable=SC1091
source "$ROOT/scripts/aws-env.sh"
mkdir -p "$ROOT/evidence"

if [ "$STACK" = "demo" ]; then
  set +e
  bash "$ROOT/scripts/pulumi-aws.sh" demo preview >"$ROOT/evidence/preview-demo.txt" 2>&1
  preview=$?
  # The text preview prints aws:rds:Instance. The JSON preview prints the URN type.
  bash "$ROOT/scripts/pulumi-aws.sh" demo preview --json >>"$ROOT/evidence/preview-demo.txt" 2>&1
  preview_json=$?
  set -e
  if [ "$preview" -ne 0 ] && [ "$preview_json" -ne 0 ]; then
    echo "pulumi preview failed, see evidence/preview-demo.txt" >&2
    exit "$preview"
  fi
  set +e
  bash "$ROOT/scripts/pulumi-aws.sh" demo up >"$ROOT/evidence/501.txt" 2>&1
  up=$?
  set -e
  if grep -q "not included within your LocalStack license" "$ROOT/evidence/501.txt" \
    || grep -q "not included in your current license plan" "$ROOT/evidence/501.txt"; then
    exit 0
  fi
  exit "$up"
fi

bash "$ROOT/scripts/pulumi-aws.sh" base up
node "$ROOT/scripts/measure-base.mjs"
node "$ROOT/scripts/measure-iam.mjs"
