#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if ! kind get clusters | grep -qx marketplace; then
  kind create cluster --name marketplace --config k8s/kind-config.yaml
fi
kind load docker-image marketplace-api:hw28 --name marketplace
