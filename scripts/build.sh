#!/usr/bin/env bash
#
# build.sh — compile zymd (main + preload + renderer) into ./out
#
# Usage:
#   ./scripts/build.sh          # typecheck + build
#   ./scripts/build.sh --fast   # skip typecheck (faster iteration)
#
set -euo pipefail
cd "$(dirname "$0")/.."

FAST=0
[[ "${1:-}" == "--fast" ]] && FAST=1

echo "▸ zymd build"

if [[ ! -d node_modules ]]; then
  echo "▸ installing dependencies…"
  npm install
fi

if [[ "$FAST" -eq 0 ]]; then
  echo "▸ typecheck…"
  npm run typecheck
fi

echo "▸ bundling with electron-vite…"
npx electron-vite build

echo "✓ built → ./out"
