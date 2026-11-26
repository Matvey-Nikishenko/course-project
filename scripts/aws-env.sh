#!/usr/bin/env bash
# Process environment for the hw31 stacks. Does not touch ~/.aws or `pulumi login`.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://$ROOT/.pulumi-aws}"
mkdir -p "$ROOT/.pulumi-aws"
export AWS_REGION="${AWS_REGION:-eu-central-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"
export AWS_EC2_METADATA_DISABLED=true
if [ "${HW31_AWS:-local}" = "real" ]; then
  unset AWS_ENDPOINT_URL || true
else
  export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://127.0.0.1:23166}"
  export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
  export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
fi
