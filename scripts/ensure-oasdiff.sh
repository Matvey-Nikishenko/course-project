#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION=1.15.0
DEST="$ROOT/node_modules/.cache/oasdiff/$VERSION"
BIN="$DEST/oasdiff"
if [ ! -x "$BIN" ]; then
  mkdir -p "$DEST"
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$os-$arch" in
    darwin-*) asset="oasdiff_${VERSION}_darwin_all.tar.gz" ;;
    linux-x86_64 | linux-amd64) asset="oasdiff_${VERSION}_linux_amd64.tar.gz" ;;
    linux-aarch64 | linux-arm64) asset="oasdiff_${VERSION}_linux_arm64.tar.gz" ;;
    *) echo "unsupported platform $os-$arch" >&2; exit 1 ;;
  esac
  tmp="$(mktemp)"
  curl -fsSL -o "$tmp" "https://github.com/oasdiff/oasdiff/releases/download/v${VERSION}/${asset}"
  tar -xzf "$tmp" -C "$DEST"
  rm -f "$tmp"
  if [ ! -x "$BIN" ]; then
    found="$(find "$DEST" -type f -name oasdiff | head -n 1)"
    if [ -z "$found" ]; then
      echo "oasdiff binary missing after extract" >&2
      exit 1
    fi
    mv "$found" "$BIN"
  fi
  chmod +x "$BIN"
fi
printf '%s\n' "$BIN"
